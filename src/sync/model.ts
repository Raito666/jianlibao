import type { AppData } from '../domain/types';
import { validateAppData, validateSharedCollections } from '../data/backup';

const collections = ['exercises', 'templates', 'sessions', 'bodyMetrics'] as const;
export type Snapshot = Pick<AppData, typeof collections[number]> & { version: 1; tombstones: string[] };
export type Resolution = Record<string, 'local' | 'remote'>;
export interface SyncConflict { key: string; name: string; local: unknown; remote: unknown }
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function emptySnapshot(): Snapshot { return { version: 1, exercises: [], templates: [], sessions: [], bodyMetrics: [], tombstones: [] }; }
export function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('云同步数据格式无效');
  const { version, tombstones = [], ...rest } = value as Record<string, unknown>;
  if (version !== 1) throw new Error('不支持的云同步数据版本，请更新应用');
  if (!Array.isArray(tombstones) || tombstones.length > 100000 || tombstones.some(k => typeof k !== 'string' || !/^(?:(?:exercises|templates|sessions):[A-Za-z0-9][A-Za-z0-9._:-]{0,119}|bodyMetrics:\d{4}-\d{2}-\d{2})$/.test(k)) || new Set(tombstones).size !== tombstones.length) throw new Error('云端删除标记无效');
  const parsed = validateSharedCollections(rest);
  const erased = new Set(tombstones);
  if (collections.some(c => parsed[c].some(item => erased.has(`${c}:${keyOf(c, item)}`)))) throw new Error('云端记录同时标记为保留和删除，请核对同步文档');
  return { version: 1, ...parsed, tombstones: [...tombstones].sort() };
}
export function snapshotOf(data: AppData): Snapshot {
  return { version: 1, tombstones: [], exercises: data.exercises, templates: data.templates, bodyMetrics: data.bodyMetrics,
    sessions: data.sessions.filter(s => s.status === 'completed' || s.status === 'cancelled') };
}
export function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return collections.every(c => canonical([...a[c]].sort((x, y) => keyOf(c, x).localeCompare(keyOf(c, y)))) === canonical([...b[c]].sort((x, y) => keyOf(c, x).localeCompare(keyOf(c, y)))));
}
export function sameDocument(a: Snapshot, b: Snapshot): boolean {
  return sameSnapshot(a, b) && canonical([...a.tombstones].sort()) === canonical([...b.tombstones].sort());
}
function keyOf(collection: typeof collections[number], item: { id: string; date?: string }): string {
  return collection === 'bodyMetrics' ? item.date! : item.id;
}
export function mergeSnapshots(base: Snapshot, local: Snapshot, remote: Snapshot, resolutions: Resolution = {}) {
  const snapshot = emptySnapshot(), conflicts: SyncConflict[] = [];
  const deleted = Symbol('deleted');
  const equal = (a: unknown, b: unknown) => a === deleted || b === deleted ? a === b : canonical(a) === canonical(b);
  const tombstones = [base, local, remote].map(s => new Set(s.tombstones));
  for (const collection of collections) {
    const maps = [base, local, remote].map(s => new Map(s[collection].map(v => [keyOf(collection, v), v])));
    const [before, left, right] = maps;
    const erasedKeys = [...new Set(tombstones.flatMap(set => [...set]))].filter(k => k.startsWith(`${collection}:`)).map(k => k.slice(collection.length + 1));
    for (const id of [...new Set([...maps.flatMap(m => [...m.keys()]), ...erasedKeys])].sort()) {
      const key = `${collection}:${id}`, b = tombstones[0].has(key) ? deleted : before.get(id);
      const l = left.get(id) ?? (tombstones[1].has(key) || b !== undefined ? deleted : undefined);
      const r = right.get(id) ?? (tombstones[2].has(key) || b !== undefined ? deleted : undefined);
      let chosen;
      if (equal(l, r)) chosen = l;
      else if (equal(l, b)) chosen = r;
      else if (equal(r, b)) chosen = l;
      else if (resolutions[key]) chosen = resolutions[key] === 'local' ? l : r;
      else {
        const item = typeof l === 'object' ? l : typeof r === 'object' ? r : undefined;
        conflicts.push({ key, name: collection === 'bodyMetrics' ? `${id} 身体记录` : item && 'name' in item ? item.name : id, local: l === deleted ? null : l ?? null, remote: r === deleted ? null : r ?? null });
        chosen = l;
      }
      // Each collection stays homogeneous; validators below check all foreign references.
      if (chosen === deleted) snapshot.tombstones.push(key);
      else if (chosen) (snapshot[collection] as Array<typeof chosen>).push(chosen);
    }
  }
  return { snapshot, conflicts };
}
export function applySnapshot(local: AppData, snapshot: Snapshot): AppData {
  const { version: _version, tombstones: _tombstones, ...shared } = validateSnapshot(snapshot), drafts = local.sessions.filter(s => !['completed', 'cancelled'].includes(s.status));
  if (drafts.some(d => shared.sessions.some(s => s.id === d.id))) throw new Error('云端已有同一场训练的归档记录。请先处理本机进行中的训练，再同步。');
  return validateAppData({ ...local, ...shared, sessions: [...shared.sessions, ...drafts] });
}
