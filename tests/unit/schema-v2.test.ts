import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportBackup, mergeImport, parseBackup, previewImport, validateAppData } from '../../src/data/backup';

const text = readFileSync(new URL('../fixtures/legacy-v1-ui-backup.json', import.meta.url), 'utf8');
const legacy = () => JSON.parse(text).data;
const metric = (patch: Record<string, unknown> = {}) => ({
  id: 'body-one',
  date: '2026-10-18',
  weightKg: 72.4,
  bodyFatPct: 18.5,
  measurements: { chest: 98, waist: 80, hip: 96, arm: 34, thigh: 55 },
  note: '晨间记录',
  ...patch,
});
const current = () => {
  const data = legacy();
  return { ...data, schemaVersion: 2, bodyMetrics: [], settings: { ...data.settings, showRpe: false } };
};

describe('v1 to v2 data and backup compatibility', () => {
  it('migrates the actual old-app UI export without changing history, snapshots, templates or favorites', () => {
    const old = legacy();
    const imported = parseBackup(text);
    expect(imported.schemaVersion).toBe(2);
    expect(imported.bodyMetrics).toEqual([]);
    expect(imported.settings).toEqual({ ...old.settings, showRpe: false });
    expect(imported.sessions).toEqual(old.sessions);
    expect(imported.templates).toEqual(old.templates);
    expect(imported.exercises).toEqual(old.exercises);
    expect(imported.revision).toBe(0);
    expect(imported.sessions.map((session) => session.status).sort()).toEqual(['completed', 'paused']);
  });
  it('does not mutate v1 input or change its stored revision during pure validation', () => {
    const old = legacy(),
      before = structuredClone(old);
    const migrated = validateAppData(old);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.revision).toBe(old.revision);
    expect(old).toEqual(before);
    expect(validateAppData(migrated)).toEqual(migrated);
  });
  it.each(['empty', 'draft-only', 'large-history'])('migrates %s data without losing records', (kind) => {
    const old = legacy();
    if (kind === 'empty') {
      old.sessions = [];
      old.templates = [];
      old.exercises = [];
    }
    if (kind === 'draft-only')
      old.sessions = old.sessions.filter((session: { status: string }) => session.status === 'paused');
    if (kind === 'large-history') {
      const completed = old.sessions.find((session: { status: string }) => session.status === 'completed');
      old.sessions = Array.from({ length: 1200 }, (_, index) => ({
        ...structuredClone(completed),
        id: `history-${index}`,
      }));
    }
    const upgraded = validateAppData(old);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.sessions).toEqual(old.sessions);
    expect(upgraded.bodyMetrics).toEqual([]);
  });
  it('exports v2 and round-trips optional RPE, every body measurement and notes', () => {
    const data = current();
    data.bodyMetrics = [metric()];
    data.sessions[1].exercises[0].sets[0] = { ...data.sessions[1].exercises[0].sets[0], type: 'drop', rpe: 8.5 };
    const exported = JSON.parse(exportBackup(data));
    expect(exported.formatVersion).toBe(2);
    expect(exported.data.schemaVersion).toBe(2);
    expect(parseBackup(JSON.stringify(exported))).toEqual({ ...data, revision: 0 });
  });
  it('does not accept v2-only fields or set types disguised as legacy v1', () => {
    for (const alter of [
      (data: any) => {
        data.bodyMetrics = [];
      },
      (data: any) => {
        data.settings.showRpe = false;
      },
      (data: any) => {
        data.sessions[0].exercises[0].sets[0].rpe = 8;
      },
      (data: any) => {
        data.sessions[0].exercises[0].sets[0].type = 'failure';
      },
    ]) {
      const old = legacy();
      alter(old);
      expect(() => validateAppData(old)).toThrow();
    }
  });
  it('rejects future versions and mismatched version envelopes', () => {
    for (const [formatVersion, data] of [
      [99, current()],
      [2, legacy()],
      [1, current()],
    ] as const)
      expect(() =>
        parseBackup(JSON.stringify({ app: 'jianlibao', exportedAt: '2026-10-18T06:00:00.000Z', formatVersion, data })),
      ).toThrow('版本');
    expect(() => validateAppData({ ...current(), schemaVersion: 99 })).toThrow('版本');
  });
});

