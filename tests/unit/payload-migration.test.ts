import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbRepository } from '../../src/data/indexeddb-repository';
import { SqliteRepository } from '../../src/data/sqlite-repository';
import { migrateSqliteSchema } from '../../src/data/sqlite-migration';
import { TestSqliteDatabase } from '../helpers/sqlite-database';
import { StoreConflictError } from '../../src/data/repository';
const legacy = () =>
  JSON.parse(readFileSync(new URL('../fixtures/legacy-v1-ui-backup.json', import.meta.url), 'utf8')).data;
const opened: IndexedDbRepository[] = [];
async function rawDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('jianlibao', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('workspace');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function rawRead(key = 'main') {
  const db = await rawDb();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('workspace');
      const r = tx.objectStore('workspace').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
async function seedIdb(value: unknown) {
  const db = await rawDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    tx.objectStore('workspace').put(value, 'main');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
}
function repository() {
  const r = new IndexedDbRepository();
  opened.push(r);
  return r;
}
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase('jianlibao');
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((r) => r.close()));
});
describe('persisted payload migration', () => {
  it('combines native payload migration and old catalog expansion in one revision', async () => {
    const db = new TestSqliteDatabase(),
      old = legacy();
    old.exercises = old.exercises.slice(0, 12);
    try {
      await db.transaction(async (tx) => {
        await migrateSqliteSchema(tx);
        await tx.run('INSERT INTO workspace (id, revision, payload) VALUES (?, ?, ?)', [
          'main',
          old.revision,
          JSON.stringify(old),
        ]);
      });
      const repo = new SqliteRepository(db, async () => null),
        upgraded = await repo.load();
      expect(upgraded.schemaVersion).toBe(2);
      expect(upgraded.exercises).toHaveLength(302);
      expect(upgraded.revision).toBe(old.revision + 1);
      expect(await repo.load()).toEqual(upgraded);
      expect(upgraded.sessions).toEqual(old.sessions);
      expect(db.handle.prepare("SELECT value FROM storage_meta WHERE key='appdata-v1-before-v2'").get()?.value).toBe(
        JSON.stringify(old),
      );
    } finally {
      await db.close();
    }
  });
  it('atomically upgrades old IndexedDB once, keeps v1 rollback bytes and rejects stale writers', async () => {
    const old = legacy();
    await seedIdb(old);
    const a = repository(),
      b = repository();
    const [first, second] = await Promise.all([a.load(), b.load()]);
    expect(first.schemaVersion).toBe(2);
    expect(first.revision).toBe(old.revision + 1);
    expect(second).toEqual(first);
    expect(await rawRead()).toEqual(first);
    expect(await rawRead('pre-schema-v2')).toEqual(old);
    expect(first.sessions).toEqual(old.sessions);
    expect(await a.load()).toEqual(first);
    await expect(b.save(first, old.revision)).rejects.toBeInstanceOf(StoreConflictError);
  });
  it.each(['quota', 'abort'])(
    'preserves both old main and absence of migration copy after %s failure',
    async (kind) => {
      const old = legacy();
      await seedIdb(old);
      const original = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
        const result = original.call(this, value, key!);
        if (key === 'main') {
          if (kind === 'quota') throw new DOMException('No room', 'QuotaExceededError');
          this.transaction.abort();
        }
        return result;
      });
      await expect(repository().load()).rejects.toThrow();
      vi.restoreAllMocks();
      expect(await rawRead()).toEqual(old);
      expect(await rawRead('pre-schema-v2')).toBeUndefined();
      expect((await repository().load()).schemaVersion).toBe(2);
    },
  );
  it('leaves future and malformed stored versions untouched', async () => {
    for (const old of [
      { ...legacy(), schemaVersion: 99 },
      { ...legacy(), unexpected: 1 },
    ]) {
      await seedIdb(old);
      await expect(repository().load()).rejects.toThrow();
      expect(await rawRead()).toEqual(old);
    }
  });
  it.each(['success', 'write-failure', 'commit-failure'])(
    'migrates existing native v1 payload with its old marker: %s',
    async (kind) => {
      const db = new TestSqliteDatabase(),
        old = legacy(),
        text = JSON.stringify(old);
      try {
        await db.transaction(async (tx) => {
          await migrateSqliteSchema(tx);
          await tx.run('INSERT INTO workspace (id, revision, payload) VALUES (?, ?, ?)', ['main', old.revision, text]);
          await tx.run('INSERT INTO storage_meta (key, value) VALUES (?, ?)', [
            'legacy-indexeddb-v1',
            JSON.stringify({ version: 1, complete: true, source: 'indexeddb', revision: old.revision }),
          ]);
        });
        const readLegacy = vi.fn().mockResolvedValue(null),
          repo = new SqliteRepository(db, readLegacy);
        if (kind === 'write-failure') db.failOn = 'UPDATE workspace';
        if (kind === 'commit-failure') db.failCommit = true;
        if (kind !== 'success') {
          await expect(repo.load()).rejects.toThrow('injected');
          expect(db.handle.prepare('SELECT payload FROM workspace').get()?.payload).toBe(text);
          expect(
            db.handle.prepare("SELECT value FROM storage_meta WHERE key='appdata-v1-before-v2'").get(),
          ).toBeUndefined();
        }
        const upgraded = await repo.load();
        expect(upgraded.schemaVersion).toBe(2);
        expect(upgraded.revision).toBe(old.revision + 1);
        expect(upgraded.sessions).toEqual(old.sessions);
        expect(await repo.load()).toEqual(upgraded);
        expect(readLegacy).not.toHaveBeenCalled();
        expect(db.handle.prepare("SELECT value FROM storage_meta WHERE key='appdata-v1-before-v2'").get()?.value).toBe(
          text,
        );
        expect(JSON.parse(String(db.handle.prepare('SELECT payload FROM workspace').get()?.payload))).toEqual(upgraded);
        await expect(repo.save(upgraded, old.revision)).rejects.toBeInstanceOf(StoreConflictError);
        expect(db.handle.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
      } finally {
        await db.close();
      }
    },
  );
});
