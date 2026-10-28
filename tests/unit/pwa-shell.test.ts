import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { inspectShell, prepareShell } from '../../scripts/pwa-worker.mjs';
const body = 'export const ready=true;', hash = createHash('sha256').update(body).digest('hex');
const files = [{ url: '/assets/app.js', bytes: Buffer.byteLength(body), sha256: hash }];
const response = (text = body, type = 'application/javascript') => new Response(text, { headers: { 'Content-Type': type } });
describe('PWA shell integrity', () => {
  it('requires actual nonempty cache responses with matching size, SHA and MIME', async () => {
    expect(await inspectShell({ match: async () => response() }, files)).toEqual({ total: 1, cached: 1, ready: true });
  });
  it('missing, HTML masquerading as JavaScript and same-sized corrupt bytes are not ready', async () => {
    for (const item of [undefined, response(body, 'text/html'), response(body.replace('true', 'fake')), response('')]) {
      expect((await inspectShell({ match: async () => item?.clone() }, files)).ready).toBe(false);
    }
    expect((await inspectShell(null, files)).ready).toBe(false);
  });
  it('cache read errors cannot produce a successful proof', async () => {
    expect((await inspectShell({ match: async () => { throw Error('denied'); } }, files)).ready).toBe(false);
  });
  it('repair restores only known public assets, keeping existing valid responses', async () => {
    const values = new Map<string, Response>(), requests: string[] = [];
    const cache = { match: async (url: string) => values.get(url)?.clone(), put: async (url: string, value: Response) => { values.set(url, value.clone()); } };
    const fetcher = async (url: string) => { requests.push(url); return response(); };
    await prepareShell(cache, files, fetcher); expect((await inspectShell(cache, files)).ready).toBe(true);
    await prepareShell(cache, files, fetcher); expect(requests).toEqual(['/assets/app.js']);
  });
  it('bad network responses never replace cached bytes or claim successful repair', async () => {
    let puts = 0;
    const cache = { match: async () => undefined, put: async () => { puts++; } };
    await expect(prepareShell(cache, files, async () => response('<html>unavailable</html>', 'text/html'))).rejects.toThrow(); expect(puts).toBe(0);
  });
  it('manifest MIME must identify JSON even when response bytes match', async () => {
    const manifest = '{"name":"健力宝"}', asset = [{ url: '/manifest.webmanifest', bytes: Buffer.byteLength(manifest), sha256: createHash('sha256').update(manifest).digest('hex') }];
    for (const type of ['application/manifest+json', 'application/json']) expect((await inspectShell({ match: async () => response(manifest, type) }, asset)).ready).toBe(true);
    for (const type of ['application/octet-stream', 'text/html']) expect((await inspectShell({ match: async () => response(manifest, type) }, asset)).ready).toBe(false);
  });
  it('uses the pinned build document for offline navigation instead of transformed network HTML', async () => {
    const html = '<!doctype html><title>健力宝</title>', documentFiles = ['/', '/index.html'].map(url => ({ url, bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex') }));
    const values = new Map<string, Response>([['/', response(html + '<!-- provider annotation -->', 'text/html')]]), requests: string[] = [];
    const cache = { match: async (url: string) => values.get(url)?.clone(), put: async (url: string, value: Response) => { values.set(url, value.clone()); } };
    await prepareShell(cache, documentFiles, async (url: string) => { requests.push(url); throw Error('Document must not be fetched'); }, html);
    expect(requests).toEqual([]); expect((await inspectShell(cache, documentFiles)).ready).toBe(true);
    for (const asset of documentFiles) expect(await values.get(asset.url)!.clone().text()).toBe(html);
  });
  it('a build document that does not match its pinned SHA is never cached', async () => {
    const html = '<!doctype html><title>original</title>', documentFiles = [{ url: '/', bytes: Buffer.byteLength(html), sha256: createHash('sha256').update(html).digest('hex') }]; let puts = 0, requests = 0;
    const cache = { match: async () => undefined, put: async () => { puts++; } };
    await expect(prepareShell(cache, documentFiles, async () => { requests++; return response(html, 'text/html'); }, html.replace('original', 'modified'))).rejects.toThrow();
    expect(puts).toBe(0); expect(requests).toBe(0);
  });
});
