import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createInitialData } from '../../src/domain/seed';
import { createSession } from '../../src/domain/training';
import { exportBackup, parseBackup, validateAppData } from '../../src/data/backup';
import { applySnapshot, emptySnapshot, mergeSnapshots, snapshotOf } from '../../src/sync/model';
import { createSecret, credentials, decryptSnapshot, encryptSnapshot } from '../../src/sync/crypto';
import { migrateSyncState, readSyncState, writeSyncState } from '../../src/sync/store';

const body = (weightKg = 70, id = 'body-a') => ({ id, date: '2026-10-26', weightKg, note: '私人身体记录' });
const data = () => { const d = createInitialData(); d.onboarded = true; return d; };

describe('cloud snapshot merge / no change to workspace schema', () => {
  it('excludes drafts, preferences, revisions and credentials from the shared projection', () => {
    const d = data(); d.sessions.push(createSession(null, d.exercises, Date.now()));
    expect(Object.keys(snapshotOf(d)).sort()).toEqual(['bodyMetrics', 'exercises', 'sessions', 'templates', 'tombstones', 'version']);
    expect(snapshotOf(d).sessions).toEqual([]);
  });
  it('merges disjoint additions from an empty cloud without erasing local history', () => {
    const a = data(), b = data(); a.bodyMetrics = [body()];
    b.bodyMetrics = [{ ...body(72, 'body-b'), date: '2026-10-25' }];
    const result = mergeSnapshots(emptySnapshot(), snapshotOf(a), snapshotOf(b));
    expect(result.conflicts).toEqual([]); expect(result.snapshot.bodyMetrics).toHaveLength(2);
  });
  it('propagates a known deletion while retaining unrelated local additions', () => {
    const d = data(); d.bodyMetrics = [body()]; const base = snapshotOf(d);
    const local = structuredClone(base); local.bodyMetrics.push({ ...body(73, 'second'), date: '2026-10-24' });
    const remote = structuredClone(base); remote.bodyMetrics = [];
    const result = mergeSnapshots(base, local, remote);
    expect(result.conflicts).toEqual([]); expect(result.snapshot.bodyMetrics.map(x => x.id)).toEqual(['second']);
  });
  it('retains deletion evidence so an old backup on a newly connected device cannot silently resurrect a record', () => {
    const d = data(); d.bodyMetrics = [body()]; const base = snapshotOf(d);
    const erased = structuredClone(base); erased.bodyMetrics = [];
    const deleted = mergeSnapshots(base, erased, base).snapshot;
    expect(deleted).toHaveProperty('tombstones', ['bodyMetrics:2026-10-26']);
    const rejoin = mergeSnapshots(emptySnapshot(), base, deleted);
    expect(rejoin.conflicts).toHaveLength(1);
    const resolved = mergeSnapshots(emptySnapshot(), base, deleted, { 'bodyMetrics:2026-10-26': 'remote' });
    expect(resolved.snapshot.bodyMetrics).toEqual([]);
  });
  it('does not silently resolve concurrent edits or delete/edit conflicts', () => {
    const d = data(); d.bodyMetrics = [body()]; const base = snapshotOf(d);
    const local = structuredClone(base), remote = structuredClone(base);
    local.bodyMetrics[0].weightKg = 71; remote.bodyMetrics[0].weightKg = 72;
    expect(mergeSnapshots(base, local, remote).conflicts[0].key).toBe('bodyMetrics:2026-10-26');
    remote.bodyMetrics = []; expect(mergeSnapshots(base, local, remote).conflicts).toHaveLength(1);
  });
  it('detects same-day records with different IDs and resolves only the explicitly chosen record', () => {
    const a = data(), b = data(); a.bodyMetrics = [body()]; b.bodyMetrics = [body(75, 'other-device')];
    const result = mergeSnapshots(emptySnapshot(), snapshotOf(a), snapshotOf(b), { 'bodyMetrics:2026-10-26': 'remote' });
    expect(result.conflicts).toEqual([]); expect(result.snapshot.bodyMetrics).toEqual(b.bodyMetrics);
  });
  it('keeps training drafts and device settings when applying shared records', () => {
    const d = data(); const draft = createSession(null, d.exercises, Date.now()); d.sessions.push(draft);
    d.settings.theme = 'light'; d.settings.unit = 'lb'; const cloud = snapshotOf(d); cloud.bodyMetrics = [body()];
    const applied = applySnapshot(d, cloud);
    expect(applied.sessions).toEqual([draft]); expect(applied.settings).toEqual(d.settings);
    expect(applied.revision).toBe(d.revision); expect(applied.bodyMetrics).toEqual([body()]);
    expect(d.bodyMetrics).toEqual([]);
  });
  it('protects a local draft with the same ID as a remotely archived training', () => {
    const d = data(); const session = createSession(null, d.exercises, Date.now()); d.sessions.push(session);
    const cloud = snapshotOf(d); cloud.sessions.push({ ...session, status: 'cancelled' });
    expect(() => applySnapshot(d, cloud)).toThrow(/进行中/);
  });
  it('retains original format-v2 backup compatibility and rejects sync fields inside AppData', () => {
    const d = data(); d.bodyMetrics = [body()];
    expect(parseBackup(exportBackup(d))).toEqual(d);
    expect(() => validateAppData({ ...d, syncSecret: createSecret() })).toThrow(/未知字段/);
  });
});

