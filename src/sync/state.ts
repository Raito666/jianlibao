import { normalizeSecret } from './crypto';
import { validateSnapshot, type Snapshot } from './model';
export interface SyncConnection { secret: string; base: Snapshot | null; lastSuccess: string | null }
export interface SyncState { version: 1; connection: SyncConnection | null }
/** Independent sync metadata schema. Existing jianlibao/workspace and backup v2 never migrate. */
export function migrateSyncState(raw: unknown): SyncState {
  if (raw === undefined) return { version: 1, connection: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('同步设置格式错误');
  const state = raw as SyncState;
  if (state.version !== 1) throw new Error('不支持的同步设置版本');
  if (Object.keys(state).sort().join(',') !== 'connection,version') throw new Error('同步设置含未知字段');
  if (state.connection === null) return { version: 1, connection: null };
  const c = state.connection;
  if (!c || Object.keys(c).sort().join(',') !== 'base,lastSuccess,secret' || !(c.lastSuccess === null || (typeof c.lastSuccess === 'string' && Number.isFinite(Date.parse(c.lastSuccess))))) throw new Error('同步连接设置无效');
  return { version: 1, connection: { secret: normalizeSecret(c.secret), base: c.base === null ? null : validateSnapshot(c.base), lastSuccess: c.lastSuccess } };
}

export class MissingSyncKeyError extends Error {
  constructor() { super("本机未找到同步密钥，请使用已保存的密钥重新连接；训练记录原样保留"); this.name = "MissingSyncKeyError"; }
}
