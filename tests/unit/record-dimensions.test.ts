import { describe, expect, it } from 'vitest';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise, sessionStats } from '../../src/domain/training';
import { csvRecords, exercisePerformance, muscleBalance, personalRecords, totals } from '../../src/domain/analytics';
import { lastWorkSet, nextSuggestedSet, seedExercise } from '../../src/features/workout/performance';
import type { SetType } from '../../src/domain/types';
const exercise = createInitialData().exercises[0];
function history(types: SetType[] = ['warmup', 'work', 'drop', 'failure']) {
  const start = Date.parse('2026-10-16T00:00:00.000Z');
  const session = createSession(null, [exercise], start);
  session.status = 'completed';
  session.finishedAt = session.updatedAt = new Date(start + 60_000).toISOString();
  const item = createSessionExercise(exercise, types.length, 50, 10);
  item.sets = item.sets.map((set, i) => ({
    ...set,
    type: types[i],
    status: 'completed',
    rpe: 8.5,
    weightKg: 50 + 10 * i,
  }));
  session.exercises = [item];
  return session;
}
describe('new record dimensions preserve existing calculations', () => {
  it('includes completed drop/failure sets while excluding warmups in every analytics path', () => {
    const s = history();
    expect(sessionStats(s)).toMatchObject({ completedSets: 4, workSets: 3, volumeKg: 2100 });
    expect(totals([s])).toMatchObject({ sets: 3, volumeKg: 2100 });
    expect(exercisePerformance([s], exercise.id)[0]).toMatchObject({ sets: 3, maxWeightKg: 80, volumeKg: 2100 });
    expect(muscleBalance([s])[0].sets).toBe(3);
    expect(personalRecords([s])[0].value).toBe(80);
  });
  it('never counts pending or skipped new types', () => {
    const s = history(['drop', 'failure']);
    s.exercises[0].sets[0].status = 'pending';
    s.exercises[0].sets[1].status = 'skipped';
    expect(sessionStats(s).volumeKg).toBe(0);
    expect(exercisePerformance([s], exercise.id)).toEqual([]);
  });
  it('keeps formal-set priority and falls back to drop/failure only when no valid formal history exists', () => {
    const s = history();
    expect(lastWorkSet([s], exercise, '2026-10-18')?.type).toBe('work');
    const fallback = history(['warmup', 'drop', 'failure']);
    expect(lastWorkSet([fallback], exercise, '2026-10-18')?.type).toBe('failure');
  });
  it('does not pretend that subjective RPE was exerted on suggested or seeded new sets', () => {
    const s = history(['drop']);
    const next = nextSuggestedSet(s.exercises[0], [s], 'new', '2026-10-18');
    expect(next).toMatchObject({ type: 'drop', weightKg: 50, reps: 10, status: 'pending' });
    expect(next).not.toHaveProperty('rpe');
    const seeded = seedExercise(createSessionExercise(exercise, 1), [s], '2026-10-18');
    expect(seeded.sets[0].weightKg).toBe(50);
    expect(seeded.sets[0]).not.toHaveProperty('rpe');
  });
  it('exports all type labels and optional RPE without shifting the original CSV columns', () => {
    const s = history();
    delete s.exercises[0].sets[0].rpe;
    const rows = csvRecords([s]).split('\r\n');
    expect(rows[0]).toContain('"动作备注","RPE"');
    expect(rows[1]).toContain('"热身"');
    expect(rows[3]).toContain('"递减"');
    expect(rows[4]).toContain('"力竭"');
    expect(rows[4]).toMatch(/,"8.5"$/);
  });
});