describe('encrypted personal vault', () => {
  it('creates 256-bit recovery keys and domain-separated authentication/encryption', async () => {
    const secret = createSecret(); expect(secret).toMatch(/^JLB1-[A-Za-z0-9_-]{43}$/);
    expect(createSecret()).not.toBe(secret);
    const a = await credentials(secret), b = await credentials(secret);
    expect(a.token).toBe(b.token); expect(a.id).toBe(b.id); expect(a.token).not.toContain(secret.slice(5));
    await expect(credentials('password')).rejects.toThrow(/同步密钥/);
  });
  it('encrypts with a fresh IV and authenticates the entire snapshot', async () => {
    const secret = createSecret(), snapshot = snapshotOf(data()); snapshot.bodyMetrics = [body()];
    const encrypted = await encryptSnapshot(secret, snapshot);
    expect(JSON.stringify(encrypted)).not.toContain('私人身体记录');
    expect(await decryptSnapshot(secret, encrypted)).toEqual(snapshot);
    expect((await encryptSnapshot(secret, snapshot)).iv).not.toBe(encrypted.iv);
    await expect(decryptSnapshot(createSecret(), encrypted)).rejects.toThrow();
    await expect(decryptSnapshot(secret, { ...encrypted, iv: 'AAAAAAAAAAAAAAAA' })).rejects.toThrow();
  });
  it('rejects malformed/decrypted future or unknown fields, rather than accepting partial data', async () => {
    const secret = createSecret();
    await expect(decryptSnapshot(secret, { version: 9, iv: '', ciphertext: '' })).rejects.toThrow();
    await expect(encryptSnapshot(secret, { ...emptySnapshot(), secret: 'leak' } as never)).rejects.toThrow();
  });
});

describe('separate sync metadata version and migration', () => {
  it('migrates absence to disconnected v1 without touching legacy AppData', () => {
    expect(migrateSyncState(undefined)).toEqual({ version: 1, connection: null });
    expect(() => migrateSyncState({ version: 2, connection: null })).toThrow(/版本/);
    expect(() => migrateSyncState({ version: 1, connection: null, extra: true })).toThrow();
  });
  it('persists credentials/base separately and survives an independent database connection', async () => {
    const connection = { secret: createSecret(), base: emptySnapshot(), lastSuccess: '2026-10-26T06:00:00.000Z' };
    await writeSyncState({ version: 1, connection });
    expect(await readSyncState()).toEqual({ version: 1, connection });
    await writeSyncState({ version: 1, connection: null });
    expect((await readSyncState()).connection).toBeNull();
  });
});
