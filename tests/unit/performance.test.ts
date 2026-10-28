import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Exercise, Session, SessionExercise, SetRecord } from '../../src/domain/types';
import { displayWeight, fromWeight } from '../../src/domain/units';
import {
  adjustCount,
  adjustWeight,
  copyPrevious,
  lastWorkSet,
  nextSuggestedSet,
  seedExercise,
} from '../../src/features/workout/performance';

const squat: Exercise = { id: 'squat', name: '深蹲', muscle: '腿', equipment: '杠铃', kind: 'weight-reps', description: '' };
const cutoff = '2026-10-17';

function record(patch: Partial<SetRecord> = {}): SetRecord {
  return { id: 'set', type: 'work', weightKg: 60, reps: 8, durationSeconds: 30, status: 'completed', ...patch };
}

function item(sets: SetRecord[] = [record()], exercise: Exercise = squat): SessionExercise {
  return { id: 'session-exercise', exercise: { ...exercise }, sets, note: '保留备注' };
}

function session(patch: Partial<Session> = {}): Session {
  return {
    id: 'history', name: '上次训练', startedAt: '2026-10-16T10:00:00.000Z', updatedAt: '2026-10-16T11:00:00.000Z',
    finishedAt: '2026-10-16T11:00:00.000Z', date: '2026-10-16', timeZone: 'Asia/Shanghai', status: 'completed',
    pausedMs: 0, restUntil: null, restDuration: 90, exercises: [item()], note: '', ...patch,
  };
}

afterEach(() => vi.useRealTimers());

describe('lastWorkSet', () => {
  it('uses the last completed work set rather than warmup, skipped, pending or maximum weight', () => {
    const history = [session({ exercises: [item([
      record({ id: 'heavier', weightKg: 80 }),
      record({ id: 'last-work', weightKg: 65, reps: 6 }),
      record({ id: 'warmup', type: 'warmup', weightKg: 20 }),
      record({ id: 'pending', status: 'pending', weightKg: 90 }),
      record({ id: 'skipped', status: 'skipped', weightKg: 95 }),
    ])] })];
    expect(lastWorkSet(history, squat, cutoff)).toMatchObject({ id: 'last-work', weightKg: 65, reps: 6 });
  });

  it('sorts by training date first and start timestamp second without sorting its input', () => {
    const history = [
      session({ id: 'same-day-earlier', startedAt: '2026-10-16T08:00:00Z', exercises: [item([record({ weightKg: 40 })])] }),
      session({ id: 'older-date-later-start', date: '2026-10-15', startedAt: '2026-10-17T12:00:00Z', exercises: [item([record({ weightKg: 90 })])] }),
      session({ id: 'same-day-later', startedAt: '2026-10-16T09:00:00+00:00', exercises: [item([record({ weightKg: 70 })])] }),
    ];
    const original = structuredClone(history);
    expect(lastWorkSet(history, squat, cutoff)?.weightKg).toBe(70);
    expect(history).toEqual(original);
  });

  it('excludes the current session, future dates and unfinished or cancelled sessions', () => {
    const history = [
      session({ id: 'valid', exercises: [item([record({ weightKg: 55 })])] }),
      ...(['active', 'paused', 'review', 'cancelled'] as const).map((status) => session({ id: status, status, date: cutoff })),
      session({ id: 'current', date: cutoff }),
      session({ id: 'future', date: '2026-10-18' }),
    ];
    expect(lastWorkSet(history, squat, cutoff, 'current')?.weightKg).toBe(55);
  });

  it('includes other completed sessions on the cutoff date and defaults to the local current day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 17, 12));
    const history = [session({ date: cutoff }), session({ id: 'tomorrow', date: '2026-10-18', exercises: [item([record({ id: 'future-set' })])] })];
    expect(lastWorkSet(history, squat)?.id).toBe('set');
    expect(lastWorkSet(history, squat, '2026-10-16')).toBeUndefined();
  });

  it('requires matching exercise id and record kind while allowing renamed exercise snapshots', () => {
    const history = [session({ exercises: [
      item([record({ weightKg: 30 })], { ...squat, name: '旧动作名称' }),
      item([record({ weightKg: 90 })], { ...squat, id: 'other' }),
      item([record({ weightKg: 80 })], { ...squat, kind: 'reps' }),
    ] })];
    expect(lastWorkSet(history, squat, cutoff)?.weightKg).toBe(30);
  });

  it('searches earlier sessions if a newer session has no completed work set', () => {
    const history = [session(), session({ id: 'new', date: cutoff, exercises: [item([record({ type: 'warmup' })])] })];
    expect(lastWorkSet(history, squat, cutoff)?.weightKg).toBe(60);
    expect(lastWorkSet([], squat, cutoff)).toBeUndefined();
  });

  it.each([
    { weightKg: Number.NaN }, { weightKg: Number.POSITIVE_INFINITY }, { weightKg: -1 }, { weightKg: 1000.01 },
    { reps: 0 }, { reps: 1.5 }, { reps: 1001 }, { durationSeconds: 86401 },
  ])('skips invalid or out-of-UI-range history values instead of clamping them: %o', (invalid) => {
    const bad = record({ id: 'invalid', ...invalid });
    const history = [session({ exercises: [item([record({ id: 'valid', weightKg: 50 }), bad])] })];
    expect(lastWorkSet(history, squat, cutoff)).toMatchObject({ id: 'valid', weightKg: 50 });
    expect(history[0].exercises[0].sets[1]).toEqual(bad);
  });

  it('accepts UI boundary values and validates duration and repetition kinds independently', () => {
    expect(lastWorkSet([session({ exercises: [item([record({ weightKg: 1000, reps: 1000, durationSeconds: 86400 })])] })], squat, cutoff)?.weightKg).toBe(1000);
    const timed: Exercise = { ...squat, kind: 'duration' };
    const timedHistory = [session({ exercises: [item([
      record({ id: 'valid-duration', reps: 0, durationSeconds: 86400 }),
      record({ id: 'zero-duration', reps: 0, durationSeconds: 0 }),
      record({ id: 'long-duration', reps: 0, durationSeconds: 86401 }),
    ], timed)] })];
    expect(lastWorkSet(timedHistory, timed, cutoff)?.id).toBe('valid-duration');
    const bodyweight: Exercise = { ...squat, kind: 'reps' };
    expect(lastWorkSet([session({ exercises: [item([record({ weightKg: 0, reps: 1, durationSeconds: 0 })], bodyweight)] })], bodyweight, cutoff)?.reps).toBe(1);
  });

  it('ignores invalid training dates and timestamps instead of returning unsafe suggestions', () => {
    expect(lastWorkSet([
      session({ date: '2026-02-30' }), session({ date: '2026-1-2' }), session({ startedAt: 'invalid' }),
    ], squat, cutoff)).toBeUndefined();
    expect(lastWorkSet([session()], squat, 'invalid')).toBeUndefined();
  });

  it('returns a detached record so suggestions cannot mutate archived history', () => {
    const history = [session()];
    const result = lastWorkSet(history, squat, cutoff)!;
    result.weightKg = 1;
    expect(history[0].exercises[0].sets[0].weightKg).toBe(60);
  });
});

