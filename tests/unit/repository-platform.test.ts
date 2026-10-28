import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { createRepository } from '../../src/data';
import { IndexedDbRepository } from '../../src/data/indexeddb-repository';

afterEach(() => vi.restoreAllMocks());
describe('platform persistence selection', () => {
  it('retains the actual IndexedDB implementation for Web', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');
    const repository = createRepository();
    expect(repository).toBeInstanceOf(IndexedDbRepository);
    await repository.close();
  });
  it('defers all native work until load/save and does not create an IndexedDB fallback', async () => {
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    const spy = vi.spyOn(indexedDB, 'open'),
      repository = createRepository();
    expect(repository).not.toBeInstanceOf(IndexedDbRepository);
    await repository.close();
    expect(spy).not.toHaveBeenCalled();
    await expect(repository.load()).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
