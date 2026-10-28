import { mediaUrls, MEDIA_CACHE } from './catalog';
import { validRasterResponse } from '../../scripts/reference-worker.mjs';

export async function isArtResponse(response: Response | undefined) {
  if (!response?.ok) return false;
  const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mime !== 'image/svg+xml') return validRasterResponse(response);
  const text = await response.clone().text();
  if (!/<svg(?:\s|>)/i.test(text) || !/<\/svg>\s*$/i.test(text)) return false;
  const document = new DOMParser().parseFromString(text, 'image/svg+xml');
  return document.documentElement.localName === 'svg' && !document.querySelector('parsererror');
}

export async function cachedArtUrls(cache: Cache) {
  const keys = new Set((await cache.keys()).map(key => new URL(key.url).pathname));
  const valid = new Set<string>(); let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < mediaUrls.length) {
      const url = mediaUrls[next++]; if (!keys.has(url)) continue;
      const response = await cache.match(url, { ignoreVary: true });
      // Validation observes a snapshot; deleting here can erase a newer successful write.
      if (await isArtResponse(response)) valid.add(url);
    }
  }));
  return valid;
}

export async function fetchArt(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal, cache: 'reload' }).catch(error => { if (signal.aborted) throw error; throw new Error('图解加载失败。请保持健力宝启动窗口运行，再继续准备离线图解。'); });
  if (!await isArtResponse(response)) throw new Error('图解内容未能通过校验，请确认健力宝本机服务仍在运行后重试。');
  return response;
}

export async function discardCachedArt(url: string) {
  if ('caches' in window) await (await caches.open(MEDIA_CACHE)).delete(url, { ignoreVary: true });
}
