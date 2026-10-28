import { validateAppData } from './backup';

/** Read the old workspace without seeding, expanding, clearing or updating it. */
export function readLegacyWorkspace(): Promise<unknown | null> {
  if (!globalThis.indexedDB)
    return Promise.reject(new Error('无法检查旧数据库，迁移尚未开始；请恢复本地存储访问后重试'));
  return new Promise((resolve, reject) => {
    let absent = false;
    let settled = false;
    const finish = (value: unknown | null) => {
      settled = true;
      resolve(value);
    };
    const fail = (error: unknown) => {
      settled = true;
      reject(error);
    };
    const request = indexedDB.open('jianlibao', 1);
    request.onupgradeneeded = (event) => {
      // An aborted first-open upgrade leaves no newly seeded database behind.
      absent = event.oldVersion === 0;
      request.transaction?.abort();
    };
    request.onerror = () => {
      if (absent) finish(null);
      else fail(request.error ?? new Error('无法读取旧数据库，原数据已保留'));
    };
    request.onblocked = () => fail(new Error('旧数据库被另一页面阻止，请关闭旧页面后重试；原数据已保留'));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        db.close();
        return;
      }
      if (!db.objectStoreNames.contains('workspace')) {
        db.close();
        fail(new Error('旧数据库缺少训练存储，原数据已保留'));
        return;
      }
      const tx = db.transaction('workspace', 'readonly');
      const get = tx.objectStore('workspace').get('main');
      let value: unknown;
      get.onsuccess = () => {
        value = get.result;
      };
      tx.oncomplete = () => {
        db.close();
        try {
          finish(value === undefined ? null : validateAppData(value));
        } catch (error) {
          fail(error);
        }
      };
      tx.onabort = () => {
        db.close();
        fail(tx.error ?? new Error('旧数据库读取中止，原数据已保留'));
      };
    };
  });
}
