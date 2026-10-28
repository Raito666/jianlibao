import { nativeSqliteDatabase, type SqliteDatabase, type SqliteTransaction } from '../data/sqlite-database';
import { migrateSqliteSchema } from '../data/sqlite-migration';
import { loadNativeRuntime } from '../platform/native';
import { normalizeSecret } from './crypto';
import { validateSnapshot, type Snapshot } from './model';
import { migrateSyncState, MissingSyncKeyError, type SyncState, type SyncConnection } from './state';

export interface SyncKeychain {
  read(options: { slot: string }): Promise<{ value: string | null }>;
  write(options: { slot: string; value: string }): Promise<void>;
  remove(options: { slot: string }): Promise<void>;
}
interface NativeMetadata { version: 1; connection: { slot: string; base: Snapshot | null; lastSuccess: string | null } | null }
export const NATIVE_SYNC_KEY = 'cloud-sync-native-v1';
const queues = new WeakMap<SqliteDatabase, Promise<unknown>>();
export function migrateNativeSyncMetadata(raw: unknown): NativeMetadata {
  if (raw === undefined) return { version: 1, connection: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('原生同步设置格式无效');
  const s = raw as NativeMetadata;
  if (s.version !== 1 || Object.keys(s).sort().join(',') !== 'connection,version') throw new Error('原生同步设置版本或字段不受支持，原设置已保留');
  if (s.connection === null) return { version: 1, connection: null };
  const c = s.connection;
  if (!c || Object.keys(c).sort().join(',') !== 'base,lastSuccess,slot' || typeof c.slot !== 'string' || !/^[a-f0-9]{64}$/.test(c.slot) || !(c.lastSuccess === null || (typeof c.lastSuccess === 'string' && Number.isFinite(Date.parse(c.lastSuccess))))) throw new Error('原生同步密钥引用或字段无效');
  return { version: 1, connection: { slot: c.slot, base: c.base === null ? null : validateSnapshot(c.base), lastSuccess: c.lastSuccess } };
}
async function slotFor(secret: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`jianlibao:keychain:v1:${normalizeSecret(secret)}`));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function metadata(tx: SqliteTransaction) {
  await migrateSqliteSchema(tx);
  const rows = await tx.query('SELECT value FROM storage_meta WHERE key=?', [NATIVE_SYNC_KEY]);
  if (rows.length > 1 || (rows.length && typeof rows[0].value !== 'string')) throw new Error('原生同步元数据无效');
  return migrateNativeSyncMetadata(rows.length ? JSON.parse(rows[0].value as string) : undefined);
}
/** Keychain copy-on-write + confirmed SQLite reference commit. Never store a secret
 * in SQLite or delete the previous key before the new reference is durable. */
export class NativeSyncStore {
  constructor(private readonly db: SqliteDatabase = nativeSqliteDatabase,
    private readonly load: () => Promise<{ vault: SyncKeychain }> = async () => ({ vault: (await loadNativeRuntime()).syncKeychain })) {}
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = (queues.get(this.db) ?? Promise.resolve()).then(work);
    queues.set(this.db, result.catch(() => undefined)); return result;
  }
  read(): Promise<SyncState> {
    return this.enqueue(() => this.db.transaction(async tx => {
      const saved = await metadata(tx); if (!saved.connection) return { version: 1, connection: null };
      const { vault } = await this.load(), { value } = await vault.read({ slot: saved.connection.slot });
      if (value === null) throw new MissingSyncKeyError();
      const secret = normalizeSecret(value);
      if (await slotFor(secret) !== saved.connection.slot) throw new Error('同步密钥与本机引用不一致，原记录已保留');
      return migrateSyncState({ version: 1, connection: { secret, base: saved.connection.base, lastSuccess: saved.connection.lastSuccess } });
    }));
  }
  private save(choose: (saved: NativeMetadata) => Promise<SyncState>): Promise<SyncState> {
    return this.enqueue(async () => {
      let previousSlot: string | null = null;
      let nextSlot: string | null = null;
      let validated!: SyncState;
      await this.db.transaction(async tx => {
        const saved = await metadata(tx);
        previousSlot = saved.connection?.slot ?? null;
        validated = migrateSyncState(await choose(saved));
        const next: NativeMetadata = { version: 1, connection: validated.connection ? { slot: await slotFor(validated.connection.secret), base: validated.connection.base, lastSuccess: validated.connection.lastSuccess } : null };
        nextSlot = next.connection?.slot ?? null;
        if (validated.connection && next.connection) {
          const { vault } = await this.load(), { value } = await vault.read({ slot: next.connection.slot });
          if (value !== validated.connection.secret) await vault.write({ slot: next.connection.slot, value: validated.connection.secret });
        }
        await tx.run('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)', [NATIVE_SYNC_KEY, JSON.stringify(next)]);
      });
      // A failed/ambiguous commit retains both keys for recovery. Only clean up
      // after confirmed commit; a cleanup failure must not reconnect the device.
      if (previousSlot && previousSlot !== nextSlot) {
        try { await (await this.load()).vault.remove({ slot: previousSlot }); } catch { /* Orphan remains protected in Keychain, never referenced or exported. */ }
      }
      return validated;
    });
  }
  async write(state: SyncState): Promise<void> { await this.save(async () => state); }
  async connect(secret: string): Promise<SyncConnection> {
    const normalized = normalizeSecret(secret);
    const result = await this.save(async saved => {
      const old = saved.connection, same = old?.slot === await slotFor(normalized);
      return { version: 1, connection: { secret: normalized, base: same ? old!.base : null, lastSuccess: same ? old!.lastSuccess : null } };
    });
    return result.connection!;
  }
}
export const nativeSyncStore = new NativeSyncStore();
