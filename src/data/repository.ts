import type { AppData } from '../domain/types';

/** Persistence boundary. save resolves only after commit and compares the stored revision atomically. */
export interface Repository {
  load(): Promise<AppData>;
  save(data: AppData, expectedRevision: number): Promise<AppData>;
  close(): Promise<void>;
}

export class StoreConflictError extends Error {
  constructor() {
    super('另一页面已保存较新数据。请重新载入最新数据后再编辑；当前输入仍保留，可先导出。');
    this.name = 'StoreConflictError';
  }
}
