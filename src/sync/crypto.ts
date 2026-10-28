import { validateSnapshot, type Snapshot } from './model';
export interface Envelope { version: 1; iv: string; ciphertext: string }
const encoder = new TextEncoder();
export const MAX_CLEAR_BYTES = 3 * 1024 * 1024;
function b64(bytes: Uint8Array): string {
  let text = ''; for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unb64(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('同步密钥或密文格式无效');
  return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
export function createSecret(): string { return `JLB1-${b64(crypto.getRandomValues(new Uint8Array(32)))}`; }
export function normalizeSecret(secret: string): string {
  const key = secret.trim();
  if (!/^JLB1-[A-Za-z0-9_-]{43}$/.test(key) || b64(unb64(key.slice(5))) !== key.slice(5)) throw new Error('同步密钥格式不正确，请粘贴完整的 JLB1- 密钥');
  return key;
}
async function digest(text: string) { return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))); }
export async function credentials(secret: string) {
  const normalized = normalizeSecret(secret), token = b64(await digest(`jianlibao:auth:v1:${normalized}`));
  return { token, id: b64(await digest(token)) };
}
async function key(secret: string) {
  return crypto.subtle.importKey('raw', await digest(`jianlibao:encryption:v1:${normalizeSecret(secret)}`), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
const additionalData = encoder.encode('jianlibao-sync-v1');
export async function encryptSnapshot(secret: string, snapshot: Snapshot): Promise<Envelope> {
  const clear = encoder.encode(JSON.stringify(validateSnapshot(snapshot)));
  if (clear.byteLength > MAX_CLEAR_BYTES) throw new Error('同步记录超过 3 MB，请继续使用本地备份；本地数据未改动');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { version: 1, iv: b64(iv), ciphertext: b64(new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, await key(secret), clear))) };
}
export async function decryptSnapshot(secret: string, value: unknown): Promise<Snapshot> {
  const e = value as Envelope;
  if (!e || e.version !== 1 || Object.keys(e).sort().join(',') !== 'ciphertext,iv,version' || typeof e.iv !== 'string' || e.iv.length !== 16 || typeof e.ciphertext !== 'string' || e.ciphertext.length > 4_194_400) throw new Error('云端密文格式或版本无效，本地记录已保留');
  try {
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv), additionalData }, await key(secret), unb64(e.ciphertext));
    return validateSnapshot(JSON.parse(new TextDecoder().decode(clear)));
  } catch { throw new Error('无法解密云端记录，请核对同步密钥或更新应用；本地数据未改动'); }
}
