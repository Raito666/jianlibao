import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestSqliteDatabase } from '../helpers/sqlite-database';
import { SqliteRepository } from '../../src/data/sqlite-repository';
import { exportBackup, parseBackup, validateAppData } from '../../src/data/backup';
import { createSecret } from '../../src/sync/crypto';
import { emptySnapshot } from '../../src/sync/model';
import { synchronize } from '../../src/sync/engine';
import { NativeSyncStore, migrateNativeSyncMetadata, NATIVE_SYNC_KEY } from '../../src/sync/native-store';
import { MissingSyncKeyError } from '../../src/sync/state';

const databases: TestSqliteDatabase[] = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.close(); });
function setup() {
  const db = new TestSqliteDatabase(); databases.push(db);
  const secrets = new Map<string, string>();
  const vault = {
    read: vi.fn(async ({ slot }: { slot: string }) => ({ value: secrets.get(slot) ?? null })),
    write: vi.fn(async ({ slot, value }: { slot: string; value: string }) => { secrets.set(slot, value); }),
    remove: vi.fn(async ({ slot }: { slot: string }) => { secrets.delete(slot); }),
  };
  const store = new NativeSyncStore(db, async () => ({ vault }));
  return { db, secrets, vault, store };
}
const connected = () => ({ version: 1 as const, connection: { secret: createSecret(), base: emptySnapshot(), lastSuccess: '2026-10-26T12:00:00.000Z' } });
describe('native sync metadata / Keychain + existing SQLite', () => {
  it('migrates absence without changing business records or creating a secret', async () => {
    const s = setup(), original = await new SqliteRepository(s.db, async () => null).load();
    expect(migrateNativeSyncMetadata(undefined)).toEqual({ version: 1, connection: null });
    expect(await s.store.read()).toEqual({ version: 1, connection: null });
    expect(s.vault.read).not.toHaveBeenCalled(); expect(s.vault.write).not.toHaveBeenCalled();
    expect(await new SqliteRepository(s.db).load()).toEqual(original);
    expect(s.db.handle.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
  });
  it('persists only a Keychain reference and recovers through an independent store instance', async () => {
    const s = setup(), state = connected(); await s.store.write(state);
    expect(await new NativeSyncStore(s.db, async () => ({ vault: s.vault })).read()).toEqual(state);
    const raw = String(s.db.handle.prepare('SELECT value FROM storage_meta WHERE key=?').get(NATIVE_SYNC_KEY)?.value);
    expect(raw).not.toContain(state.connection.secret); expect(raw).not.toContain('"secret"');
    expect(JSON.parse(raw).connection.slot).toMatch(/^[a-f0-9]{64}$/);
  });
  it('does not rewrite a Keychain secret while saving another common base', async () => {
    const s = setup(), state = connected(); await s.store.write(state);
    await s.store.write({ ...state, connection: { ...state.connection, lastSuccess: null } });
    expect(s.vault.write).toHaveBeenCalledTimes(1);
  });
  it('keeps the previous connection after a Keychain write fails', async () => {
    const s = setup(), first = connected(); await s.store.write(first);
    s.vault.write.mockRejectedValueOnce(new Error('Keychain locked'));
    await expect(s.store.write(connected())).rejects.toThrow('Keychain locked');
    expect(await s.store.read()).toEqual(first);
  });
  it('keeps the previous secret/reference when SQLite commit fails and permits retry', async () => {
    const s = setup(), first = connected(), next = connected(); await s.store.write(first);
    s.db.failCommit = true; await expect(s.store.write(next)).rejects.toThrow('commit failure');
    expect(await s.store.read()).toEqual(first); expect([...s.secrets.values()]).toContain(first.connection.secret);
    await s.store.write(next); expect(await s.store.read()).toEqual(next);
    expect([...s.secrets.values()]).not.toContain(first.connection.secret);
  });
  it('does not disconnect or erase a secret if the disconnect commit fails', async () => {
    const s = setup(), first = connected(); await s.store.write(first); s.db.failCommit = true;
    await expect(s.store.write({ version: 1, connection: null })).rejects.toThrow();
    expect(await s.store.read()).toEqual(first);
    await s.store.write({ version: 1, connection: null }); expect(await s.store.read()).toEqual({ version: 1, connection: null });
    expect(s.secrets.size).toBe(0);
  });
  it('fails closed on locked, missing or mismatched keys without clearing metadata', async () => {
    const s = setup(), first = connected(); await s.store.write(first);
    s.vault.read.mockRejectedValueOnce(new Error('device locked')); await expect(s.store.read()).rejects.toThrow('device locked');
    const slot = [...s.secrets.keys()][0]; s.secrets.delete(slot);
    await expect(s.store.read()).rejects.toBeInstanceOf(MissingSyncKeyError);
    s.secrets.set(slot, createSecret()); await expect(s.store.read()).rejects.toThrow(/不一致/);
    expect(s.db.handle.prepare('SELECT value FROM storage_meta WHERE key=?').get(NATIVE_SYNC_KEY)).toBeDefined();
  });
  it('rejects future/unknown/plaintext metadata instead of overwriting it', () => {
    for (const raw of [{ version: 2, connection: null }, { version: 1, connection: null, extra: 1 }, connected()]) {
      expect(() => migrateNativeSyncMetadata(raw)).toThrow();
    }
  });
  it('keeps normal backups compatible and free of both native references and secrets', async () => {
    const s = setup(), repository = new SqliteRepository(s.db, async () => null), data = await repository.load(), state = connected();
    await s.store.write(state);
    const text = exportBackup(await repository.load()); expect(text).not.toContain(state.connection.secret); expect(text).not.toContain('slot');
    expect(parseBackup(text)).toEqual(data);
    expect(() => validateAppData({ ...data, nativeSync: {} })).toThrow(/未知字段/);
  });
  it.each([false, true])('restores the same key without losing deletion baseline (remote edited: %s)', async edited => {
    const s = setup(), repository = new SqliteRepository(s.db, async () => null), data = await repository.load();
    const original = { id: 'body-one', date: '2026-10-26', weightKg: 70, note: 'before' };
    const base = { ...emptySnapshot(), exercises: data.exercises, templates: data.templates, bodyMetrics: [original] };
    const state = connected(); state.connection.base = base; await s.store.write(state); s.secrets.clear();
    await expect(s.store.read()).rejects.toBeInstanceOf(MissingSyncKeyError);
    const recovered = await s.store.connect(state.connection.secret);
    expect(recovered.base).toEqual(base); expect(recovered.lastSuccess).toBe(state.connection.lastSuccess);
    let local = data;
    const push = vi.fn(async () => '"next"');
    const result = await synchronize(recovered, {
      getLocal: () => local, apply: async fn => { local = fn(local); return true; }, active: () => true,
      pull: async () => ({ snapshot: { ...base, bodyMetrics: [{ ...original, weightKg: edited ? 72 : 70 }] }, etag: '"old"' }), push,
    });
    if (edited) { expect(result.conflicts).toHaveLength(1); expect(push).not.toHaveBeenCalled(); }
    else { expect(result.conflicts).toEqual([]); expect(push).toHaveBeenCalledWith(expect.objectContaining({ bodyMetrics: [], tombstones: ['bodyMetrics:2026-10-26'] }), '"old"'); }
    expect(local.bodyMetrics).toEqual([]);
  });
  it('resets the base when connecting a different space', async () => {
    const s = setup(), state = connected(); await s.store.write(state);
    const other = createSecret(), connection = await s.store.connect(other);
    expect(connection).toEqual({ secret: other, base: null, lastSuccess: null });
    expect(await s.store.read()).toEqual({ version: 1, connection });
    expect([...s.secrets.values()]).toEqual([other]);
  });
});
