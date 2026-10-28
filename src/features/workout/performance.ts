import type { Exercise, Session, SessionExercise, SetRecord } from '../../domain/types';
import { fromWeight } from '../../domain/units';
import { isWorkSet } from '../../domain/sets';

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function validValues(set: SetRecord, kind: Exercise['kind']): boolean {
  return Number.isFinite(set.weightKg) && set.weightKg >= 0 && set.weightKg <= 1000
    && Number.isInteger(set.reps) && set.reps >= (kind === 'duration' ? 0 : 1) && set.reps <= 1000
    && Number.isInteger(set.durationSeconds) && set.durationSeconds >= (kind === 'duration' ? 1 : 0) && set.durationSeconds <= 86400;
}

function values(set: SetRecord): Pick<SetRecord, 'weightKg' | 'reps' | 'durationSeconds'> {
  return { weightKg: set.weightKg, reps: set.reps, durationSeconds: set.durationSeconds };
}

export function lastWorkSet(history: Session[], exercise: Exercise, beforeDate = today(), excludeId?: string): SetRecord | undefined {
  if (!validDate(beforeDate)) return undefined;
  const sessions = history
    .filter((session) => session.status === 'completed' && session.id !== excludeId
      && validDate(session.date) && session.date <= beforeDate && Number.isFinite(Date.parse(session.startedAt)))
    .sort((a, b) => b.date.localeCompare(a.date) || Date.parse(b.startedAt) - Date.parse(a.startedAt));
  let fallback: SetRecord | undefined;
  for (const session of sessions) {
    for (let exerciseIndex = session.exercises.length - 1; exerciseIndex >= 0; exerciseIndex--) {
      const item = session.exercises[exerciseIndex];
      if (item.exercise.id !== exercise.id || item.exercise.kind !== exercise.kind) continue;
      for (let setIndex = item.sets.length - 1; setIndex >= 0; setIndex--) {
        const set = item.sets[setIndex];
        if (set.type === 'work' && set.status === 'completed' && validValues(set, exercise.kind)) return { ...set };
        if (!fallback && isWorkSet(set) && set.status === 'completed' && validValues(set, exercise.kind)) fallback = { ...set };
      }
    }
  }
  return fallback;
}

export function seedExercise(item: SessionExercise, history: Session[], beforeDate?: string, excludeId?: string): SessionExercise {
  const previous = lastWorkSet(history, item.exercise, beforeDate, excludeId);
  if (!previous) return item;
  return { ...item, sets: item.sets.map((set) => set.status === 'pending' ? { ...set, ...values(previous) } : set) };
}

export function nextSuggestedSet(item: SessionExercise, history: Session[], newId: string, beforeDate?: string, excludeId?: string): SetRecord {
  const latest = (status: SetRecord['status']) => {
    for (let index = item.sets.length - 1; index >= 0; index--) {
      const set = item.sets[index];
      if (set.status === status && validValues(set, item.exercise.kind)) return set;
    }
    return undefined;
  };
  const source = latest('completed') ?? lastWorkSet(history, item.exercise, beforeDate, excludeId) ?? latest('pending');
  const { rpe: _rpe, ...suggestion } = source ?? { type: 'work' as const, weightKg: 0, reps: 10, durationSeconds: 30 };
  return { ...suggestion, id: newId, status: 'pending' };
}

export function copyPrevious(item: SessionExercise, setId: string): SessionExercise {
  const index = item.sets.findIndex((set) => set.id === setId);
  if (index <= 0 || item.sets[index].status === 'completed') return item;
  return { ...item, sets: item.sets.map((set, setIndex) => setIndex === index ? { ...set, ...values(item.sets[index - 1]) } : set) };
}

export function adjustWeight(kg: number, unit: 'kg' | 'lb', direction: 1 | -1): number {
  const current = Number.isFinite(kg) ? kg : 0;
  const next = Math.min(1000, Math.max(0, current + direction * fromWeight(unit === 'lb' ? 5 : 2.5, unit)));
  return Math.round(next * 1_000_000) / 1_000_000;
}

export function adjustCount(value: number, direction: 1 | -1, max = 1000): number {
  const upper = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : 1000;
  const current = Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(upper, Math.max(1, current + direction));
}
