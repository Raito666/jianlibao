import { describe, it, expect } from 'vitest';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise } from '../../src/domain/training';
import { totals, exercisePerformance, estimate1RM, personalRecords, muscleBalance, periodBounds, shiftDate, monday, trainingStreak, periodSeries, csvRecords } from '../../src/domain/analytics';
import { builtinExercises, catalogEntries, guideFor, mediaUrls, expandCatalog } from '../../src/content/catalog';
import { exportBackup, parseBackup } from '../../src/data/backup';

const seed = createInitialData();
function recorded(date: string, weight = 60, reps = 10) {
  const s = createSession(seed.templates[0], seed.exercises, Date.parse(`${date}T02:00:00Z`));
  s.status = 'completed'; s.date = date; s.finishedAt = `${date}T02:30:00.000Z`; s.updatedAt = s.finishedAt;
  s.exercises = [createSessionExercise(seed.exercises[0], 3, weight, reps)];
  s.exercises[0].sets[0].status = 'completed'; s.exercises[0].sets[1] = { ...s.exercises[0].sets[1], status: 'completed', type: 'warmup', weightKg: 200 };
  return s;
}
describe('complete movement content', () => {
  it('contains 302 unique Chinese entries with complete technique and three artwork frames each', () => {
    expect(builtinExercises).toHaveLength(302); expect(new Set(builtinExercises.map(ex=>ex.id)).size).toBe(302); expect(mediaUrls).toHaveLength(906);
    expect(new Set(mediaUrls).size).toBe(906);
    for (const ex of builtinExercises) { const guide=guideFor(ex)!; expect(ex.name).toMatch(/[\u4e00-\u9fff]/); expect(guide.steps.length).toBeGreaterThanOrEqual(3); expect(guide.steps.every(step=>step.length>10)).toBe(true); expect(guide.quickSteps).toHaveLength(3); expect(guide.quickSteps.every(step=>step.length>=6 && step.length<=65),`${ex.name}: ${guide.quickSteps.join(' / ')}`).toBe(true); expect(guide.cues.length).toBeGreaterThan(0); expect(guide.mistakes.length).toBeGreaterThan(0); expect(guide.variation.length).toBeGreaterThan(15); }
    expect(catalogEntries.filter(ex=>ex.id.startsWith('ex-'))).toHaveLength(12);
  });
  it('appends missing builtins without overwriting existing user fields or training snapshots', () => {
    const old=createInitialData(); old.exercises=old.exercises.slice(0,12); old.exercises[0].description='我的个人器械提示'; old.sessions=[recorded('2026-10-01')];
    const snapshot=structuredClone(old.sessions); const expanded=expandCatalog(old);
    expect(expanded.exercises).toHaveLength(302); expect(expanded.exercises[0].description).toBe('我的个人器械提示'); expect(expanded.sessions).toEqual(snapshot); expect(old.exercises).toHaveLength(12); expect(expandCatalog(expanded)).toBe(expanded);
  });
  it('round trips manual history and favorites through the existing JSON backup format', () => {
    const data=createInitialData(); data.sessions=[{...recorded('2026-10-01'),recordedManually:true}]; data.settings.favoriteExerciseIds=['ex-squat','catalog-dumbbell-bench-press'];
    const restored=parseBackup(exportBackup(data)); expect(restored.sessions).toEqual(data.sessions); expect(restored.settings.favoriteExerciseIds).toEqual(data.settings.favoriteExerciseIds); expect(restored.exercises).toEqual(data.exercises);
  });
});
describe('training analytics with explicit units and time bounds', () => {
  it('excludes warmups, pending and cancelled sessions; separates bodyweight repetitions and seconds', () => {
    const s=recorded('2026-10-01'); const pushup=createSessionExercise(seed.exercises.find(ex=>ex.id==='ex-pushup')!,1,0,12); pushup.sets[0].status='completed';
    const plank=createSessionExercise(seed.exercises.find(ex=>ex.id==='ex-plank')!,1,0,0,45); plank.sets[0].status='completed'; s.exercises.push(pushup,plank);
    const cancelled={...recorded('2026-10-02',100),status:'cancelled' as const};
    expect(totals([s,cancelled])).toMatchObject({sessions:1,days:1,sets:3,volumeKg:600,seconds:1800,bodyweightReps:12,durationSeconds:45});
    expect(muscleBalance([s,cancelled]).reduce((n,m)=>n+m.sets,0)).toBe(3);
  });
  it('aggregates repeated blocks of one exercise once per session without losing any sets', () => {
    const s=recorded('2026-10-01'); const extra=createSessionExercise(s.exercises[0].exercise,1,70,8); extra.sets[0].status='completed'; s.exercises.push(extra);
    expect(exercisePerformance([s],'ex-squat')).toMatchObject([{sets:2,maxWeightKg:70,volumeKg:1160,e1rmKg:70*(1+8/30)}]);
  });
  it('limits Epley estimates to positive external weight and 1-10 repetitions', () => {
    expect(estimate1RM(100,1)).toBe(100); expect(estimate1RM(60,10)).toBe(80); expect(estimate1RM(60,11)).toBeNull(); expect(estimate1RM(0,8)).toBeNull(); expect(estimate1RM(60,2.5)).toBeNull();
    const s=recorded('2026-10-01'); const ex=builtinExercises.find(ex=>ex.id==='catalog-weighted-pull-up')!; s.exercises=[createSessionExercise(ex,1,20,5)]; s.exercises[0].sets[0].status='completed';
    expect(exercisePerformance([s],ex.id)[0].e1rmKg).toBeNull();
  });
  it('keeps changed recording types separate when an imported identity was reused', () => {
    const old=recorded('2026-10-01'); const current=recorded('2026-10-02');
    current.exercises[0].exercise={...current.exercises[0].exercise,kind:'reps'};
    expect(exercisePerformance([old,current],'ex-squat','weight-reps')).toHaveLength(1);
    expect(exercisePerformance([old,current],'ex-squat','reps')[0]).toMatchObject({maxWeightKg:0,volumeKg:0,e1rmKg:null,maxReps:10});
  });
  it('recomputes best records after correction and deletion, independent of input ordering', () => {
    const low=recorded('2026-09-01',60); const high=recorded('2026-10-01',80);
    expect(personalRecords([high,low])[0]).toMatchObject({value:80,date:'2026-10-01',previous:60});
    high.exercises[0].sets[0].weightKg=50; expect(personalRecords([high,low])[0].value).toBe(60); expect(personalRecords([high])[0].value).toBe(50);
  });
  it('uses local date strings across DST and month/year boundaries', () => {
    expect(shiftDate('2026-03-08',1)).toBe('2026-03-09'); expect(shiftDate('2026-01-01',-1)).toBe('2025-12-31'); expect(monday('2026-10-18')).toBe('2026-10-12');
    expect(periodBounds('7','2026-10-16',[])).toEqual({from:'2026-10-10',to:'2026-10-16'});
    expect(periodBounds('all','2026-10-16',[recorded('2025-01-02')]).from).toBe('2025-01-02');
  });
  it('counts consecutive natural weeks without requiring daily training', () => {
    const sessions=['2026-10-02','2026-10-06','2026-10-14'].map(date=>recorded(date));
    expect(trainingStreak(sessions,'2026-10-16')).toBe(3); expect(trainingStreak(sessions,'2026-10-21')).toBe(3); expect(trainingStreak(sessions,'2026-10-28')).toBe(0);
  });
  it('bucket totals equal the selected period totals and exclude adjacent outside records', () => {
    const sessions=['2026-09-30','2026-10-01','2026-10-31','2026-11-01'].map(date=>recorded(date));
    const series=periodSeries(sessions,'2026-10-01','2026-10-31'); expect(series).toHaveLength(31); expect(series.reduce((n,p)=>n+p.sessions,0)).toBe(2); expect(series.reduce((n,p)=>n+p.volumeKg,0)).toBe(1200);
  });
  it('exports real original kg values and escapes formula text and quotes for CSV', () => {
    const s=recorded('2026-10-01'); s.name='=SUM(A1)'; s.note='包含"引号",换行\n下一行'; const csv=csvRecords([s]);
    expect(csv.startsWith('\ufeff')).toBe(true); expect(csv).toContain("'=SUM(A1)"); expect(csv).toContain('包含""引号"",换行\n下一行'); expect(csv).toContain('"60","10"');
  });
});
