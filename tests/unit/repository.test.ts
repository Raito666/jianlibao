import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepository, StoreConflictError } from '../../src/data';
import type { Repository } from '../../src/data/repository';
import { closeStore, loadData, saveData, StoreConflictError as LegacyConflictError } from '../../src/data/store';
import { exportBackup, parseBackup } from '../../src/data/backup';

const repositories: Repository[] = [];
function open(): Repository {
  const repository = createRepository();
  repositories.push(repository);
  return repository;
}
async function closeAll() {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
  await closeStore();
}
beforeEach(async () => {
  await closeAll();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('jianlibao');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeAll();
});

describe('Web Repository contract', () => {
  it('shares the existing database and conflict identity with legacy callers', async () => {
    const legacy = await loadData();
    const repository = open();
    expect(await repository.load()).toEqual(legacy);
    const saved = await repository.save({ ...legacy, onboarded: true }, legacy.revision);
    expect(await loadData()).toEqual(saved);
    expect(StoreConflictError).toBe(LegacyConflictError);
    await expect(saveData(legacy, legacy.revision)).rejects.toBeInstanceOf(StoreConflictError);
    const legacySaved = await saveData({ ...saved, settings: { ...saved.settings, unit: 'lb' } }, saved.revision);
    expect(await repository.load()).toEqual(legacySaved);
  });

  it('initializes one workspace across independently created adapters', async () => {
    const [first, second] = await Promise.all([open().load(), open().load()]);
    expect(second).toEqual(first);
    expect(first.revision).toBe(0);
    expect(first.sessions).toEqual([]);
    expect(first.exercises).toHaveLength(302);
  });

  it('allows exactly one simultaneous cross-adapter write without losing the winning data', async () => {
    const first = open(),
      second = open();
    const initial = await first.load();
    const results = await Promise.allSettled([
      first.save({ ...initial, onboarded: true }, initial.revision),
      second.save({ ...initial, settings: { ...initial.settings, theme: 'light' } }, initial.revision),
    ]);
    const winners = results.filter((item) => item.status === 'fulfilled');
    const losers = results.filter((item) => item.status === 'rejected');
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].reason).toBeInstanceOf(StoreConflictError);
    expect(await first.load()).toEqual(winners[0].value);
    expect(await second.load()).toEqual(winners[0].value);
    expect((await second.load()).revision).toBe(initial.revision + 1);
  });

  it('preserves committed data and backup structure through repeated close and reopen', async () => {
    const repository = open();
    const initial = await repository.load();
    const incoming = parseBackup(exportBackup({ ...initial, onboarded: true }));
    const saved = await repository.save(incoming, initial.revision);
    await repository.close();
    await repository.close();
    expect(await repository.load()).toEqual(saved);
    expect(parseBackup(exportBackup(await repository.load()))).toEqual({ ...saved, revision: 0 });
    const backup = JSON.parse(exportBackup(saved));
    expect(Object.keys(backup).sort()).toEqual(['app', 'data', 'exportedAt', 'formatVersion']);
    expect(backup.formatVersion).toBe(2);
    expect(backup.data.schemaVersion).toBe(2);
  });

  it('does not close another adapter or abort an already-started save', async () => {
    const first = open(),
      second = open();
    const initial = await first.load();
    await second.load();
    const saving = first.save({ ...initial, onboarded: true }, initial.revision);
    await first.close();
    const saved = await saving;
    expect(await second.load()).toEqual(saved);
    expect(await first.load()).toEqual(saved);
  });

  it('rejects invalid revisions and unknown fields without changing stored data', async () => {
    const repository = open();
    const initial = await repository.load();
    await expect(repository.save(initial, -1)).rejects.toThrow('本地数据版本无效');
    await expect(repository.save(initial, 0.5)).rejects.toThrow('本地数据版本无效');
    const unknown = { ...initial, unexpected: true };
    await expect(repository.save(unknown, initial.revision)).rejects.toThrow();
    expect(await repository.load()).toEqual(initial);
  });

  it('retains the previous committed workspace after a failed adapter write', async () => {
    const repository = open();
    const initial = await repository.load();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('No room', 'QuotaExceededError');
    });
    await expect(repository.save({ ...initial, onboarded: true }, initial.revision)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
    await repository.close();
    expect(await open().load()).toEqual(initial);
  });
});
