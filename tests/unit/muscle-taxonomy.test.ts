import { describe, expect, it } from 'vitest';
import { muscleGroups, exerciseMuscles, muscleLabel, primaryMuscle } from '../../src/content/body-map';
import { builtinExercises } from '../../src/content/catalog';
import { muscleBalance, totals } from '../../src/domain/analytics';
import { createSession, createSessionExercise } from '../../src/domain/training';
import type { Exercise } from '../../src/domain/types';

const custom = (muscle: string): Exercise => ({
  id: `custom-${muscle}`,
  name: '个人动作',
  muscle,
  equipment: '自重',
  kind: 'reps',
  description: '',
});
describe('单一16肌群展示口径', () => {
  for (const group of muscleGroups)
    it(`自定义${group.label}精确对应同名肌群`, () => {
      const ex = custom(group.label),
        before = structuredClone(ex);
      expect(exerciseMuscles(ex).primary).toEqual([group.id]);
      expect(primaryMuscle(ex)).toBe(group.id);
      expect(muscleLabel(ex)).toBe(group.label);
      expect(ex).toEqual(before);
    });
  it('所有内置动作可归入16肌群，显示不依赖持久化旧标签', () => {
    for (const ex of builtinExercises) {
      expect(muscleGroups.map((g) => g.id)).toContain(primaryMuscle(ex));
      expect(muscleGroups.map((g) => g.label)).toContain(muscleLabel(ex));
    }
  });
  it('旧自定义动作保留宽泛标签，不猜测手臂或全身', () => {
    for (const label of ['手臂', '全身', '背部', '腿部', '下肢', '核心', '后侧链', '未命名肌群']) {
      const ex = custom(label);
      expect(primaryMuscle(ex)).toBeUndefined();
      expect(muscleLabel(ex)).toBe(`${label} · 未细分`);
      expect(ex.muscle).toBe(label);
    }
    expect(muscleLabel(custom('胸大肌'))).toBe('胸部');
  });
  it('复合旧标签即使只有一个片段被识别也不能变成确定的单一肌群', () => {
    for (const label of ['胸部/背部', '胸部、手臂', '大腿前侧/臀部', '胸部+背部', '胸部与未知肌群']) {
      const ex = custom(label);
      expect(exerciseMuscles(ex).primary).toEqual([]);
      expect(primaryMuscle(ex)).toBeUndefined();
      expect(muscleLabel(ex)).toBe(`${label} · 未细分`);
      const session = createSession(null, [], Date.parse('2026-10-18T06:00:00Z'));
      session.status = 'completed';
      session.exercises = [createSessionExercise(ex, 1)];
      session.exercises[0].sets[0].status = 'completed';
      expect(muscleBalance([session])).toEqual([{ name: '未细分', sets: 1 }]);
      expect(ex.muscle).toBe(label);
    }
  });
  it('统计每个完成的非热身组只归一类，未细分不丢组数且不改历史快照', () => {
    const s = createSession(null, [], Date.parse('2026-10-18T06:00:00Z'));
    s.status = 'completed';
    s.exercises = ['侧腹', '大腿后侧', '全身'].map((label) => {
      const ex = createSessionExercise(custom(label), 5);
      ex.sets.forEach((set, i) => {
        set.status = i === 4 ? 'skipped' : 'completed';
        set.type = (['work', 'drop', 'failure', 'warmup', 'work'] as const)[i];
      });
      return ex;
    });
    const before = structuredClone(s),
      groups = muscleBalance([s]);
    expect(groups).toEqual(
      expect.arrayContaining([
        { name: '侧腹', sets: 3 },
        { name: '大腿后侧', sets: 3 },
        { name: '未细分', sets: 3 },
      ]),
    );
    expect(groups.reduce((n, g) => n + g.sets, 0)).toBe(totals([s]).sets);
    expect(s).toEqual(before);
  });
});
