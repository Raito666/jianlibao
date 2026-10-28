import { credentials, decryptSnapshot, encryptSnapshot } from './crypto';
import type { Snapshot } from './model';
import { requestCloud } from './network';

export function cloudTransport(secret: string, signal?: AbortSignal) {
  let cached: { snapshot: Snapshot; etag: string } | null = null;
  async function request(method: string, body?: unknown, extra: Record<string, string> = {}) {
    const { token } = await credentials(secret);
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 20000);
    const stop = () => timeout.abort(); signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) timeout.abort();
    try {
      const response = await requestCloud({ method, signal: timeout.signal,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      // Include response-body transfer in the timeout, not only receipt of headers.
      const bytes = response.status === 304 ? null : await response.arrayBuffer();
      return new Response(bytes, { status: response.status, headers: response.headers });
    } catch { throw new Error('云同步连接中断或超时，记录已保存在本机。联网后可重试'); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  }
  return {
    async pull() {
      const response = await request('GET', undefined, cached ? { 'X-Jianlibao-Known-Revision': cached.etag } : {});
      if (response.status === 404) return { snapshot: null, etag: null };
      if (response.status === 304 && cached) return cached;
      if (!response.ok) throw new Error(response.status === 429 ? '同步请求较频繁，请一分钟后重试，本地记录不受影响' : '云端暂不可用，本地记录不受影响，请稍后重试');
      if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Error('当前地址未提供云同步接口，请在固定网页版使用云同步；本地记录未改动');
      const etag = response.headers.get('X-Jianlibao-Revision') ?? response.headers.get('ETag'); if (!etag) throw new Error('云端未提供安全版本，已停止同步');
      if (response.headers.get('X-Jianlibao-Unchanged') === '1') {
        if (!cached || cached.etag !== etag) throw new Error('云端缓存版本不一致，已停止同步以保护本地记录');
        return cached;
      }
      cached = { snapshot: await decryptSnapshot(secret, await response.json()), etag };
      return cached;
    },
    async push(snapshot: Snapshot, etag: string | null) {
      const envelope = await encryptSnapshot(secret, snapshot);
      const response = await request('PUT', envelope, { 'X-Jianlibao-Revision': etag ?? 'new' });
      if (response.status === 409) { cached = null; return null; }
      if (!response.ok) throw new Error(response.status === 413 ? '同步记录超过云端大小上限，请导出本地备份' : '云端保存失败，本地记录已保留，请稍后重试');
      const saved = response.headers.get('X-Jianlibao-Revision') ?? response.headers.get('ETag'); if (!saved) throw new Error('云端保存版本无效，请重新同步');
      cached = { snapshot, etag: saved }; return saved;
    },
  };
}
