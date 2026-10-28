import { isWorkSet, setTypeLabels } from './sets';
import type { Exercise, ExerciseKind, Session, SetRecord } from './types';
import { sessionStats } from './training';
import { guideFor } from '../content/catalog';
import { primaryMuscle, targetLabel } from '../content/body-map';

export const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function shiftDate(date: string, days: number) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function monday(date: string) { return shiftDate(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7)); }
export const dateSpan = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;
export type Period = '7' | '30' | '90' | '365' | 'all' | 'custom';
export function periodBounds(period: Period, today: string, sessions: Session[], custom?: { from: string; to: string }) {
  if (period === 'custom' && custom) return custom;
  return { from: period === 'all' ? sessions.filter(s => s.status === 'completed').reduce((d, s) => s.date < d ? s.date : d, today) : shiftDate(today, 1 - Number(period)), to: today };
}
export function inPeriod(sessions: Session[], from: string, to: string) { return sessions.filter(s => s.status === 'completed' && s.date >= from && s.date <= to).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
export function totals(sessions: Session[]) {
  const completed = sessions.filter(s => s.status === 'completed');
  return completed.reduce((a, s) => {
    const stats = sessionStats(s);
    a.sessions++; a.seconds += stats.activeSeconds; a.volumeKg += stats.volumeKg; a.sets += stats.workSets;
    for (const ex of s.exercises) for (const set of ex.sets.filter(s => s.status === 'completed' && isWorkSet(s))) {
      if (ex.exercise.kind === 'reps') a.bodyweightReps += set.reps;
      if (ex.exercise.kind === 'duration') a.durationSeconds += set.durationSeconds;
    }
    return a;
  }, { sessions: 0, seconds: 0, volumeKg: 0, sets: 0, bodyweightReps: 0, durationSeconds: 0, days: new Set(completed.map(s => s.date)).size });
}
export function estimate1RM(weightKg: number, reps: number): number | null {
  return weightKg > 0 && reps >= 1 && reps <= 10 && Number.isInteger(reps) ? weightKg * (reps === 1 ? 1 : 1 + reps / 30) : null;
}
export function canEstimate1RM(exercise: Exercise) { return exercise.kind === 'weight-reps' && !['pushup', 'pullup', 'dip'].includes(guideFor(exercise)?.profile ?? ''); }
export interface Performance { sessionId: string; date: string; name: string; maxWeightKg: number; maxReps: number; maxDuration: number; volumeKg: number; e1rmKg: number | null; sets: number }
export function exercisePerformance(sessions: Session[], exerciseId: string, kind?: ExerciseKind): Performance[] {
  return sessions.filter(s => s.status === 'completed').sort((a, b) => a.startedAt.localeCompare(b.startedAt)).flatMap(s => {
    const matches = s.exercises.filter(ex => ex.exercise.id === exerciseId && (!kind || ex.exercise.kind === kind));
    const sets = matches.flatMap(ex => ex.sets.filter(set => set.status === 'completed' && isWorkSet(set)).map(set => ({ set, kind: ex.exercise.kind })));
    if (!sets.length) return [];
    const weighted = sets.filter(x => x.kind === 'weight-reps');
    const estimates = matches.some(ex => canEstimate1RM(ex.exercise)) ? weighted.map(x => estimate1RM(x.set.weightKg, x.set.reps)).filter((n): n is number => n !== null) : [];
    return [{ sessionId: s.id, date: s.date, name: s.name, maxWeightKg: Math.max(0, ...weighted.map(x => x.set.weightKg)), maxReps: Math.max(0, ...sets.filter(x => x.kind !== 'duration').map(x => x.set.reps)), maxDuration: Math.max(0, ...sets.filter(x => x.kind === 'duration').map(x => x.set.durationSeconds)), volumeKg: weighted.reduce((n, x) => n + x.set.weightKg * x.set.reps, 0), e1rmKg: estimates.length ? Math.max(...estimates) : null, sets: sets.length }];
  });
}
export function muscleBalance(sessions: Session[]) {
  const groups = new Map<string, number>();
  for (const s of sessions.filter(s => s.status === 'completed')) for (const ex of s.exercises) {
    const n = ex.sets.filter(set => set.status === 'completed' && isWorkSet(set)).length;
    const primary = primaryMuscle(ex.exercise);
    const label = primary ? targetLabel(primary) : '未细分';
    if (n) groups.set(label, (groups.get(label) ?? 0) + n);
  }
  return [...groups].map(([name, sets]) => ({ name, sets })).sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name, 'zh-CN'));
}
export function dailyActivity(sessions: Session[], from: string, to: string) {
  const selected = inPeriod(sessions, from, to);
  return Array.from({ length: Math.max(0, Math.min(3660, dateSpan(from, to))) }, (_, i) => {
    const date = shiftDate(from, i); return { date, ...totals(selected.filter(s => s.date === date)) };
  });
}
export function weeklyActivity(sessions: Session[], today: string, weeks = 12) {
  const start = shiftDate(monday(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, i) => {
    const date = shiftDate(start, i * 7); return { date, ...totals(inPeriod(sessions, date, shiftDate(date, 6))) };
  });
}
export function periodSeries(sessions: Session[], from: string, to: string) {
  const span = dateSpan(from, to); const selected = inPeriod(sessions, from, to);
  if (span <= 31) return dailyActivity(selected, from, to);
  if (span <= 366) {
    const result = []; for (let date = from; date <= to; date = shiftDate(date, 7)) result.push({ date, ...totals(inPeriod(selected, date, shiftDate(date, 6) < to ? shiftDate(date, 6) : to)) });
    return result;
  }
  const groups = new Map<string, Session[]>();
  for (const session of selected) { const month = session.date.slice(0, 7); groups.set(month, [...(groups.get(month) ?? []), session]); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([month, list]) => ({ date: `${month}-01`, ...totals(list) }));
}
export function trainingStreak(sessions: Session[], today: string) {
  const weeks = new Set(sessions.filter(s => s.status === 'completed' && s.date <= today).map(s => monday(s.date)));
  let week = monday(today); if (!weeks.has(week)) week = shiftDate(week, -7);
  let count = 0; while (weeks.has(week)) { count++; week = shiftDate(week, -7); } return count;
}
export interface PersonalRecord { exercise: Exercise; metric: 'weight' | 'reps' | 'duration'; value: number; date: string; sessionId: string; previous: number | null }
export function personalRecords(sessions: Session[]): PersonalRecord[] {
  const found = new Map<string, PersonalRecord>();
  for (const s of sessions.filter(s => s.status === 'completed').sort((a, b) => a.startedAt.localeCompare(b.startedAt))) for (const ex of s.exercises) {
    const metric = ex.exercise.kind === 'weight-reps' ? 'weight' : ex.exercise.kind === 'duration' ? 'duration' : 'reps';
    for (const set of ex.sets.filter(set => set.status === 'completed' && isWorkSet(set))) {
      const value = metric === 'weight' ? set.weightKg : metric === 'duration' ? set.durationSeconds : set.reps;
      const key = `${ex.exercise.id}:${metric}`; const old = found.get(key);
      if (value > 0 && (!old || value > old.value)) found.set(key, { exercise: ex.exercise, metric, value, date: s.date, sessionId: s.id, previous: old?.value ?? null });
    }
  }
  return [...found.values()].sort((a, b) => b.date.localeCompare(a.date) || a.exercise.name.localeCompare(b.exercise.name, 'zh-CN'));
}
export function csvRecords(sessions: Session[]): string {
  const cell = (value: string | number) => { const text = typeof value === 'number' ? String(value) : /^\s*[=+\-@]|^[\t\r\n]/.test(value) ? `'${value}` : value; return `"${text.replaceAll('"', '""')}"`; };
  const rows: Array<Array<string | number>> = [['日期', '训练', '动作', '主要部位', '组号', '组类型', '状态', '总重量(kg)', '次数', '时长(秒)', '训练备注', '动作备注', 'RPE']];
  for (const s of sessions.filter(s => s.status === 'completed')) for (const ex of s.exercises) ex.sets.forEach((set: SetRecord, i: number) => rows.push([s.date, s.name, ex.exercise.name, ex.exercise.muscle, i + 1, setTypeLabels[set.type], set.status === 'completed' ? '完成' : set.status === 'skipped' ? '跳过' : '未完成', ex.exercise.kind === 'weight-reps' ? set.weightKg : '', ex.exercise.kind !== 'duration' ? set.reps : '', ex.exercise.kind === 'duration' ? set.durationSeconds : '', s.note, ex.note, set.rpe ?? '']));
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
