import { describe, expect, it } from 'vitest';
import { createSyncHandler } from '../../netlify/functions/lib/sync-handler.mjs';
const token = 'a'.repeat(43);
const envelope = { version: 1, iv: 'a'.repeat(16), ciphertext: 'a'.repeat(40) };
function harness() {
  let saved: { data: unknown; etag: string } | null = null, writes = 0;
  const store = {
    async getWithMetadata() { return saved; },
    async setJSON(_key: string, data: unknown, options: { onlyIfNew?: boolean; onlyIfMatch?: string }) {
      if (options.onlyIfNew ? saved !== null : options.onlyIfMatch !== saved?.etag) return { modified: false };
      saved = { data, etag: `"v${++writes}"` }; return { modified: true, etag: saved.etag };
    },
  };
  const handler = createSyncHandler(() => store);
  const req = (method = 'GET', headers: Record<string, string> = {}, body?: unknown) => new Request('https://app.example/.netlify/functions/sync', {
    method, headers: { authorization: `Bearer ${token}`, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { handler, req, saved: () => saved };
}
describe('private encrypted cloud endpoint', () => {
  it('rejects missing credentials and cross-origin browser access', async () => {
    const { handler, req } = harness();
    expect((await handler(new Request('https://app.example/.netlify/functions/sync'))).status).toBe(401);
    expect((await handler(req('GET', { Origin: 'https://evil.example' }))).status).toBe(403);
  });
  it('is private, uncacheable and absent until explicitly created', async () => {
    const { handler, req } = harness(); const r = await handler(req());
    expect(r.status).toBe(404); expect(r.headers.get('Cache-Control')).toContain('no-store');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('requires conditional creation and prevents racing first writes', async () => {
    const { handler, req } = harness();
    expect((await handler(req('PUT', { 'Content-Type': 'application/json' }, envelope))).status).toBe(428);
    const request = () => req('PUT', { 'Content-Type': 'application/json', 'If-None-Match': '*' }, envelope);
    const results = await Promise.all([handler(request()), handler(request())]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  });
  it('returns etags, rejects stale replacement, and only sends changed data', async () => {
    const { handler, req } = harness();
    const first = await handler(req('PUT', { 'Content-Type': 'application/json', 'If-None-Match': '*' }, envelope));
    const etag = first.headers.get('ETag')!;
    expect((await handler(req('GET', { 'If-None-Match': etag }))).status).toBe(304);
    expect((await handler(req('PUT', { 'Content-Type': 'application/json', 'If-Match': '"old"' }, envelope))).status).toBe(409);
    expect((await handler(req('PUT', { 'Content-Type': 'application/json', 'If-Match': etag }, envelope))).status).toBe(200);
    const current = await handler(req()); expect(await current.json()).toEqual(envelope);
  });
  it('rejects plaintext, unknown envelope fields, oversized uploads and unsupported methods', async () => {
    const { handler, req, saved } = harness();
    for (const input of [{ weightKg: 70 }, { ...envelope, secret: 'unsafe' }, { ...envelope, version: 2 }]) {
      expect((await handler(req('PUT', { 'Content-Type': 'application/json', 'If-None-Match': '*' }, input))).status).toBe(400);
    }
    expect((await handler(req('PUT', { 'Content-Type': 'application/json', 'If-None-Match': '*', 'Content-Length': '5000000' }, envelope))).status).toBe(413);
    expect((await handler(req('DELETE'))).status).toBe(405); expect(saved()).toBeNull();
  });
  it('preserves authoritative versions across CDNs that strip or rewrite HTTP ETags', async () => {
    const { handler, req } = harness();
    const first = await handler(req('PUT', { 'Content-Type': 'application/json', 'X-Jianlibao-Revision': 'new' }, envelope));
    expect(first.status).toBe(200);
    const revision = first.headers.get('X-Jianlibao-Revision')!; expect(revision).toBe('"v1"');
    const unchanged = await handler(req('GET', { 'X-Jianlibao-Known-Revision': revision }));
    expect(unchanged.status).toBe(200);
    expect(unchanged.headers.get('X-Jianlibao-Unchanged')).toBe('1');
    expect(await unchanged.json()).toEqual({ unchanged: true });
    expect((await handler(req('PUT', { 'Content-Type': 'application/json', 'X-Jianlibao-Revision': '"stale"' }, envelope))).status).toBe(409);
    expect((await handler(req('PUT', { 'Content-Type': 'application/json', 'X-Jianlibao-Revision': revision }, envelope))).status).toBe(200);
  });
});