describe('seedExercise', () => {
  it('fills only pending values and preserves ids, types, statuses, snapshots and notes', () => {
    const initial = item([
      record({ id: 'pending', type: 'warmup', status: 'pending', weightKg: 10 }),
      record({ id: 'done', weightKg: 20 }),
      record({ id: 'skipped', status: 'skipped', weightKg: 30 }),
    ]);
    const history = [session({ exercises: [item([record({ id: 'history-set', weightKg: 72.5, reps: 5, durationSeconds: 40 })])] })];
    const original = structuredClone({ initial, history });
    const seeded = seedExercise(initial, history, cutoff, 'current');
    expect(seeded).toEqual({ ...initial, sets: [
      { ...initial.sets[0], weightKg: 72.5, reps: 5, durationSeconds: 40 }, initial.sets[1], initial.sets[2],
    ] });
    expect({ initial, history }).toEqual(original);
  });

  it('retains template values when no valid matching history exists', () => {
    const initial = item([record({ status: 'pending', weightKg: 22.5, reps: 12, durationSeconds: 45 })]);
    expect(seedExercise(initial, [], cutoff)).toEqual(initial);
    expect(seedExercise(initial, [session({ status: 'cancelled' })], cutoff)).toEqual(initial);
  });
});

describe('nextSuggestedSet', () => {
  it('prefers the last completed actual set in this exercise, including its type, over pending targets or history', () => {
    const initial = item([
      record({ id: 'first', weightKg: 62.5 }),
      record({ id: 'actual', type: 'warmup', weightKg: 67.5, reps: 7 }),
      record({ id: 'target', status: 'pending', weightKg: 99 }),
    ]);
    const original = structuredClone(initial);
    expect(nextSuggestedSet(initial, [session()], 'new-id', cutoff)).toEqual({
      id: 'new-id', type: 'warmup', weightKg: 67.5, reps: 7, durationSeconds: 30, status: 'pending',
    });
    expect(initial).toEqual(original);
  });

  it('uses last historical work values before this exercise pending targets', () => {
    const initial = item([record({ status: 'pending', weightKg: 20 })]);
    expect(nextSuggestedSet(initial, [session()], 'next', cutoff)).toMatchObject({ id: 'next', status: 'pending', weightKg: 60 });
  });

  it('uses the last valid pending target when there is no actual or historical result', () => {
    const initial = item([
      record({ status: 'pending', weightKg: 10 }),
      record({ type: 'warmup', status: 'pending', weightKg: 25, reps: 12 }),
      record({ status: 'skipped', weightKg: 80 }),
    ]);
    expect(nextSuggestedSet(initial, [], 'next', cutoff)).toEqual({ id: 'next', type: 'warmup', status: 'pending', weightKg: 25, reps: 12, durationSeconds: 30 });
  });

  it('ignores invalid current values and excluded history, then uses safe defaults', () => {
    const initial = item([
      record({ weightKg: 1001 }), record({ status: 'pending', reps: 0 }), record({ status: 'skipped' }),
    ]);
    expect(nextSuggestedSet(initial, [session({ id: 'current' })], 'next', cutoff, 'current')).toEqual({
      id: 'next', type: 'work', weightKg: 0, reps: 10, durationSeconds: 30, status: 'pending',
    });
    expect(nextSuggestedSet(item([]), [], 'empty', cutoff)).toMatchObject({ id: 'empty', status: 'pending', weightKg: 0, reps: 10, durationSeconds: 30 });
  });
});

