export async function validShellResponse(response, asset) {
  if (!response?.ok) return false;
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
  const path = asset.url.split('?')[0];
  const typeMatches = path.endsWith('.js') ? /^(?:application|text)\/(?:java|ecma)script$/.test(mime)
    : path.endsWith('.css') ? mime === 'text/css'
    : path.endsWith('.png') ? mime === 'image/png'
    : path.endsWith('.svg') ? mime === 'image/svg+xml'
    : path.endsWith('.webmanifest') ? /^(?:application\/manifest\+json|application\/json)$/.test(mime)
    : mime === 'text/html';
  if (!typeMatches) return false;
  const bytes = await response.clone().arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength !== asset.bytes) return false;
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(n => n.toString(16).padStart(2, '0')).join('');
  return digest === asset.sha256;
}
export async function inspectShell(cache, assets) {
  let cached = 0;
  if (cache) for (const asset of assets) {
    try { if (await validShellResponse(await cache.match(asset.url, { ignoreVary: true }), asset)) cached++; }
    catch { /* Storage failure is unconfirmed, never proof of availability. */ }
  }
  return { total: assets.length, cached, ready: assets.length > 0 && cached === assets.length };
}
export async function prepareShell(cache, assets, fetcher = fetch, documentSource) {
  for (const asset of assets) {
    let valid = false;
    try { valid = await validShellResponse(await cache.match(asset.url, { ignoreVary: true }), asset); } catch { /* Fetch a verified replacement. */ }
    if (valid) continue;
    // The CDN may annotate HTML. Cache only the original build document,
    // still requiring its exact byte length and SHA like every other asset.
    const response = typeof documentSource === 'string' && (asset.url === '/' || asset.url === '/index.html')
      ? new Response(documentSource, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      : await fetcher(asset.url, { cache: 'reload', credentials: 'omit' });
    if (!await validShellResponse(response, asset)) throw Error('Shell verification failed');
    await cache.put(asset.url, response.clone());
  }
  return inspectShell(cache, assets);
}
export function pwaWorkerSource(assets, documentSource) {
  return `const SHELL_FILES = ${JSON.stringify(assets)};
const SHELL_DOCUMENT = ${JSON.stringify(documentSource)};
${validShellResponse.toString()}
${inspectShell.toString()}
${prepareShell.toString()}
let shellPreparation;
self.addEventListener('message', event => {
  const type = event.data?.type, port = event.ports?.[0];
  if (!port || (type !== 'jianlibao-shell-status' && type !== 'jianlibao-shell-prepare')) return;
  event.waitUntil((async () => {
    try {
      let result;
      if (type === 'jianlibao-shell-prepare') {
        shellPreparation ??= caches.open(CACHE).then(cache => prepareShell(cache, SHELL_FILES, fetch, SHELL_DOCUMENT)).finally(() => { shellPreparation = undefined; });
        result = await shellPreparation;
      } else {
        const exists = (await caches.keys()).includes(CACHE);
        result = await inspectShell(exists ? await caches.open(CACHE) : null, SHELL_FILES);
      }
      // Activation can finish while a navigation still belongs to the old
      // document. Its replacement then misses the initial clients.claim().
      // This active-worker handshake runs after the document has committed;
      // reclaim only a verified shell, without activating a waiting update.
      if (result.ready) await self.clients.claim();
      port.postMessage({ type: 'jianlibao-shell-status', version: 1, cache: CACHE, ...result });
    } catch { port.postMessage({ type: 'jianlibao-shell-failed' }); }
  })());
});`;
}
