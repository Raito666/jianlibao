import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { referenceWorkerSource } from './reference-worker.mjs';
import { pwaWorkerSource } from './pwa-worker.mjs';

const root = path.resolve('dist');
async function files(dir) {
  const all = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(all.filter(entry => !['sw.js', '_headers', '_redirects', 'exercise-art', 'exercise-media'].includes(entry.name)).map(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))).flat();
}
const assets = await files(root);
const library = JSON.parse(await readFile('src/content/catalog.json', 'utf8'));
const media = `jianlibao-media-${library.version}`;
const references = JSON.parse(await readFile('src/content/reference-media.json', 'utf8'));
const libraryReferences = JSON.parse(await readFile('src/content/reference-library.json', 'utf8'));
const referenceAssets = [...references.assets, ...libraryReferences.entries.flatMap(entry => entry.assets)];
const hash = createHash('sha256');
for (const file of assets.sort()) hash.update(await readFile(file));
const cache = `jianlibao-${hash.digest('hex').slice(0, 16)}`;
const urls = ['/', ...assets.map(file => '/' + path.relative(root, file).replaceAll('\\', '/'))];
const shellFiles = await Promise.all(urls.map(async url => {
  const bytes = await readFile(path.join(root, url === '/' ? 'index.html' : url.slice(1)));
  return { url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
await writeFile(path.join(root, 'sw.js'), `const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(urls)};
const MEDIA = ${JSON.stringify(media)};
${pwaWorkerSource(shellFiles, await readFile(path.join(root, 'index.html'), 'utf8'))}
${referenceWorkerSource({ version: references.version, assets: referenceAssets })}
async function validArt(response) {
  if (!response?.ok) return false;
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mime !== 'image/svg+xml') return validRasterResponse(response);
  const text = await response.clone().text();
  return /<svg(?:\\s|>)/i.test(text) && /<\\/svg>\\s*$/i.test(text);
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(ASSETS.filter(url => url !== '/' && url !== '/index.html'));
    if (!(await prepareShell(cache, SHELL_FILES, fetch, SHELL_DOCUMENT)).ready) throw new Error('Offline shell verification failed');
  }));
});
// A new version waits until old tabs close. Never reload an active training session.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('jianlibao-') && key !== CACHE && key !== MEDIA && key !== REFERENCE_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // Private sync responses must never use the public offline shell or asset caches.
  if (new URL(event.request.url).pathname.startsWith('/.netlify/functions/')) return;
  if (REFERENCE_ASSETS.has(new URL(event.request.url).pathname)) {
    event.respondWith(referenceFetch(event.request));
    return;
  }
  if (new URL(event.request.url).pathname.startsWith('/exercise-art/${library.version}/')) {
    event.respondWith(caches.open(MEDIA).then(async cache => {
      const key = new URL(event.request.url).pathname;
      const cached = await cache.match(key, { ignoreVary: true });
      if (await validArt(cached)) return cached;
      // A bad snapshot must not delete a newer valid response written concurrently.
      const response = await fetch(event.request, { cache: 'reload' });
      if (await validArt(response)) await cache.put(key, response.clone());
      return response;
    }));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/', { ignoreVary: true }).then(cached => cached || fetch(event.request))));
    return;
  }
  // Fixed, public same-origin build assets vary by Origin on Vite preview.
  // They have no authentication variants; ignore Vary so offline CORS loads hit.
  event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request, { ignoreVary: true }).then(cached => cached || fetch(event.request))));
});
`);
console.log(`Offline shell generated: ${cache} (${urls.length} paths)`);
