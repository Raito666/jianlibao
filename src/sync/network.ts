import { isIos, loadNativeRuntime } from '../platform/native';

export const NATIVE_CLOUD_URL = 'https://jianlibao-training-raitox.netlify.app/.netlify/functions/sync';
interface CloudRequest { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }
interface NativeHttp {
  request(options: { url: string; method: string; headers: Record<string, string>; data?: string; responseType: 'text'; disableRedirects: boolean; connectTimeout: number; readTimeout: number }): Promise<{ status: number; url: string; headers: Record<string, string>; data: unknown }>;
}
export function createNativeCloudRequest(load: () => Promise<{ http: NativeHttp }>) {
  return async (options: CloudRequest): Promise<Response> => {
    const aborted = () => new DOMException('同步已取消', 'AbortError');
    if (options.signal.aborted) throw aborted();
    const { http } = await load();
    if (options.signal.aborted) throw aborted();
    return new Promise<Response>((resolve, reject) => {
      const stop = () => reject(aborted());
      options.signal.addEventListener('abort', stop, { once: true });
      void http.request({ url: NATIVE_CLOUD_URL, method: options.method, headers: { ...options.headers, Cookie: '' },
        ...(options.body !== undefined ? { data: options.body } : {}), responseType: 'text', disableRedirects: true, connectTimeout: 20000, readTimeout: 20000,
      }).then(result => {
        if (options.signal.aborted) { reject(aborted()); return; }
        if (result.url !== NATIVE_CLOUD_URL) throw new Error('原生同步返回了非预期地址，已拒绝');
        if (result.status >= 300 && result.status < 400 && result.status !== 304) throw new Error('云同步禁止地址跳转');
        const body = result.status === 304 || result.status === 204 ? null : typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        resolve(new Response(body, { status: result.status, headers: result.headers }));
      }).catch(reject).finally(() => options.signal.removeEventListener('abort', stop));
    });
  };
}
const nativeRequest = createNativeCloudRequest(async () => ({ http: (await loadNativeRuntime()).http }));
export function requestCloud(options: CloudRequest): Promise<Response> {
  if (isIos()) return nativeRequest(options);
  return fetch('/.netlify/functions/sync', { method: options.method, headers: options.headers, body: options.body,
    signal: options.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
}
