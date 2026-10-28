import { createHash } from 'node:crypto';

const MAX_BYTES = 4_194_600;
const headers = { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', Vary: 'Authorization, Origin' };
const response = (status, message, extra = {}) => new Response(message === null ? null : JSON.stringify(message), { status, headers: { ...headers, ...extra } });

/** Capability-authenticated encrypted document, not a public asset or an unguarded blob API.
 * No credentials, bodies or private record names are logged. */
export function createSyncHandler(openStore) {
  return async request => {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return response(403, { error: '不允许跨站访问' });
    const auth = request.headers.get('Authorization') ?? '';
    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) return response(401, { error: '需要有效的同步凭据' });
    if (!['GET', 'PUT'].includes(request.method)) return response(405, { error: '仅支持读取和同步' }, { Allow: 'GET, PUT' });
    // One opaque key per 256-bit capability. The encryption/recovery secret never reaches us.
    const key = `vault-${createHash('sha256').update(auth.slice(7)).digest('base64url')}`;
    try {
      const store = openStore();
      if (request.method === 'GET') {
        const known = request.headers.get('X-Jianlibao-Known-Revision') ?? request.headers.get('If-None-Match');
        const saved = await store.getWithMetadata(key, { type: 'json', consistency: 'strong', etag: known ?? undefined });
        if (!saved) return response(404, { error: '尚未创建同步空间' });
        const versionHeaders = { ETag: saved.etag, 'X-Jianlibao-Revision': saved.etag };
        if (known === saved.etag) {
          if (request.headers.has('X-Jianlibao-Known-Revision')) return response(200, { unchanged: true }, { ...versionHeaders, 'X-Jianlibao-Unchanged': '1' });
          return response(304, null, versionHeaders);
        }
        return response(200, saved.data, versionHeaders);
      }
      if (!request.headers.get('Content-Type')?.startsWith('application/json')) return response(415, { error: '需要 JSON 密文' });
      // CDNs reserve the standard If-* / ETag headers. Carry our opaque storage
      // version independently; conditional writes still happen atomically in Blobs.
      const wireVersion = request.headers.get('X-Jianlibao-Revision');
      const expected = wireVersion && wireVersion !== 'new' ? wireVersion : request.headers.get('If-Match');
      const create = wireVersion === 'new' || request.headers.get('If-None-Match') === '*';
      if ((!expected && !create) || (expected && create) || (expected && (expected === '*' || expected.length > 200))) return response(428, { error: '缺少安全的条件写入版本' });
      if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return response(413, { error: '同步数据过大，请导出本地备份' });
      // Bound streamed requests as well: Content-Length is not a trusted size limit.
      const reader = request.body?.getReader(); if (!reader) return response(400, { error: '缺少密文' });
      const chunks = []; let size = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); return response(413, { error: '同步数据过大' }); }
        chunks.push(part.value);
      }
      let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return response(400, { error: '密文格式无效' }); }
      if (!value || Object.keys(value).sort().join(',') !== 'ciphertext,iv,version' || value.version !== 1 || typeof value.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(value.iv) || typeof value.ciphertext !== 'string' || !/^[A-Za-z0-9_-]{22,4194400}$/.test(value.ciphertext)) return response(400, { error: '只接受受支持的加密同步文档' });
      const saved = await store.setJSON(key, value, create ? { onlyIfNew: true } : { onlyIfMatch: expected });
      if (!saved.modified) return response(409, { error: '云端已有新版本，请重新合并' });
      return response(200, { saved: true }, { ETag: saved.etag, 'X-Jianlibao-Revision': saved.etag });
    } catch {
      return response(503, { error: '云同步暂时不可用，本地记录不受影响，请稍后重试' });
    }
  };
}
