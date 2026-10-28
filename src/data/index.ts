import { IndexedDbRepository } from './indexeddb-repository';
import { Capacitor } from '@capacitor/core';
import type { Repository } from './repository';

/** Load the SQLite implementation only on iOS; Web retains its existing IndexedDB adapter. */
export function createRepository(): Repository {
  if (Capacitor.getPlatform() === 'ios') {
    let pending: Promise<Repository> | undefined;
    const get = () => {
      if (!pending) {
        pending = import('./sqlite-repository').then(({ SqliteRepository }) => new SqliteRepository());
        void pending.catch(() => {
          pending = undefined;
        });
      }
      return pending;
    };
    return {
      load: () => get().then((repository) => repository.load()),
      save: (data, revision) => get().then((repository) => repository.save(data, revision)),
      close: () => (pending ? pending.then((repository) => repository.close()) : Promise.resolve()),
    };
  }
  return new IndexedDbRepository();
}

export type { Repository } from './repository';
export { StoreConflictError } from './repository';
