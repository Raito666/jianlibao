import { describe, expect, it } from 'vitest';
import { exportBackup, mergeImport, parseBackup, previewImport, validateAppData } from '../../src/data/backup';
import { createInitialData } from '../../src/domain/seed';
import { completeSession, createSession, createSessionExercise, reviewSession, toggleSet } from '../../src/domain/training';
import type { AppData } from '../../src/domain/types';

const now = Date.parse('2026-10-15T10:00:00.000Z');
function recordedData(): AppData {
  const data = createInitialData();
  let session = createSession(data.templates[0], data.exercises, now);
  session.exercises[0].sets[0].weightKg = 60;
  session = toggleSet(session, session.exercises[0].id, session.exercises[0].sets[0].id, now + 1000);
  data.sessions.push(completeSession(reviewSession(session, now + 60_000), now + 90_000));
  data.revision = 42;
  return data;
}
function corrupt(mutate: (value: any) => void): () => AppData {
  const data = JSON.parse(exportBackup(recordedData()));
  mutate(data);
  return () => parseBackup(JSON.stringify(data));
}

describe('versioned backup validation', () => {
  it('round trips every record, snapshot, date and preference, discarding imported revision', () => {
    const source = recordedData();
    expect(parseBackup(exportBackup(source))).toEqual({ ...source, revision: 0 });
  });
  it('rejects invalid JSON, oversized bytes and wrong application/version envelopes', () => {
    expect(() => parseBackup('{')).toThrow('JSON');
    expect(() => parseBackup('中'.repeat(4 * 1024 * 1024))).toThrow('10 MB');
    expect(corrupt((v) => { v.app = 'other'; })).toThrow('不是健力宝');
    expect(corrupt((v) => { v.formatVersion = 99; })).toThrow('版本');
    expect(corrupt((v) => { v.data.schemaVersion = 999; })).toThrow('版本');
  });
  it('rejects missing/unknown and prototype-polluting keys', () => {
    expect(corrupt((v) => { delete v.data.settings; })).toThrow('缺少字段');
    expect(corrupt((v) => { v.data.surprise = true; })).toThrow('未知字段');
    expect(corrupt((v) => { v.data.exercises[0] = JSON.parse('{"__proto__":{"polluted":true}}'); })).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('rejects invalid enums, numeric ranges, dates and time zones', () => {
    for (const mutate of [
      (v: any) => { v.data.exercises[0].kind = 'calories'; },
      (v: any) => { v.data.sessions[0].exercises[0].sets[0].weightKg = -1; },
      (v: any) => { v.data.sessions[0].exercises[0].sets[0].reps = 1.5; },
      (v: any) => { v.data.sessions[0].exercises[0].sets[0].reps = 0; },
      (v: any) => { v.data.sessions[0].date = '2026-02-30'; },
      (v: any) => { v.data.sessions[0].timeZone = 'Mars/City'; },
      (v: any) => { v.data.sessions[0].startedAt = '2026-10-15'; },
      (v: any) => { v.data.settings.autoRest = 'true'; },
      (v: any) => { v.data.settings.defaultRest = 100_000; },
      (v: any) => { v.data.sessions[0].pausedMs = 900_000; },
      (v: any) => { v.data.sessions[0].updatedAt = '2026-10-14T00:00:00.000Z'; },
    ]) expect(corrupt(mutate)).toThrow('备份');
  });
  it('rejects duplicate IDs and dangling current template references', () => {
    expect(corrupt((v) => { v.data.exercises.push(v.data.exercises[0]); })).toThrow('重复');
    expect(corrupt((v) => { v.data.templates[0].items[0].exerciseId = 'missing'; })).toThrow('引用');
    expect(corrupt((v) => { v.data.sessions[0].exercises[0].sets.push(v.data.sessions[0].exercises[0].sets[0]); })).toThrow('重复');
  });
  it('permits historical snapshots whose library or template has since been removed', () => {
    const data = recordedData(); data.templates = []; data.exercises = [];
    expect(parseBackup(exportBackup(data)).sessions[0].exercises[0].exercise.name).toBe('杠铃深蹲');
  });
  it('rejects inconsistent lifecycle state or more than one unfinished session', () => {
    expect(corrupt((v) => { delete v.data.sessions[0].finishedAt; })).toThrow('结束时间');
    expect(corrupt((v) => { v.data.sessions[0].status = 'paused'; delete v.data.sessions[0].finishedAt; })).toThrow('暂停');
    const data = createInitialData(); data.sessions = [createSession(null, [], now), createSession(null, [], now)];
    expect(() => validateAppData(data)).toThrow('一场');
  });
});

describe('preview and merge by stable identity', () => {
  it('deduplicates identical data independently of object key order', () => {
    const local = recordedData();
    const incoming = parseBackup(exportBackup(local));
    incoming.exercises[0] = Object.fromEntries(Object.entries(incoming.exercises[0]).reverse()) as typeof incoming.exercises[0];
    expect(previewImport(local, incoming)).toMatchObject({ added: 0, unchanged: local.exercises.length + local.templates.length + local.sessions.length, conflicts: [], settingsChanged: false });
    expect(mergeImport(local, incoming, 'use-import').sessions).toHaveLength(1);
  });
  it('reports conflicts and applies the selected choice without replacing local preferences or revision', () => {
    const local = recordedData(); const incoming = structuredClone(local);
    incoming.exercises[0].name = '导入动作名';
    incoming.settings.theme = 'light'; incoming.settings.unit = 'lb'; incoming.revision = 999;
    expect(previewImport(local, incoming).conflicts).toEqual([{ id: 'ex-squat', collection: 'exercises', name: '导入动作名' }]);
    expect(mergeImport(local, incoming, 'keep-local').exercises[0].name).toBe('杠铃深蹲');
    const merged = mergeImport(local, incoming, 'use-import');
    expect(merged.exercises[0].name).toBe('导入动作名');
    expect(merged.settings).toEqual(local.settings); expect(merged.revision).toBe(42);
    expect(local.exercises[0].name).toBe('杠铃深蹲');
  });
  it('adds distinct records without losing any current records', () => {
    const local = recordedData(); const incoming = createInitialData();
    incoming.exercises.push({ ...incoming.exercises[0], id: 'custom-new', name: '新动作' });
    expect(previewImport(local, incoming).added).toBe(1);
    const merged = mergeImport(local, incoming, 'keep-local');
    expect(merged.exercises).toHaveLength(local.exercises.length + 1); expect(merged.sessions).toEqual(local.sessions);
  });
  it('rejects merging two drafts instead of silently discarding either', () => {
    const local = createInitialData(); const incoming = createInitialData();
    local.sessions.push(createSession(null, [], now)); incoming.sessions.push(createSession(null, [], now));
    expect(() => mergeImport(local, incoming, 'use-import')).toThrow('两场未完成');
    expect(local.sessions).toHaveLength(1); expect(incoming.sessions).toHaveLength(1);
  });
});
