import { isWorkSet } from './sets';
import type { Exercise, Session, SessionExercise, SessionStats, WorkoutTemplate } from './types';

export function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function timestamp(now: number): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 4_102_444_800_000) throw new Error('训练时间无效');
  return new Date(now).toISOString();
}

export function createSessionExercise(exercise: Exercise, setCount = 3, weightKg = 0, reps = 10, durationSeconds = 30): SessionExercise {
  if (!Number.isInteger(setCount) || setCount < 1 || setCount > 100) throw new Error('组数须为 1–100');
  if (!Number.isFinite(weightKg) || weightKg < 0 || weightKg > 5000 || !Number.isInteger(reps) || reps < 0 || reps > 100_000 || !Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 604_800) throw new Error('目标重量、次数或时长超出记录范围');
  return {
    id: uid(), exercise: structuredClone(exercise), note: '',
    sets: Array.from({ length: setCount }, () => ({ id: uid(), type: 'work', weightKg, reps, durationSeconds, status: 'pending' })),
  };
}

export function createSession(template: WorkoutTemplate | null, exercises: Exercise[], now = Date.now()): Session {
  const startedAt = timestamp(now);
  const date = new Date(now);
  return {
    id: uid(), name: template?.name ?? '自由训练', ...(template ? { templateId: template.id } : {}),
    startedAt, updatedAt: startedAt,
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, status: 'active', pausedMs: 0,
    restUntil: null, restDuration: template?.restSeconds ?? 90, note: '',
    exercises: template?.items.map((item) => {
      const exercise = exercises.find((candidate) => candidate.id === item.exerciseId);
      if (!exercise) throw new Error('模板中的动作不存在，请先修正模板');
      return createSessionExercise(exercise, item.sets, item.weightKg, item.reps, item.durationSeconds);
    }) ?? [],
  };
}

export function toggleSet(session: Session, exerciseId: string, setId: string, now = Date.now()): Session {
  if (session.status !== 'active') throw new Error('请先恢复训练，再记录本组');
  const exercise = session.exercises.find((item) => item.id === exerciseId);
  const set = exercise?.sets.find((item) => item.id === setId);
  if (!exercise || !set) throw new Error('找不到本组记录');
  const undo = set.status === 'completed';
  if (!undo) {
    if (exercise.exercise.kind === 'weight-reps' && (!Number.isFinite(set.weightKg) || set.weightKg < 0 || set.weightKg > 5000)) throw new Error('重量须在 0–5000 kg 之间');
    if (exercise.exercise.kind !== 'duration' && (!Number.isInteger(set.reps) || set.reps < 1 || set.reps > 100_000)) throw new Error('次数须为 1–100000 的整数');
    if (exercise.exercise.kind === 'duration' && (!Number.isInteger(set.durationSeconds) || set.durationSeconds < 1 || set.durationSeconds > 604_800)) throw new Error('时长须为 1–604800 秒的整数');
  }
  return {
    ...session, updatedAt: timestamp(now), restUntil: undo || session.restDuration === 0 ? null : now + session.restDuration * 1000,
    exercises: session.exercises.map((item) => item.id !== exerciseId ? item : {
      ...item, sets: item.sets.map((record) => record.id !== setId ? record : { ...record, status: undo ? 'pending' : 'completed' }),
    }),
  };
}

export function pauseSession(session: Session, now = Date.now()): Session {
  if (session.status === 'paused') return session;
  if (session.status !== 'active') throw new Error('当前训练不能暂停');
  return { ...session, status: 'paused', pausedAt: now, updatedAt: timestamp(now), restUntil: null };
}

export function resumeSession(session: Session, now = Date.now()): Session {
  if (session.status === 'active') return session;
  if (session.status !== 'paused' && session.status !== 'review') throw new Error('当前训练不能恢复');
  const { pausedAt, finishedAt, ...rest } = session;
  const pausedMs = session.pausedMs + (pausedAt !== undefined ? Math.max(0, now - pausedAt) : finishedAt ? Math.max(0, now - Date.parse(finishedAt)) : 0);
  return { ...rest, status: 'active', pausedMs, updatedAt: timestamp(now), restUntil: null };
}

export function reviewSession(session: Session, now = Date.now()): Session {
  if (session.status === 'review') return session;
  if (session.status !== 'active' && session.status !== 'paused') throw new Error('当前训练不能进入回顾');
  const { pausedAt, ...rest } = session;
  return {
    ...rest, status: 'review', finishedAt: timestamp(now), updatedAt: timestamp(now), restUntil: null,
    pausedMs: session.pausedMs + (pausedAt === undefined ? 0 : Math.max(0, now - pausedAt)),
  };
}

export function completeSession(session: Session, now = Date.now()): Session {
  if (session.status === 'completed') return session;
  if (session.status !== 'review') throw new Error('请先检查训练回顾');
  if (sessionStats(session).completedSets === 0) throw new Error('至少完成一组后才能保存训练；也可返回继续或取消');
  return { ...session, status: 'completed', updatedAt: timestamp(now), restUntil: null };
}

export function sessionStats(session: Session, now = Date.now()): SessionStats {
  const result: SessionStats = { completedSets: 0, workSets: 0, volumeKg: 0, reps: 0, durationSeconds: 0, activeSeconds: 0, exerciseCount: 0 };
  for (const item of session.exercises) {
    const completed = item.sets.filter((set) => set.status === 'completed');
    if (completed.length > 0) result.exerciseCount++;
    for (const set of completed) {
      result.completedSets++;
      if (isWorkSet(set)) result.workSets++;
      if (item.exercise.kind === 'duration') result.durationSeconds += set.durationSeconds;
      else result.reps += set.reps;
      if (isWorkSet(set) && item.exercise.kind === 'weight-reps') result.volumeKg += set.weightKg * set.reps;
    }
  }
  const end = session.finishedAt ? Date.parse(session.finishedAt) : now;
  const pendingPause = session.pausedAt === undefined ? 0 : Math.max(0, end - session.pausedAt);
  result.activeSeconds = Math.max(0, Math.floor((end - Date.parse(session.startedAt) - session.pausedMs - pendingPause) / 1000));
  result.volumeKg = Math.round(result.volumeKg * 1_000_000) / 1_000_000;
  return result;
}
