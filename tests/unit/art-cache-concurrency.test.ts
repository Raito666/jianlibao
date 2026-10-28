import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { cachedArtUrls } from '../../src/content/art-cache';
import { mediaUrls } from '../../src/content/catalog';
import { benchReference } from '../../src/content/reference-media';

const origin = 'https://cache.test';
const folders: string[] = [];
const goodPng = () => new Response(readFileSync(`public${benchReference.assets[0].url}`), {
  headers: { 'Content-Type': 'image/png' },
});
const bad = () => new Response('<html>old error</html>', { headers: { 'Content-Type': 'text/html' } });
const svg = () => new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
  headers: { 'Content-Type': 'image/svg+xml' },
});

function memoryCache() {
  const entries = new Map<string, Response>();
  const key = (request: RequestInfo | URL) =>
    new URL(typeof request === 'string' ? request : request instanceof URL ? request.href : request.url, origin).href;
  const cache: Cache = {
    add: async () => { throw new Error('not used'); },
    addAll: async () => { throw new Error('not used'); },
    put: async (request, response) => { entries.set(key(request), response.clone()); },
    match: async request => entries.get(key(request))?.clone(),
    matchAll: async () => [...entries.values()].map(value => value.clone()),
    keys: async () => [...entries.keys()].map(url => new Request(url)),
    delete: async request => entries.delete(key(request)),
  };
  return { cache, entries, key };
}

afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + '\\') && !resolve(folder).startsWith(resolve(tmpdir()) + '/'))
      throw new Error('Unexpected test fixture path');
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('art-cache validation does not delete concurrent successful writes', () => {
  for (const stale of ['invalid', 'missing'] as const) {
    it(`preserves a valid page-cache replacement after a ${stale} snapshot`, async () => {
      const m = memoryCache();
      const url = mediaUrls[0];
      await m.cache.put(url, bad());
      const original = m.cache.match.bind(m.cache);
      let first = true;
      m.cache.match = async (request, options) => {
        if (first) {
          first = false;
          const old = stale === 'missing' ? undefined : await original(request, options);
          // A second writer repairs this key after the validator reads its old value.
          await m.cache.put(url, goodPng());
          return old;
        }
        return original(request, options);
      };
      await cachedArtUrls(m.cache);
      expect(await (await original(url))?.arrayBuffer()).toEqual(await goodPng().arrayBuffer());
      expect(await cachedArtUrls(m.cache)).toEqual(new Set([url]));
    });
  }

  it('never counts malformed cached content as offline-ready', async () => {
    const m = memoryCache();
    await m.cache.put(mediaUrls[0], bad());
    expect(await cachedArtUrls(m.cache)).toEqual(new Set());
  });
});

function generatedWorker() {
  const folder = mkdtempSync(join(tmpdir(), 'jianlibao-art-worker-'));
  folders.push(folder);
  mkdirSync(join(folder, 'dist'));
  mkdirSync(join(folder, 'src/content'), { recursive: true });
  writeFileSync(join(folder, 'dist/index.html'), '<html>fixture</html>');
  for (const [name, data] of [
    ['catalog.json', { version: 'test' }],
    ['reference-media.json', { version: 1, assets: [] }],
    ['reference-library.json', { entries: [] }],
  ] as const) writeFileSync(join(folder, 'src/content', name), JSON.stringify(data));
  execFileSync(process.execPath, [resolve('scripts/build-sw.mjs')], { cwd: folder, stdio: 'pipe' });
  return readFileSync(join(folder, 'dist/sw.js'), 'utf8');
}

describe('the generated real art worker preserves newer cache entries', () => {
  it('cannot delete a valid replacement after reading an old malformed response', async () => {
    const m = memoryCache();
    const url = origin + '/exercise-art/test/first.svg';
    await m.cache.put(url, bad());
    const original = m.cache.match.bind(m.cache);
    let first = true;
    m.cache.match = async (request, options) => {
      if (first) {
        first = false;
        const old = await original(request, options);
        await m.cache.put(url, svg());
        return old;
      }
      return original(request, options);
    };
    let listener: ((event: { request: Request; respondWith: (response: Promise<Response>) => void }) => void) | undefined;
    runInNewContext(generatedWorker(), {
      self: { location: { origin }, addEventListener: (name: string, fn: typeof listener) => { if (name === 'fetch') listener = fn; } },
      caches: { open: async () => m.cache }, URL, Response, Request, Uint8Array,
      fetch: async () => { throw new Error('offline'); },
    });
    let response: Promise<Response> | undefined;
    listener!({ request: new Request(url), respondWith: value => { response = value; } });
    await expect(response).rejects.toThrow('offline');
    expect(await (await original(url))?.text()).toBe(await svg().text());
  });

  it('serves an already valid SVG without touching the network', async () => {
    const m = memoryCache();
    const url = origin + '/exercise-art/test/first.svg';
    await m.cache.put(url, svg());
    let network = 0;
    let listener: ((event: { request: Request; respondWith: (response: Promise<Response>) => void }) => void) | undefined;
    runInNewContext(generatedWorker(), {
      self: { location: { origin }, addEventListener: (name: string, fn: typeof listener) => { if (name === 'fetch') listener = fn; } },
      caches: { open: async () => m.cache }, URL, Response, Request, Uint8Array,
      fetch: async () => { network++; throw new Error('offline'); },
    });
    let response: Promise<Response> | undefined;
    listener!({ request: new Request(url), respondWith: value => { response = value; } });
    expect(await (await response!)?.text()).toBe(await svg().text());
    expect(network).toBe(0);
  });
});
