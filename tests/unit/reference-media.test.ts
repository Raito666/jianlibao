import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { benchReference, referenceMediaFor, REFERENCE_CACHE } from '../../src/content/reference-media';
import { isReferenceResponse, referenceCacheState, saveReferenceMedia, referenceOfflineAvailable, type ReferenceAsset, type ReferenceCache } from '../../src/content/reference-cache';
import { isArtResponse } from '../../src/content/art-cache';
import { rangeResponse, referenceWorkerSource } from '../../scripts/reference-worker.mjs';

function asset(text: string, url = '/exercise-media/test/sample.mp4'): ReferenceAsset {
  const bytes = Buffer.from(text);
  return { url, mime: 'video/mp4', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const sample = '\0\0\0\x18ftypmp42\0\0\0\0isommp42';
function response(text = sample, status = 200, mime = 'video/mp4') { return new Response(text, { status, headers: { 'Content-Type': mime } }); }
function memoryCache() {
  const values = new Map<string, Response>();
  const cache: ReferenceCache = {
    match: async url => values.get(url)?.clone(),
    put: async (url, value) => { values.set(url, value.clone()); },
    delete: async url => values.delete(url),
  };
  return { values, cache, storage: { open: async () => cache } };
}
describe('reviewed bench reference is separate from saved training data', () => {
  it('binds only the exact built-in bench identity', () => {
    expect(referenceMediaFor('ex-bench')).toBe(benchReference);
    for (const id of ['personal-bench', 'catalog-smith-machine-bench-press', 'ex-squat', 'Bench Press']) expect(referenceMediaFor(id)).not.toBe(benchReference);
    for (const id of ['personal-bench', 'ex-squat', 'Bench Press']) expect(referenceMediaFor(id)).toBeUndefined();
    expect(referenceMediaFor('catalog-smith-machine-bench-press')?.assets.find(a => a.kind === 'video')?.id).toBe(21);
    expect(REFERENCE_CACHE).not.toContain('jianlibao-media-aac59922');
  });
  it('pins two original attributed PNGs and one light ISO MP4 to exact local bytes', () => {
    expect(benchReference.assets).toHaveLength(3);
    expect(benchReference.assets.filter(a => a.mime === 'image/png')).toHaveLength(2);
    const video = benchReference.assets.find(a => a.mime === 'video/mp4')!;
    expect(video.bytes).toBeLessThan(2_000_000);
    expect(video.author).toBe('Goulart');
    expect(video.license).toBe('CC BY-SA 4.0');
    for (const a of benchReference.assets) {
      const bytes = readFileSync(`public${a.url}`);
      expect(bytes.length).toBe(a.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256);
      expect(a.author.trim()).not.toBe('');
      expect(a.sourceUrl).toMatch(/^https:\/\/wger.de\//);
      expect(a.licenseUrl).toMatch(/^https:\/\/creativecommons.org\/licenses\/by-sa\/[34]\.0\//);
    }
  });
});
describe('reference response integrity', () => {
  it('accepts the exact complete expected response', async () => {
    expect(await isReferenceResponse(response(), asset(sample))).toBe(true);
  });
  for (const [label, value] of [
    ['wrong MIME', () => response(sample, 200, 'text/html')],
    ['partial body', () => response(sample, 206)],
    ['same-length corruption', () => response(sample.replace('mp42', 'bad!'))],
    ['HTML fallback', () => response('<html>fallback</html>')],
    ['truncated body', () => response(sample.slice(0, -1))],
  ] as const) it(`rejects ${label}`, async () => {
    expect(await isReferenceResponse(value(), asset(sample))).toBe(false);
  });
  it('accepts real PNG image data and rejects HTML disguised as a PNG', async () => {
    const png = readFileSync(`public${benchReference.assets[0].url}`);
    expect(await isArtResponse(new Response(png, { headers: { 'Content-Type': 'image/png' } }))).toBe(true);
    expect(await isArtResponse(new Response('<html>fallback</html>', { headers: { 'Content-Type': 'image/png' } }))).toBe(false);
    expect(await isArtResponse(new Response(png.subarray(0, 12), { headers: { 'Content-Type': 'image/png' } }))).toBe(false);
  });
});
describe('reference cache never confuses partial preparation with ready', () => {
  it('reports missing Cache API without claiming readiness', async () => {
    expect(await referenceCacheState([asset(sample)], undefined)).toEqual({ ready: false, cached: 0, available: false });
  });
  it('ignores a bad old cache entry and repairs it from a validated response', async () => {
    const m = memoryCache(), a = asset(sample);
    m.values.set(a.url, response('<html>fallback</html>'));
    expect(await referenceCacheState([a], m.storage)).toEqual({ ready: false, cached: 0, available: true });
    expect(m.values.has(a.url)).toBe(true);
    await saveReferenceMedia([a], { storage: m.storage, fetcher: async () => response() });
    expect((await referenceCacheState([a], m.storage)).ready).toBe(true);
  });
  it('resumes validated files without fetching them again', async () => {
    const m = memoryCache(), a = asset(sample), b = asset(sample, '/exercise-media/test/second.mp4');
    m.values.set(a.url, response()); const fetched: string[] = [];
    await saveReferenceMedia([a, b], { storage: m.storage, fetcher: async url => { fetched.push(String(url)); return response(); } });
    expect(fetched).toEqual([b.url]); expect((await referenceCacheState([a, b], m.storage)).cached).toBe(2);
  });
  it('does not store partial content or mark the bundle ready after a failed fetch', async () => {
    const m = memoryCache(), a = asset(sample);
    await expect(saveReferenceMedia([a], { storage: m.storage, fetcher: async () => response(sample, 206) })).rejects.toThrow('校验');
    expect(m.values.size).toBe(0); expect((await referenceCacheState([a], m.storage)).ready).toBe(false);
  });
  it('propagates quota failure and retains already valid cached files', async () => {
    const m = memoryCache(), a = asset(sample), b = asset(sample, '/exercise-media/test/second.mp4');
    m.values.set(a.url, response()); m.cache.put = async () => { throw new DOMException('full', 'QuotaExceededError'); };
    await expect(saveReferenceMedia([a, b], { storage: m.storage, fetcher: async () => response() })).rejects.toThrow('full');
    expect((await referenceCacheState([a, b], m.storage)).cached).toBe(1);
  });
  it('checks cancellation after fetch, so a late response cannot turn into a ready badge', async () => {
    const m = memoryCache(), a = asset(sample), abort = new AbortController();
    await expect(saveReferenceMedia([a], { storage: m.storage, signal: abort.signal, fetcher: async () => { abort.abort(); return response(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(m.values.size).toBe(0);
  });
});
describe('offline video ranges use the complete cached file', () => {
  for (const [range, start, end] of [['bytes=0-3', 0, 3], ['bytes=5-', 5, 9], ['bytes=-4', 6, 9], ['bytes=2-99', 2, 9]] as const) {
    it(`serves ${range} as exact 206 bytes`, async () => {
      const r = await rangeResponse(new Response('0123456789', { headers: { 'Content-Type': 'video/mp4' } }), range);
      expect(r.status).toBe(206); expect(r.headers.get('Content-Range')).toBe(`bytes ${start}-${end}/10`);
      expect(r.headers.get('Content-Type')).toBe('video/mp4'); expect(await r.text()).toBe('0123456789'.slice(start, end + 1));
    });
  }
  for (const range of ['bytes=99-', 'bytes=2-1', 'bytes=-0', 'bytes=0-1,3-4', 'not-a-range']) it(`rejects unsatisfiable ${range}`, async () => {
    const r = await rangeResponse(new Response('0123456789'), range); expect(r.status).toBe(416); expect(r.headers.get('Content-Range')).toBe('bytes */10');
  });
});

describe('offline readiness requires the current reference-capable worker', () => {
  it('rejects absent controller even when CacheStorage exists', async () => {
    expect(await referenceOfflineAvailable(null, 20)).toBe(false);
  });
  it('accepts only an exact cache/version acknowledgement', async () => {
    const controller = { postMessage: (_: unknown, ports: Transferable[]) => (ports[0] as MessagePort).postMessage({ type: 'jianlibao-reference-ready', cache: REFERENCE_CACHE, version: 1 }) };
    expect(await referenceOfflineAvailable(controller, 100)).toBe(true);
  });
  it('rejects an older worker that ignores the message', async () => {
    expect(await referenceOfflineAvailable({ postMessage: () => {} }, 10)).toBe(false);
  });
  it('rejects acknowledgements for a different media version', async () => {
    const controller = { postMessage: (_: unknown, ports: Transferable[]) => (ports[0] as MessagePort).postMessage({ type: 'jianlibao-reference-ready', cache: 'old-cache', version: 1 }) };
    expect(await referenceOfflineAvailable(controller, 100)).toBe(false);
  });
  it('fails closed if the controller cannot receive the message', async () => {
    expect(await referenceOfflineAvailable({ postMessage: () => { throw new Error('detached'); } }, 20)).toBe(false);
  });
});


describe('cache checks do not delete a newer successful save', () => {
  function delayedBadResponse() {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const value = response(sample.replace('mp42', 'bad!'));
    value.clone = () => ({ arrayBuffer: async () => { await waiting; return new TextEncoder().encode(sample.replace('mp42', 'bad!')).buffer; } }) as Response;
    return { value, release };
  }
  it('a stale page check cannot delete a freshly repaired file', async () => {
    const m = memoryCache(), a = asset(sample), old = delayedBadResponse();
    let first = true;
    m.cache.match = async url => { if (first) { first = false; return old.value; } return m.values.get(url)?.clone(); };
    const checking = referenceCacheState([a], m.storage);
    await Promise.resolve(); await Promise.resolve();
    const saved = await saveReferenceMedia([a], { storage: m.storage, fetcher: async () => response() });
    expect(saved.cached).toBe(1);
    old.release(); await checking;
    expect(await isReferenceResponse(await m.cache.match(a.url), a)).toBe(true);
  });
  it('a stale worker check followed by network failure cannot delete a newer valid entry', async () => {
    const m = memoryCache(), a = asset(sample), old = delayedBadResponse();
    let first = true;
    m.cache.match = async url => { if (first) { first = false; return old.value; } return m.values.get(url)?.clone(); };
    const scope = { self: { addEventListener: () => {} }, caches: { open: async () => m.cache }, fetch: async () => { throw new Error('offline'); }, Response, URL, crypto };
    const workerFetch = runInNewContext(referenceWorkerSource({ version: 'test', assets: [a] }) + '\nreferenceFetch', scope) as (request: Request) => Promise<Response>;
    const checking = workerFetch(new Request(`https://local.test${a.url}`));
    await Promise.resolve(); await Promise.resolve();
    await m.cache.put(a.url, response());
    old.release(); await expect(checking).rejects.toThrow('offline');
    expect(await isReferenceResponse(await m.cache.match(a.url), a)).toBe(true);
  });
  it('counts saved files even without an optional progress callback', async () => {
    const m = memoryCache(), a = asset(sample);
    expect(await saveReferenceMedia([a], { storage: m.storage, fetcher: async () => response() })).toEqual({ ready: true, cached: 1, available: true });
  });
});
