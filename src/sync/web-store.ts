import { migrateSyncState, type SyncState } from './state';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('jianlibao-sync', 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('metadata'); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('同步设置被其他页面占用，请关闭旧页面后重试'));
  });
}
export async function readSyncState(): Promise<SyncState> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('metadata', 'readonly'), read = tx.objectStore('metadata').get('connection');
    tx.oncomplete = () => { db.close(); try { resolve(migrateSyncState(read.result)); } catch (e) { reject(e); } };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function writeSyncState(state: SyncState): Promise<void> {
  const validated = migrateSyncState(state), db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('metadata', 'readwrite'); tx.objectStore('metadata').put(validated, 'connection');
    tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('同步设置保存失败')); };
  });
}
