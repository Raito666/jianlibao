import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncHandler } from '../../netlify/functions/lib/sync-handler.mjs';
import { cloudTransport } from '../../src/sync/transport';
import { createSecret } from '../../src/sync/crypto';
import { createInitialData } from '../../src/domain/seed';
import { snapshotOf } from '../../src/sync/model';
import { readFileSync } from 'node:fs';

afterEach(() => vi.unstubAllGlobals());
describe('real encryption / HTTP / conditional replacement boundary', () => {
  it('round trips private records and conditional reads without sending the recovery key or plaintext', async () => {
    const saved = new Map<string, { data: unknown; etag: string }>(), requests: Request[] = [];
    const handler = createSyncHandler(() => ({
      async getWithMetadata(key: string) { return saved.get(key) ?? null; },
      async setJSON(key: string, data: unknown, options: { onlyIfNew?: boolean; onlyIfMatch?: string }) {
        const old = saved.get(key);
        if (options.onlyIfNew ? !!old : options.onlyIfMatch !== old?.etag) return { modified: false };
        const etag = '"cloud-etag"'; saved.set(key, { data, etag }); return { modified: true, etag };
      },
    }));
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      const request = new Request(`https://unit.test${path}`, init); requests.push(request.clone()); return handler(request);
    });
    const secret = createSecret(), transport = cloudTransport(secret), d = createInitialData();
    d.bodyMetrics = [{ id: 'private', date: '2026-10-26', weightKg: 70, note: '不应出现在网络明文中' }];
    expect((await transport.pull()).snapshot).toBeNull();
    const etag = await transport.push(snapshotOf(d), null); expect(etag).toBe('"cloud-etag"');
    expect((await transport.pull()).snapshot).toEqual(snapshotOf(d));
    expect(requests.at(-1)?.headers.get('X-Jianlibao-Known-Revision')).toBe(etag);
    expect((await cloudTransport(secret).pull()).snapshot).toEqual(snapshotOf(d));
    expect((await cloudTransport(createSecret()).pull()).snapshot).toBeNull();
    const upload = await requests.find(r => r.method === 'PUT')!.text();
    expect(upload).not.toContain(secret); expect(upload).not.toContain('不应出现在网络明文中'); expect(upload).not.toContain('weightKg');
    expect(await transport.push(snapshotOf(d), '"stale"')).toBeNull();
  });
  it.each([429, 503])('turns HTTP %i into an actionable local-safe error', async status => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status }));
    await expect(cloudTransport(createSecret()).pull()).rejects.toThrow(/本地记录不受影响/);
  });
  it('explicitly bypasses Service Worker handling of private functions', () => {
    const source = readFileSync('scripts/build-sw.mjs', 'utf8');
    expect(source).toContain("pathname.startsWith('/.netlify/functions/')) return");
  });
  it('rejects a static-host HTML fallback with a clear Chinese explanation', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>app shell</html>', { headers: { 'Content-Type': 'text/html', ETag: '"html"' } }));
    await expect(cloudTransport(createSecret()).pull()).rejects.toThrow(/当前地址.*云同步接口/);
  });
});
