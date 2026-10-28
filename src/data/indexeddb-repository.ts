import type { AppData } from '../domain/types';
import { createInitialData } from '../domain/seed';
import { validateAppData } from './backup';
import { expandCatalog } from '../content/catalog';
import { StoreConflictError, type Repository } from './repository';

function transaction(db: IDBDatabase, update?: { data: AppData; expectedRevision: number }): Promise<AppData> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('workspace', 'readwrite');
    let result: AppData | undefined;
    let failure: unknown;
    const request = tx.objectStore('workspace').get('main');
    request.onsuccess = () => {
      try {
        const current = request.result === undefined ? createInitialData() : validateAppData(request.result);
        const migrating = request.result?.schemaVersion === 1;
        if (migrating) tx.objectStore('workspace').put(request.result, 'pre-schema-v2');
        if (update) {
          if (current.revision !== update.expectedRevision) throw new StoreConflictError();
          if (migrating) throw new StoreConflictError(); // A stale v1 writer must reload the upgraded workspace.
          if (current.revision >= Number.MAX_SAFE_INTEGER - 1) throw new Error('本地数据版本已达上限，请先导出备份');
          result = { ...update.data, revision: current.revision + 1 };
          tx.objectStore('workspace').put(result, 'main');
        } else {
          const expanded = expandCatalog(current);
          const changed = migrating || expanded !== current;
          if (changed && current.revision >= Number.MAX_SAFE_INTEGER - 1) throw new Error('本地数据版本已达上限，请先导出备份');
          result = changed ? { ...expanded, revision: current.revision + 1 } : current;
          if (request.result === undefined || changed) {
            tx.objectStore('workspace').put(result, 'main');
            if (migrating) {
              const check = tx.objectStore('workspace').get('main');
              check.onsuccess = () => {
                if (JSON.stringify(check.result) !== JSON.stringify(result)) {
                  failure = new Error('本地数据迁移核对失败，旧数据已保留'); tx.abort();
                }
              };
            }
          }
        }
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => (result ? resolve(result) : reject(new Error('数据库没有返回数据')));
    tx.onerror = () => {
      failure ??= tx.error ?? new Error('本地保存失败，当前输入尚未保存');
    };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('本地数据库事务中止，当前输入尚未保存'));
  });
}

/** Existing Web store: same database, key, validation and compare-and-swap transaction. */
export class IndexedDbRepository implements Repository {
  private database: Promise<IDBDatabase> | undefined;

  private openStore(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) {
          reject(new Error('当前浏览器不支持本地数据库，请使用现代浏览器'));
          return;
        }
        const request = indexedDB.open('jianlibao', 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('workspace')) request.result.createObjectStore('workspace');
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.database = undefined;
          };
          resolve(db);
        };
        request.onerror = () => {
          this.database = undefined;
          reject(request.error ?? new Error('无法打开本地数据库'));
        };
        request.onblocked = () => {
          this.database = undefined;
          reject(new Error('数据库升级被另一页面阻止，请关闭旧页面后重试'));
        };
      });
    }
    return this.database;
  }

  async load(): Promise<AppData> {
    return transaction(await this.openStore());
  }

  async save(next: AppData, expectedRevision: number): Promise<AppData> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('本地数据版本无效');
    const validated = validateAppData(next);
    return transaction(await this.openStore(), { data: validated, expectedRevision });
  }

  async close(): Promise<void> {
    const pending = this.database;
    this.database = undefined;
    if (pending) (await pending).close();
  }
}