describe('copyPrevious', () => {
  it('copies immediate previous row values while retaining the target id, type and status', () => {
    const initial = item([
      record({ id: 'previous', status: 'pending', weightKg: 37.5, reps: 11, durationSeconds: 75 }),
      record({ id: 'target', type: 'warmup', status: 'skipped', weightKg: 10, reps: 3 }),
    ]);
    const original = structuredClone(initial);
    const result = copyPrevious(initial, 'target');
    expect(result.sets[1]).toEqual({ id: 'target', type: 'warmup', status: 'skipped', weightKg: 37.5, reps: 11, durationSeconds: 75 });
    expect(result.note).toBe('保留备注');
    expect(initial).toEqual(original);
  });

  it('does not change first rows, completed targets or missing rows', () => {
    const initial = item([record({ id: 'first', status: 'pending' }), record({ id: 'done', weightKg: 30 })]);
    for (const id of ['first', 'done', 'missing']) expect(copyPrevious(initial, id)).toEqual(initial);
    expect(copyPrevious(item([]), 'missing').sets).toEqual([]);
  });
});

describe('weight and count adjustments', () => {
  it('adjusts kilograms by 2.5 with stable decimal precision', () => {
    expect(adjustWeight(60, 'kg', 1)).toBe(62.5);
    expect(adjustWeight(60, 'kg', -1)).toBe(57.5);
    expect(adjustWeight(10.1234567, 'kg', 1)).toBe(12.623457);
  });

  it('adjusts pounds by a displayed 5 lb without rounding the current kg through the display unit', () => {
    const start = fromWeight(45, 'lb');
    expect(displayWeight(adjustWeight(start, 'lb', 1), 'lb')).toBe(50);
    expect(displayWeight(adjustWeight(start, 'lb', -1), 'lb')).toBe(40);
    expect(adjustWeight(40, 'lb', 1)).toBe(42.267962);
  });

  it('keeps repeated pound increments and decrements from accumulating visible drift', () => {
    let kg = 40;
    for (let index = 0; index < 100; index++) kg = adjustWeight(kg, 'lb', 1);
    expect(displayWeight(kg, 'lb')).toBe(588.18);
    for (let index = 0; index < 100; index++) kg = adjustWeight(kg, 'lb', -1);
    expect(kg).toBe(40);
    expect(displayWeight(kg, 'lb')).toBe(88.18);
  });

  it('clamps weight adjustments to the UI range for both units', () => {
    expect(adjustWeight(0, 'kg', -1)).toBe(0);
    expect(adjustWeight(999, 'kg', 1)).toBe(1000);
    expect(adjustWeight(1, 'lb', -1)).toBe(0);
    expect(adjustWeight(999, 'lb', 1)).toBe(1000);
    expect(Number.isFinite(adjustWeight(Number.NaN, 'kg', 1))).toBe(true);
  });

  it('adjusts integer counts by one and clamps counts or duration to their allowed limits', () => {
    expect(adjustCount(10, 1)).toBe(11);
    expect(adjustCount(10, -1)).toBe(9);
    expect(adjustCount(1, -1)).toBe(1);
    expect(adjustCount(1000, 1)).toBe(1000);
    expect(adjustCount(86400, 1, 86400)).toBe(86400);
    expect(adjustCount(30, -1, 86400)).toBe(29);
    expect(adjustCount(10.7, 1)).toBe(12);
    expect(Number.isInteger(adjustCount(Number.NaN, 1))).toBe(true);
  });
});