describe('strict v2 validation', () => {
  it.each([6, 6.5, 8, 9.5, 10])('accepts optional half-step RPE %s on new set types', (rpe) => {
    const data = current();
    data.sessions[0].exercises[0].sets[0].type = 'failure';
    data.sessions[0].exercises[0].sets[0].rpe = rpe;
    expect(validateAppData(data).sessions[0].exercises[0].sets[0].rpe).toBe(rpe);
  });
  it.each([5, 10.5, 8.2, NaN, Infinity, '8', null])('rejects invalid RPE %s', (rpe) => {
    const data = current();
    data.sessions[0].exercises[0].sets[0].rpe = rpe;
    expect(() => validateAppData(data)).toThrow('rpe');
  });
  it.each([
    { weightKg: 0 },
    { weightKg: -1 },
    { weightKg: 1001 },
    { bodyFatPct: 101 },
    { weightKg: NaN },
    { measurements: { waist: -1 } },
    { measurements: { unknown: 80 } },
    { date: '2026-02-30' },
    { date: '2026-2-3' },
    { date: '2101-01-01' },
    { unknown: true },
  ])('rejects invalid body payload %j', (patch) => {
    const data = current();
    data.bodyMetrics = [metric(patch)];
    expect(() => validateAppData(data)).toThrow('bodyMetrics');
  });
  it('accepts a partial observation without inventing zero values', () => {
    const data = current();
    data.bodyMetrics = [{ id: 'body-waist', date: '2026-10-17', measurements: { waist: 79.5 } }];
    expect(validateAppData(data).bodyMetrics).toEqual(data.bodyMetrics);
  });
  it('requires at least one measurement and rejects duplicate identities or days', () => {
    const data = current();
    data.bodyMetrics = [{ id: 'body-empty', date: '2026-10-17', note: '只有备注' }];
    expect(() => validateAppData(data)).toThrow('bodyMetrics');
    data.bodyMetrics = [metric(), metric({ id: 'body-two' })];
    expect(() => validateAppData(data)).toThrow('日期');
    data.bodyMetrics = [metric(), metric({ date: '2026-10-17' })];
    expect(() => validateAppData(data)).toThrow('重复');
  });
  it('rejects missing body collection, invalid showRpe and prototype-polluting body fields', () => {
    const data = current();
    delete data.bodyMetrics;
    expect(() => validateAppData(data)).toThrow('缺少字段');
    const invalid = current();
    invalid.settings.showRpe = 'true';
    expect(() => validateAppData(invalid)).toThrow('showRpe');
    const polluted = current();
    polluted.bodyMetrics = [
      JSON.parse('{"id":"body-x","date":"2026-10-18","weightKg":70,"__proto__":{"polluted":true}}'),
    ];
    expect(() => validateAppData(polluted)).toThrow('未知字段');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe('body record import preview and preservation', () => {
  it.each([false, true])('rejects a whole crossing-ID/date batch before mutation, reverse=%s', (reverse) => {
    const local = current(),
      incoming = current();
    local.bodyMetrics = [metric()];
    incoming.bodyMetrics = [metric({ id: 'other-device' }), metric({ date: '2026-10-17', weightKg: 73 })];
    if (reverse) incoming.bodyMetrics.reverse();
    const before = structuredClone(local),
      source = structuredClone(incoming);
    expect(() => previewImport(local, incoming)).toThrow('身体');
    for (const resolution of ['keep-local', 'use-import'] as const)
      expect(() => mergeImport(local, incoming, resolution)).toThrow('身体');
    expect(local).toEqual(before);
    expect(incoming).toEqual(source);
  });
  it('previews additions and deduplicates equal dates despite different imported IDs', () => {
    const local = current(),
      incoming = current();
    local.bodyMetrics = [metric()];
    incoming.bodyMetrics = [metric({ id: 'other-device' }), metric({ id: 'body-new', date: '2026-10-17' })];
    const preview = previewImport(validateAppData(local), validateAppData(incoming));
    expect(preview.added).toBe(1);
    expect(preview.conflicts).toEqual([]);
    const merged = mergeImport(local, incoming, 'use-import');
    expect(merged.bodyMetrics).toHaveLength(2);
    expect(merged.bodyMetrics.find((item) => item.date === '2026-10-18')?.id).toBe('body-one');
  });
  it('reports same-day conflicts and honors both explicit resolutions without touching settings or history', () => {
    const local = current(),
      incoming = current();
    local.bodyMetrics = [metric()];
    incoming.bodyMetrics = [metric({ id: 'other-device', weightKg: 73 })];
    incoming.settings.showRpe = true;
    const before = structuredClone(local);
    expect(previewImport(local, incoming).conflicts).toEqual([expect.objectContaining({ collection: 'bodyMetrics' })]);
    expect(mergeImport(local, incoming, 'keep-local').bodyMetrics).toEqual(local.bodyMetrics);
    const chosen = mergeImport(local, incoming, 'use-import');
    expect(chosen.bodyMetrics).toEqual(incoming.bodyMetrics);
    expect(chosen.settings).toEqual(local.settings);
    expect(chosen.sessions).toEqual(local.sessions);
    expect(local).toEqual(before);
  });
  it('allows an edited date on the same stable ID when no other record occupies that day', () => {
    const local = current(),
      incoming = current();
    local.bodyMetrics = [metric()];
    incoming.bodyMetrics = [metric({ date: '2026-10-17' })];
    expect(previewImport(local, incoming).conflicts).toHaveLength(1);
    expect(mergeImport(local, incoming, 'use-import').bodyMetrics).toEqual(incoming.bodyMetrics);
  });
  it('rejects ambiguous ID/date collisions instead of silently losing either local observation', () => {
    const local = current(),
      incoming = current();
    local.bodyMetrics = [metric(), metric({ id: 'body-two', date: '2026-10-17' })];
    incoming.bodyMetrics = [metric({ id: 'body-two' })];
    const before = structuredClone(local);
    expect(() => mergeImport(local, incoming, 'use-import')).toThrow('身体');
    expect(local).toEqual(before);
  });
});
