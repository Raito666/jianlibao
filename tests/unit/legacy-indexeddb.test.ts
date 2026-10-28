import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readLegacyWorkspace } from '../../src/data/legacy-indexeddb';
import { createInitialData } from '../../src/domain/seed';

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function seed(value: unknown, withStore = true) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('jianlibao', 1);
    request.onupgradeneeded = () => {
      if (withStore) request.result.createObjectStore('workspace');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (withStore && value !== undefined)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(value, 'main');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  db.close();
}
describe('read-only native legacy IndexedDB inspection', () => {
  it('does not leave a newly seeded database when none existed', async () => {
    expect(await readLegacyWorkspace()).toBeNull();
    expect(await indexedDB.databases()).toEqual([]);
  });
  it('reads a 12-action workspace through readonly without expanding or changing the stored bytes', async () => {
    const old = createInitialData();
    old.exercises = old.exercises.slice(0, 12);
    old.revision = 12;
    await seed(old);
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    const result = await readLegacyWorkspace();
    expect(result).toEqual(old);
    expect(spy.mock.calls.every((call) => call[1] === 'readonly')).toBe(true);
    expect(await readLegacyWorkspace()).toEqual(old);
  });
  it('distinguishes an empty existing store from invalid data', async () => {
    await seed(undefined);
    expect(await readLegacyWorkspace()).toBeNull();
  });
  it.each([null, { ...createInitialData(), schemaVersion: 99 }, { ...createInitialData(), unexpected: true }])(
    'rejects malformed stored data instead of treating it as absent',
    async (invalid) => {
      await seed(invalid);
      await expect(readLegacyWorkspace()).rejects.toThrow();
      expect(await indexedDB.databases()).toEqual([{ name: 'jianlibao', version: 1 }]);
    },
  );
  it('rejects a database missing its workspace store without replacing its schema', async () => {
    await seed(undefined, false);
    await expect(readLegacyWorkspace()).rejects.toThrow('缺少');
  });
  it('does not infer absence when the old storage API is inaccessible', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(readLegacyWorkspace()).rejects.toThrow('无法检查');
  });
});
