import type { AppData } from '../domain/types';
import { applySnapshot, canonical, emptySnapshot, mergeSnapshots, sameSnapshot, sameDocument, snapshotOf, validateSnapshot, type Snapshot, type SyncConflict } from './model';
import type { SyncConnection } from './store';
export interface Decisions { [key: string]: { choice: 'local' | 'remote'; local: unknown; remote: unknown } }
export interface SyncAdapter {
  getLocal(): AppData;
  apply(fn: (latest: AppData) => AppData): Promise<boolean>;
  pull(): Promise<{ snapshot: Snapshot | null; etag: string | null }>;
  push(snapshot: Snapshot, etag: string | null): Promise<string | null>;
  active(): boolean;
}
export async function synchronize(connection: SyncConnection, adapter: SyncAdapter, decisions: Decisions = {}): Promise<{ conflicts: SyncConflict[]; connection?: SyncConnection }> {
  const check = () => { if (!adapter.active()) throw new Error('云同步已断开，本地数据仍保留'); };
  for (let attempt = 0; attempt < 3; attempt++) {
    check(); const remote = await adapter.pull(); check();
    if (!remote.snapshot && connection.base !== null) throw new Error('原有云端记录不存在，已停止同步以保护本机记录。请导出备份后重新连接。');
    const local = snapshotOf(adapter.getLocal()), cloud = remote.snapshot ?? emptySnapshot();
    const initial = mergeSnapshots(connection.base ?? emptySnapshot(), local, cloud);
    const choices: Record<string, 'local' | 'remote'> = {};
    for (const conflict of initial.conflicts) {
      const decision = decisions[conflict.key];
      if (decision && canonical(decision.local) === canonical(conflict.local) && canonical(decision.remote) === canonical(conflict.remote)) choices[conflict.key] = decision.choice;
    }
    const result = mergeSnapshots(connection.base ?? emptySnapshot(), local, cloud, choices);
    if (result.conflicts.length) return { conflicts: result.conflicts };
    const merged = validateSnapshot(result.snapshot);
    // Validate against local drafts before publishing anything.
    applySnapshot(adapter.getLocal(), merged);
    if (!remote.snapshot || !sameDocument(merged, cloud)) {
      check(); const etag = await adapter.push(merged, remote.etag); check();
      if (!etag) continue;
    }
    if (!sameSnapshot(snapshotOf(adapter.getLocal()), merged)) {
      check();
      const saved = await adapter.apply(latest => {
        check();
        // Editing may continue while the request is in flight. Preserve those newer edits.
        const late = mergeSnapshots(local, snapshotOf(latest), merged);
        if (late.conflicts.length) throw new Error('本机记录在同步期间发生变化，已保留输入，请重试同步');
        return applySnapshot(latest, late.snapshot);
      });
      if (!saved) throw new Error('云端已接收，但本地保存未成功；请先处理本地保存错误，再同步');
    }
    check();
    return { conflicts: [], connection: { ...connection, base: merged, lastSuccess: new Date().toISOString() } };
  }
  throw new Error('其他设备持续更新记录，本机修改已保留，请稍后重试同步');
}
