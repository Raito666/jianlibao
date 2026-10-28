import type { AppData, AppSettings, BodyMetric, Exercise, LegacyAppData, MeasurementKey, Session, SessionExercise, SetRecord, TemplateItem, WorkoutTemplate } from '../domain/types';
import { migrateAppDataV1 } from './migrations';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TIME = 4_102_444_800_000;
type RecordValue = Record<string, unknown>;
export interface ImportPreview {
  added: number;
  unchanged: number;
  conflicts: Array<{ id: string; collection: 'exercises' | 'templates' | 'sessions' | 'bodyMetrics'; name: string }>;
  settingsChanged: boolean;
}

function fail(path: string, message = '格式不正确'): never { throw new Error(`备份 ${path}：${message}`); }
function object(value: unknown, path: string, keys: string[], optional: string[] = []): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path);
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(path);
  const record = value as RecordValue;
  for (const key of Object.keys(record)) if (!keys.includes(key) && !optional.includes(key)) fail(`${path}.${key}`, '含未知字段');
  for (const key of keys) if (!Object.hasOwn(record, key)) fail(`${path}.${key}`, '缺少字段');
  return record;
}
function string(value: unknown, path: string, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(path, '文本无效或超长');
  return value;
}
function id(value: unknown, path: string): string {
  const result = string(value, path, 120, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) fail(path, '标识无效');
  return result;
}
function number(value: unknown, path: string, max: number, integer = false, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) fail(path, '数字超出范围或精度无效');
  return value;
}
function boolean(value: unknown, path: string): boolean { if (typeof value !== 'boolean') fail(path); return value; }
function choice<T extends string>(value: unknown, path: string, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail(path, '不支持的取值');
  return value as T;
}
function iso(value: unknown, path: string): string {
  const result = string(value, path, 30, true);
  const time = Date.parse(result);
  if (!Number.isFinite(time) || time < 0 || time > MAX_TIME || new Date(time).toISOString() !== result) fail(path, '须为有效 UTC ISO 时间');
  return result;
}
function array<T>(value: unknown, path: string, max: number, parse: (entry: unknown, path: string) => T): T[] {
  if (!Array.isArray(value) || value.length > max) fail(path, '列表超出范围');
  return value.map((entry, index) => parse(entry, `${path}[${index}]`));
}
function unique(items: Array<{ id: string }>, path: string): void {
  if (new Set(items.map((item) => item.id)).size !== items.length) fail(path, '有重复标识');
}
function exercise(value: unknown, path: string): Exercise {
  const v = object(value, path, ['id', 'name', 'muscle', 'equipment', 'kind', 'description']);
  return { id: id(v.id, `${path}.id`), name: string(v.name, `${path}.name`, 120, true), muscle: string(v.muscle, `${path}.muscle`, 80, true), equipment: string(v.equipment, `${path}.equipment`, 80, true), kind: choice(v.kind, `${path}.kind`, ['weight-reps', 'reps', 'duration']), description: string(v.description, `${path}.description`, 5000) };
}
function templateItem(value: unknown, path: string): TemplateItem {
  const v = object(value, path, ['id', 'exerciseId', 'sets', 'weightKg', 'reps', 'durationSeconds']);
  return { id: id(v.id, `${path}.id`), exerciseId: id(v.exerciseId, `${path}.exerciseId`), sets: number(v.sets, `${path}.sets`, 100, true, 1), weightKg: number(v.weightKg, `${path}.weightKg`, 5000), reps: number(v.reps, `${path}.reps`, 100_000, true), durationSeconds: number(v.durationSeconds, `${path}.durationSeconds`, 604_800, true) };
}
function template(value: unknown, path: string): WorkoutTemplate {
  const v = object(value, path, ['id', 'name', 'description', 'restSeconds', 'items', 'updatedAt'], ['archived']);
  const items = array(v.items, `${path}.items`, 200, templateItem);
  unique(items, `${path}.items`);
  return { id: id(v.id, `${path}.id`), name: string(v.name, `${path}.name`, 120, true), description: string(v.description, `${path}.description`, 5000), restSeconds: number(v.restSeconds, `${path}.restSeconds`, 86400, true), items, updatedAt: iso(v.updatedAt, `${path}.updatedAt`), ...(v.archived === undefined ? {} : { archived: boolean(v.archived, `${path}.archived`) }) };
}
function setRecord(value: unknown, path: string, version: 1 | 2): SetRecord {
  const v = object(value, path, ['id', 'type', 'weightKg', 'reps', 'durationSeconds', 'status'], version === 2 ? ['rpe'] : []);
  const rpe = v.rpe === undefined ? undefined : number(v.rpe, `${path}.rpe`, 10, false, 6);
  if (rpe !== undefined && !Number.isInteger(rpe * 2)) fail(`${path}.rpe`, '须为6至10之间的半档数值');
  return { id: id(v.id, `${path}.id`), type: choice(v.type, `${path}.type`, version === 1 ? ['warmup', 'work'] : ['warmup', 'work', 'drop', 'failure']), weightKg: number(v.weightKg, `${path}.weightKg`, 5000), reps: number(v.reps, `${path}.reps`, 100_000, true), durationSeconds: number(v.durationSeconds, `${path}.durationSeconds`, 604_800, true), status: choice(v.status, `${path}.status`, ['pending', 'completed', 'skipped']), ...(rpe === undefined ? {} : { rpe }) };
}
function sessionExercise(value: unknown, path: string, version: 1 | 2): SessionExercise {
  const v = object(value, path, ['id', 'exercise', 'sets', 'note']);
  const snapshot = exercise(v.exercise, `${path}.exercise`);
  const sets = array(v.sets, `${path}.sets`, 100, (entry, key) => setRecord(entry, key, version));
  unique(sets, `${path}.sets`);
  for (const set of sets) if (set.status === 'completed' && (snapshot.kind === 'duration' ? set.durationSeconds < 1 : set.reps < 1)) fail(`${path}.sets`, '已完成组必须有正次数或正时长');
  return { id: id(v.id, `${path}.id`), exercise: snapshot, sets, note: string(v.note, `${path}.note`, 10000) };
}
function session(value: unknown, path: string, version: 1 | 2): Session {
  const v = object(value, path, ['id', 'name', 'startedAt', 'updatedAt', 'date', 'timeZone', 'status', 'pausedMs', 'restUntil', 'restDuration', 'exercises', 'note'], ['templateId', 'finishedAt', 'pausedAt', 'recordedManually']);
  const date = string(v.date, `${path}.date`, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1970-01-01' || date > '2100-01-01' || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) fail(`${path}.date`, '本地日期无效');
  const timeZone = string(v.timeZone, `${path}.timeZone`, 100, true);
  try { new Intl.DateTimeFormat('zh-CN', { timeZone }); } catch { fail(`${path}.timeZone`, '时区无效'); }
  const status = choice(v.status, `${path}.status`, ['active', 'paused', 'review', 'completed', 'cancelled']);
  const startedAt = iso(v.startedAt, `${path}.startedAt`);
  const updatedAt = iso(v.updatedAt, `${path}.updatedAt`);
  const finishedAt = v.finishedAt === undefined ? undefined : iso(v.finishedAt, `${path}.finishedAt`);
  if ((status === 'review' || status === 'completed') && !finishedAt) fail(path, '回顾或已完成训练缺少结束时间');
  if ((status === 'active' || status === 'paused') && finishedAt) fail(path, '进行中训练不能已有结束时间');
  if (finishedAt && Date.parse(finishedAt) < Date.parse(startedAt)) fail(path, '结束时间早于开始时间');
  const pausedAt = v.pausedAt === undefined ? undefined : number(v.pausedAt, `${path}.pausedAt`, MAX_TIME, true);
  if ((status === 'paused') !== (pausedAt !== undefined)) fail(path, '暂停状态与暂停时间不一致');
  const pausedMs = number(v.pausedMs, `${path}.pausedMs`, MAX_TIME, true);
  const start = Date.parse(startedAt);
  const updated = Date.parse(updatedAt);
  const end = finishedAt ? Date.parse(finishedAt) : updated;
  if (updated < start || (finishedAt && updated < end)) fail(path, '更新时间早于训练时间');
  if (pausedAt !== undefined && (pausedAt < start || pausedAt > updated)) fail(path, '暂停时间超出训练范围');
  if (pausedMs > (pausedAt ?? end) - start) fail(path, '累计暂停时间超过训练总时长');
  const exercises = array(v.exercises, `${path}.exercises`, 200, (entry, key) => sessionExercise(entry, key, version));
  unique(exercises, `${path}.exercises`);
  unique(exercises.flatMap((item) => item.sets), `${path}.sets`);
  if (status === 'completed' && !exercises.some((item) => item.sets.some((set) => set.status === 'completed'))) fail(path, '已完成训练至少包含一组实际完成记录');
  return {
    id: id(v.id, `${path}.id`), name: string(v.name, `${path}.name`, 120, true), startedAt, updatedAt, date, timeZone, status,
    pausedMs, restUntil: v.restUntil === null ? null : number(v.restUntil, `${path}.restUntil`, MAX_TIME, true),
    restDuration: number(v.restDuration, `${path}.restDuration`, 86400, true), exercises, note: string(v.note, `${path}.note`, 10000),
    ...(v.recordedManually === undefined ? {} : { recordedManually: boolean(v.recordedManually, `${path}.recordedManually`) }),
    ...(v.templateId === undefined ? {} : { templateId: id(v.templateId, `${path}.templateId`) }), ...(finishedAt === undefined ? {} : { finishedAt }), ...(pausedAt === undefined ? {} : { pausedAt }),
  };
}
function settings(value: unknown, path: string, version: 1 | 2): AppSettings {
  const v = object(value, path, ['unit', 'theme', 'defaultRest', 'autoRest', 'lastExportAt', ...(version === 2 ? ['showRpe'] : [])], ['favoriteExerciseIds']);
  return { unit: choice(v.unit, `${path}.unit`, ['kg', 'lb']), theme: choice(v.theme, `${path}.theme`, ['dark', 'light']), defaultRest: number(v.defaultRest, `${path}.defaultRest`, 86400, true), autoRest: boolean(v.autoRest, `${path}.autoRest`), showRpe: version === 1 ? false : boolean(v.showRpe, `${path}.showRpe`), lastExportAt: v.lastExportAt === null ? null : iso(v.lastExportAt, `${path}.lastExportAt`), ...(v.favoriteExerciseIds === undefined ? {} : { favoriteExerciseIds: array(v.favoriteExerciseIds, `${path}.favoriteExerciseIds`, 5000, id) }) };
}

function bodyMetric(value: unknown, path: string): BodyMetric {
  const v = object(value, path, ['id', 'date'], ['weightKg', 'bodyFatPct', 'measurements', 'note']);
  const date = string(v.date, `${path}.date`, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '1970-01-01' || date > '2100-01-01' || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) fail(`${path}.date`, '本地日期无效');
  const measurements: Partial<Record<MeasurementKey, number>> = {};
  if (v.measurements !== undefined) {
    const values = object(v.measurements, `${path}.measurements`, [], ['chest', 'waist', 'hip', 'arm', 'thigh']);
    for (const key of Object.keys(values) as MeasurementKey[]) measurements[key] = number(values[key], `${path}.measurements.${key}`, 1000, false, Number.MIN_VALUE);
  }
  if (v.weightKg === undefined && v.bodyFatPct === undefined && Object.keys(measurements).length === 0) fail(path, '至少填写一项身体数据');
  return {
    id: id(v.id, `${path}.id`), date,
    ...(v.weightKg === undefined ? {} : { weightKg: number(v.weightKg, `${path}.weightKg`, 1000, false, Number.MIN_VALUE) }),
    ...(v.bodyFatPct === undefined ? {} : { bodyFatPct: number(v.bodyFatPct, `${path}.bodyFatPct`, 100) }),
    ...(v.measurements === undefined ? {} : { measurements }),
    ...(v.note === undefined ? {} : { note: string(v.note, `${path}.note`, 5000) }),
  };
}

/** Strict version-aware parsing, followed by an explicit pure v1 migration; never clears data. */
export function validateAppData(value: unknown): AppData {
  const header = object(value, 'data', ['schemaVersion', 'revision', 'exercises', 'templates', 'sessions', 'settings', 'onboarded'], ['bodyMetrics']);
  if (header.schemaVersion !== 1 && header.schemaVersion !== 2) fail('data.schemaVersion', '不支持的数据版本，请使用兼容版本打开；原数据已保留');
  const version = header.schemaVersion;
  const v = object(value, 'data', ['schemaVersion', 'revision', 'exercises', 'templates', 'sessions', 'settings', 'onboarded', ...(version === 2 ? ['bodyMetrics'] : [])]);
  const exercises = array(v.exercises, 'data.exercises', 5000, exercise);
  const templates = array(v.templates, 'data.templates', 1000, template);
  const sessions = array(v.sessions, 'data.sessions', 10000, (entry, key) => session(entry, key, version));
  unique(exercises, 'data.exercises'); unique(templates, 'data.templates'); unique(sessions, 'data.sessions');
  const exerciseIds = new Set(exercises.map((item) => item.id));
  for (const item of templates) for (const entry of item.items) if (!exerciseIds.has(entry.exerciseId)) fail('data.templates', '模板引用了不存在的动作');
  if (sessions.filter(isDraft).length > 1) fail('data.sessions', '一份数据只能包含一场进行中、暂停或待回顾训练');
  // A session embeds its own exercise snapshot. Removed/renamed library entries and templates do not invalidate history.
  const common = { revision: number(v.revision, 'data.revision', Number.MAX_SAFE_INTEGER - 1, true), exercises, templates, sessions, settings: settings(v.settings, 'data.settings', version), onboarded: boolean(v.onboarded, 'data.onboarded') };
  if (version === 1) {
    const { showRpe: _showRpe, ...oldSettings } = common.settings;
    const old: LegacyAppData = { ...common, schemaVersion: 1, settings: oldSettings };
    return migrateAppDataV1(old);
  }
  const bodyMetrics = array(v.bodyMetrics, 'data.bodyMetrics', 50000, bodyMetric);
  unique(bodyMetrics, 'data.bodyMetrics');
  if (new Set(bodyMetrics.map(item => item.date)).size !== bodyMetrics.length) fail('data.bodyMetrics', '有重复日期');
  return { ...common, schemaVersion: 2, bodyMetrics };
}

/** Web/native cloud documents share only these collections. Keychain references,
 * device settings, drafts and sync secrets
 * remain outside the backup schema; reuse every existing record/snapshot validator. */
export function validateSharedCollections(value: unknown): Pick<AppData, 'exercises' | 'templates' | 'sessions' | 'bodyMetrics'> {
  const collections = object(value, '云同步', ['exercises', 'templates', 'sessions', 'bodyMetrics']);
  const parsed = validateAppData({
    ...collections, schemaVersion: 2, revision: 0, onboarded: true,
    settings: { unit: 'kg', theme: 'dark', defaultRest: 90, autoRest: true, showRpe: false, lastExportAt: null },
  });
  if (parsed.sessions.some(isDraft)) throw new Error('云同步文档不能包含进行中的训练');
  return { exercises: parsed.exercises, templates: parsed.templates, sessions: parsed.sessions, bodyMetrics: parsed.bodyMetrics };
}

function isDraft(item: Session): boolean { return item.status === 'active' || item.status === 'paused' || item.status === 'review'; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function exportBackup(data: AppData): string {
  const validated = validateAppData(data);
  const text = JSON.stringify({ app: 'jianlibao', formatVersion: 2, exportedAt: new Date().toISOString(), data: validated }, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('备份超过 10 MB；请联系开发者提供分批导出支持');
  return text;
}

export function parseBackup(text: string): AppData {
  if (typeof text !== 'string' || text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('备份文件不能超过 10 MB');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('备份不是有效的 JSON 文件'); }
  const v = object(parsed, '文件', ['app', 'formatVersion', 'exportedAt', 'data']);
  if (v.app !== 'jianlibao') fail('app', '这不是健力宝备份');
  if (v.formatVersion !== 1 && v.formatVersion !== 2) fail('formatVersion', '不支持的备份版本，请使用兼容版本导入');
  if (!v.data || typeof v.data !== 'object' || !('schemaVersion' in v.data) || v.data.schemaVersion !== v.formatVersion) fail('formatVersion', '备份版本与数据版本不一致');
  iso(v.exportedAt, 'exportedAt');
  const validated = validateAppData(v.data);
  return { ...validated, revision: 0 };
}

export function previewImport(current: AppData, incoming: AppData): ImportPreview {
  const result: ImportPreview = { added: 0, unchanged: 0, conflicts: [], settingsChanged: false };
  for (const collection of ['exercises', 'templates', 'sessions'] as const) {
    const local = new Map(current[collection].map((item) => [item.id, item]));
    for (const item of incoming[collection]) {
      const existing = local.get(item.id);
      if (!existing) result.added++;
      else if (canonical(existing) === canonical(item)) result.unchanged++;
      else result.conflicts.push({ id: item.id, collection, name: item.name });
    }
  }
  for (const { item, existing } of bodyImportPlan(current.bodyMetrics, incoming.bodyMetrics)) {
    if (!existing) result.added++;
    else if (sameBody(existing, item)) result.unchanged++;
    else result.conflicts.push({ id: item.id, collection: 'bodyMetrics', name: `${item.date} 身体数据` });
  }
  return result;
}

/** Resolve the whole batch against an immutable local snapshot before making any replacements. */
function bodyImportPlan(records: BodyMetric[], incoming: BodyMetric[]) {
  const ids = new Map(records.map(record => [record.id, record]));
  const dates = new Map(records.map(record => [record.date, record]));
  const claimed = new Set<string>();
  return incoming.map(item => {
    const byId = ids.get(item.id), byDate = dates.get(item.date);
    if (byId && byDate && byId !== byDate) throw new Error('身体记录的标识与日期对应了两条本机数据，请先分别核对再导入');
    const existing = byId ?? byDate;
    if (existing && claimed.has(existing.id)) throw new Error('身体备份中多条记录交叉对应同一条本机记录，请先分别核对标识和日期后再导入；本机数据未改变');
    if (existing) claimed.add(existing.id);
    return { item, existing };
  });
}
function sameBody(a: BodyMetric, b: BodyMetric): boolean {
  const { id: _a, ...left } = a, { id: _b, ...right } = b;
  return canonical(left) === canonical(right);
}

export function mergeImport(current: AppData, incoming: AppData, resolution: 'keep-local' | 'use-import'): AppData {
  if (resolution !== 'keep-local' && resolution !== 'use-import') throw new Error('请选择冲突处理方式');
  const local = validateAppData(current);
  const imported = validateAppData(incoming);
  function merge<T extends { id: string }>(existing: T[], added: T[]): T[] {
    const result = new Map(existing.map((item) => [item.id, item]));
    for (const item of added) if (!result.has(item.id) || resolution === 'use-import') result.set(item.id, item);
    return [...result.values()];
  }
  const sessions = merge(local.sessions, imported.sessions);
  const bodyMetrics = [...local.bodyMetrics];
  for (const { item, existing } of bodyImportPlan(local.bodyMetrics, imported.bodyMetrics)) {
    if (!existing) bodyMetrics.push(item);
    else if (!sameBody(existing, item) && resolution === 'use-import') bodyMetrics[bodyMetrics.indexOf(existing)] = item;
  }
  if (sessions.filter(isDraft).length > 1) throw new Error('导入会产生两场未完成训练。请先结束或取消本机训练，再导入这份备份。');
  // Preferences and onboarding belong to this browser; importing history never changes the theme or export reminder.
  return validateAppData({ ...local, exercises: merge(local.exercises, imported.exercises), templates: merge(local.templates, imported.templates), sessions, bodyMetrics });
}
