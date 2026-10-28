import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeStore, loadData, saveData, StoreConflictError } from '../../src/data/store';

async function deleteDatabase(): Promise<void> {
  await closeStore();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('jianlibao');
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
}
beforeEach(deleteDatabase);
afterEach(async () => { vi.restoreAllMocks(); await closeStore(); });

describe('IndexedDB atomic workspace', () => {
  it('initializes exactly one empty-history workspace even for simultaneous first reads', async () => {
    const [first, second] = await Promise.all([loadData(), loadData()]);
    expect(first).toEqual(second); expect(first.revision).toBe(0);
    expect(first.sessions).toEqual([]); expect(first.exercises).toHaveLength(302);
  });
  it('resolves only committed values and survives closing the connection', async () => {
    const first = await loadData(); first.onboarded = true;
    const saved = await saveData(first, first.revision);
    expect(saved.revision).toBe(1); expect(first.revision).toBe(0);
    await closeStore();
    expect(await loadData()).toEqual(saved);
  });
  it('upgrades a 12-entry workspace once, preserves personal text and rejects a pre-upgrade writer', async () => {
    const initial = await loadData();
    initial.exercises = initial.exercises.slice(0, 12);
    initial.exercises[0].description = '我的旧版器械提示';
    initial.settings.favoriteExerciseIds = ['ex-squat'];
    const old = await saveData(initial, 0);
    await closeStore();
    const upgraded = await loadData();
    expect(upgraded.exercises).toHaveLength(302);
    expect(upgraded.exercises[0].description).toBe('我的旧版器械提示');
    expect(upgraded.settings).toEqual(old.settings);
    expect(upgraded.revision).toBe(old.revision + 1);
    expect(await loadData()).toEqual(upgraded);
    await expect(saveData(old, old.revision)).rejects.toBeInstanceOf(StoreConflictError);
  });
  it('rejects stale page saves rather than replacing the newer committed workspace', async () => {
    const first = await loadData(); const stale = structuredClone(first);
    const saved = await saveData({ ...first, onboarded: true }, 0);
    await expect(saveData({ ...stale, settings: { ...stale.settings, theme: 'light' } }, 0)).rejects.toBeInstanceOf(StoreConflictError);
    expect(await loadData()).toEqual(saved);
  });
  it('serializes simultaneous compare-and-swap writes so only one revision wins', async () => {
    const initial = await loadData();
    const results = await Promise.allSettled([saveData({ ...initial, onboarded: true }, 0), saveData({ ...initial, settings: { ...initial.settings, unit: 'lb' } }, 0)]);
    expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((item) => item.status === 'rejected')).toHaveLength(1);
    expect((await loadData()).revision).toBe(1);
  });
  it('never replaces existing data after a quota failure or transaction abort', async () => {
    const initial = await loadData();
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function () { throw new DOMException('No room', 'QuotaExceededError'); });
    await expect(saveData({ ...initial, onboarded: true }, 0)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    spy.mockRestore();
    expect(await loadData()).toEqual(initial);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore) { this.transaction.abort(); return {} as IDBRequest; });
    await expect(saveData({ ...initial, onboarded: true }, 0)).rejects.toThrow('事务中止');
    vi.restoreAllMocks();
    expect(await loadData()).toEqual(initial);
  });
  it('rejects a malformed update before opening a write and preserves the original', async () => {
    const initial = await loadData();
    await expect(saveData({ ...initial, schemaVersion: 99 } as unknown as typeof initial, 0)).rejects.toThrow('版本');
    expect(await loadData()).toEqual(initial);
  });
  it('reports unknown persisted schemas without silently clearing or reseeding them', async () => {
    const initial = await loadData(); await closeStore();
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('jianlibao', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put({ ...initial, schemaVersion: 99 }, 'main'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    db.close();
    await expect(loadData()).rejects.toThrow('不支持的数据版本');
    await expect(loadData()).rejects.toThrow('不支持的数据版本');
  });
});
