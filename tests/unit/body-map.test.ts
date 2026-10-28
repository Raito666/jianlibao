import { describe, it, expect } from 'vitest';
import { builtinExercises } from '../../src/content/catalog';
import { exerciseMuscles, matchesBodyTarget, muscleGroups, jointGroups } from '../../src/content/body-map';

const exercise = (id:string) => builtinExercises.find(ex=>ex.id===id)!;
describe('body navigation metadata',()=>{
  it('classifies every built-in without empty or duplicate targets',()=>{
    for(const ex of builtinExercises){
      const {primary,secondary}=exerciseMuscles(ex);
      expect(primary.length,ex.name).toBeGreaterThan(0);
      expect(new Set([...primary,...secondary]).size).toBe(primary.length+secondary.length);
      for(const id of [...primary,...secondary])expect(muscleGroups.some(g=>g.id===id)).toBe(true);
    }
    for(const target of [...muscleGroups,...jointGroups])expect(builtinExercises.some(ex=>matchesBodyTarget(ex,target.id)),target.label).toBe(true);
  });
  it('distinguishes primary from assisting muscles and preserves selected data',()=>{
    const bench=exercise('ex-bench');
    expect(bench).toBeDefined();
    const before=JSON.stringify(bench);
    expect(matchesBodyTarget(bench,'chest')).toBe(true);
    expect(matchesBodyTarget(bench,'triceps')).toBe(false);
    expect(matchesBodyTarget(bench,'triceps',true)).toBe(true);
    expect(matchesBodyTarget(bench,'shoulders')).toBe(true);
    expect(matchesBodyTarget(bench,'knees')).toBe(false);
    expect(JSON.stringify(bench)).toBe(before);
  });
  it('maps oblique work and adductor stretches intentionally; keeps custom descriptions',()=>{
    expect(exerciseMuscles(exercise('catalog-russian-twist')).primary).toContain('obliques');
    expect(exerciseMuscles(exercise('catalog-butterfly-stretch')).primary).toEqual(['adductors']);
    const custom={id:'my-own',name:'我的动作',muscle:'胸部',equipment:'自定义',kind:'reps' as const,description:'个人提示'};
    expect(matchesBodyTarget(custom,'chest')).toBe(true);
    expect(matchesBodyTarget(custom,'elbows')).toBe(false);
    expect(custom.description).toBe('个人提示');
  });
});
