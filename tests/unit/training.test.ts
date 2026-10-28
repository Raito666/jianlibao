import { describe, expect, it } from 'vitest';
import { createInitialData } from '../../src/domain/seed';
import { completeSession, createSession, createSessionExercise, pauseSession, resumeSession, reviewSession, sessionStats, toggleSet } from '../../src/domain/training';
import type { Exercise, Session } from '../../src/domain/types';

const start = Date.parse('2026-10-15T10:00:00.000Z');
function workout(): Session {
  const data = createInitialData();
  const session = createSession(null, data.exercises, start);
  session.exercises.push(createSessionExercise(data.exercises[1], 3, 60, 10));
  session.exercises[0].sets[2] = { ...session.exercises[0].sets[2], type: 'warmup', weightKg: 20 };
  return session;
}
function mark(session: Session, index: number, now = start + 1000): Session { return toggleSet(session, session.exercises[0].id, session.exercises[0].sets[index].id, now); }

describe('training calculation and lifecycle', () => {
  it('counts only actual completed work sets in volume and recalculates undo', () => {
    const initial = workout();
    expect(sessionStats(initial).volumeKg).toBe(0);
    const completed = mark(mark(mark(initial, 0), 1), 2);
    expect(sessionStats(completed)).toMatchObject({ completedSets: 3, workSets: 2, volumeKg: 1200, reps: 30, exerciseCount: 1 });
    expect(sessionStats(mark(completed, 0)).volumeKg).toBe(600);
    expect(initial.exercises[0].sets[0].status).toBe('pending');
  });
  it('uses entered total load with no hidden dumbbell or unilateral multiplier', () => {
    const session = workout();
    session.exercises[0].sets[0].weightKg = 40;
    expect(sessionStats(mark(session, 0)).volumeKg).toBe(400);
    session.exercises[0].sets[0].weightKg = 20;
    session.exercises[0].sets[1].weightKg = 20;
    expect(sessionStats(mark(mark(session, 0), 1)).volumeKg).toBe(400);
  });
  it('counts bodyweight reps and timed seconds separately, excluding both from volume', () => {
    const data = createInitialData();
    let session = createSession(null, data.exercises, start);
    session.exercises.push(createSessionExercise(data.exercises.find((item) => item.kind === 'reps')!, 1, 99, 12));
    session.exercises.push(createSessionExercise(data.exercises.find((item) => item.kind === 'duration')!, 1, 99, 99, 45));
    for (const item of session.exercises) session = toggleSet(session, item.id, item.sets[0].id, start + 1000);
    expect(sessionStats(session)).toMatchObject({ completedSets: 2, workSets: 2, reps: 12, durationSeconds: 45, volumeKg: 0 });
  });
  it('starts rest using a deadline and undo cancels rest', () => {
    const done = mark(workout(), 0, start + 5000);
    expect(done.restUntil).toBe(start + 95_000);
    expect(mark(done, 0).restUntil).toBeNull();
    expect(mark({ ...workout(), restDuration: 0 }, 0).restUntil).toBeNull();
  });
  it('excludes active pauses and freezes the finish time in review and archive', () => {
    let session = mark(workout(), 0);
    session = pauseSession(session, start + 10_000);
    expect(sessionStats(session, start + 40_000).activeSeconds).toBe(10);
    session = resumeSession(session, start + 40_000);
    session = reviewSession(session, start + 60_000);
    expect(sessionStats(session, start + 90_000).activeSeconds).toBe(30);
    const completed = completeSession(session, start + 120_000);
    expect(completed.finishedAt).toBe(new Date(start + 60_000).toISOString());
    expect(sessionStats(completed, start + 180_000).activeSeconds).toBe(30);
    expect(completeSession(completed, start + 300_000)).toBe(completed);
  });
  it('returning from review does not count review time as training', () => {
    const reviewed = reviewSession(mark(workout(), 0), start + 10_000);
    const resumed = resumeSession(reviewed, start + 40_000);
    expect(resumed.finishedAt).toBeUndefined();
    expect(sessionStats(resumed, start + 45_000).activeSeconds).toBe(15);
  });
  it('reviewing while paused adds the final pause interval once', () => {
    const reviewed = reviewSession(pauseSession(mark(workout(), 0), start + 5000), start + 100_000);
    expect(sessionStats(reviewed).activeSeconds).toBe(5);
    expect(reviewSession(reviewed, start + 300_000)).toBe(reviewed);
  });
  it('freezes a cancelled session after settling an active pause through review', () => {
    const paused = pauseSession(mark(workout(), 0), start + 5000);
    const cancelled: Session = { ...reviewSession(paused, start + 100_000), status: 'cancelled' };
    expect(cancelled.pausedAt).toBeUndefined();
    expect(cancelled.pausedMs).toBe(95_000);
    expect(sessionStats(cancelled, start + 600_000).activeSeconds).toBe(5);
    expect(sessionStats(cancelled, start + 900_000).activeSeconds).toBe(5);
  });
  it('copies template and exercise snapshots without sharing mutable objects', () => {
    const data = createInitialData();
    const template = data.templates[0];
    const session = createSession(template, data.exercises, start);
    template.name = 'changed'; template.items[0].reps = 77;
    data.exercises[0].name = 'renamed';
    expect(session.name).toBe('全身基础');
    expect(session.exercises[0].exercise.name).toBe('杠铃深蹲');
    expect(session.exercises[0].sets[0].reps).toBe(10);
    expect(session.timeZone).toBeTruthy();
    expect(session.date).toMatch(/^2026-10-15$/);
  });
  it('guards invalid completion and lifecycle transitions without mutation', () => {
    const session = workout(); session.exercises[0].sets[0].reps = 0;
    expect(() => mark(session, 0)).toThrow('次数');
    session.exercises[0].sets[0].reps = 1;
    session.exercises[0].sets[0].weightKg = Number.NaN;
    expect(() => mark(session, 0)).toThrow('重量');
    expect(() => mark(pauseSession(workout(), start + 1000), 0)).toThrow('恢复');
    expect(() => completeSession(workout())).toThrow('回顾');
    expect(() => completeSession(reviewSession(workout(), start + 1000))).toThrow('至少');
  });
  it('rejects nonexistent template references and invalid group counts', () => {
    const data = createInitialData();
    expect(() => createSession(data.templates[0], [], start)).toThrow('动作不存在');
    expect(() => createSessionExercise(data.exercises[0], 101)).toThrow('组数');
    expect(createSession(null, [], start).exercises).toHaveLength(0);
  });
  it('never reports negative elapsed time when the clock moves backwards', () => {
    expect(sessionStats(workout(), start - 1000).activeSeconds).toBe(0);
  });
});
