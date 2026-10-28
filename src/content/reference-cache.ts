import {
  validReferenceResponse,
  type ReferenceAssetSpec,
} from "../../scripts/reference-worker.mjs";
import { REFERENCE_CACHE } from "./reference-media";

export type ReferenceAsset = ReferenceAssetSpec;
export interface ReferenceCache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  delete(url: string): Promise<boolean>;
}
export interface ReferenceStorage {
  open(name: string): Promise<ReferenceCache>;
}
export const isReferenceResponse = validReferenceResponse;

export async function referenceCacheState(
  assets: readonly ReferenceAsset[],
  storage: ReferenceStorage | undefined,
) {
  if (!storage) return { ready: false, cached: 0, available: false };
  const cache = await storage.open(REFERENCE_CACHE);
  let cached = 0;
  for (const asset of assets) {
    const response = await cache.match(asset.url);
    if (await isReferenceResponse(response, asset)) cached++;
  }
  return { ready: cached === assets.length, cached, available: true };
}

export async function saveReferenceMedia(
  assets: readonly ReferenceAsset[],
  options: {
    storage?: ReferenceStorage;
    fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
    signal?: AbortSignal;
    onProgress?: (cached: number) => void;
  },
) {
  if (!options.storage)
    throw new Error("当前环境无法保存离线示范，仍可在线查看与使用原SVG图解。");
  const cache = await options.storage.open(REFERENCE_CACHE),
    fetcher = options.fetcher ?? fetch;
  let cached = 0;
  for (const asset of assets) {
    options.signal?.throwIfAborted();
    const existing = await cache.match(asset.url);
    if (!(await isReferenceResponse(existing, asset))) {
      const response = await fetcher(asset.url, {
        cache: "reload",
        signal: options.signal,
      });
      options.signal?.throwIfAborted();
      if (!(await isReferenceResponse(response, asset)))
        throw new Error("示范文件校验失败，请保持健力宝本机服务运行后重试。");
      options.signal?.throwIfAborted();
      await cache.put(asset.url, response);
    }
    options.signal?.throwIfAborted();
    cached++;
    options.onProgress?.(cached);
  }
  return { ready: true, cached, available: true };
}

// CacheStorage alone cannot serve offline requests. An older active worker may
// also lack this media route while the current worker waits for open tabs.
export function referenceOfflineAvailable(
  controller: {
    postMessage(message: unknown, transfer: Transferable[]): void;
  } | null = typeof navigator !== "undefined" && "serviceWorker" in navigator
    ? navigator.serviceWorker.controller
    : null,
  timeoutMs = 1200,
  assets?: readonly ReferenceAsset[],
): Promise<boolean> {
  if (!controller || typeof MessageChannel === "undefined")
    return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let finished = false;
    const finish = (available: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(available);
    };
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const proof = assets?.map((asset) => [asset.url, asset.sha256]);
    channel.port1.onmessage = (event) =>
      finish(
        event.data?.type === "jianlibao-reference-ready" &&
          event.data.cache === REFERENCE_CACHE &&
          event.data.version === 1 &&
          (!proof ||
            JSON.stringify(event.data.proof) === JSON.stringify(proof)),
      );
    try {
      controller.postMessage(
        { type: "jianlibao-reference-capability", proof },
        [channel.port2],
      );
    } catch {
      finish(false);
    }
  });
}
