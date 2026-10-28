import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createInitialData } from '../../src/domain/seed';
import {
  completeSession,
  createSession,
  createSessionExercise,
  reviewSession,
  toggleSet,
} from '../../src/domain/training';
import { exportBackup, parseBackup, validateAppData } from '../../src/data/backup';
import { StoreConflictError } from '../../src/data/repository';
import { SqliteRepository } from '../../src/data/sqlite-repository';
import { TestSqliteDatabase } from '../helpers/sqlite-database';

const databases: TestSqliteDatabase[] = [];
const directories: string[] = [];
function database(filename?: string) {
  const db = new TestSqliteDatabase(filename);
  databases.push(db);
  return db;
}
function history() {
  const data = createInitialData(),
    start = Date.parse('2026-10-15T10:00:00.000Z');
  let session = createSession(null, data.exercises, start);
  const item = createSessionExercise(data.exercises[0], 3, 67.5, 8);
  session.exercises.push(item);
  for (const set of item.sets) session = toggleSet(session, item.id, set.id, start + 1000);
  session = completeSession(reviewSession(session, start + 60_000), start + 60_000);
  session.note = '历史快照中文保留';
  data.sessions = [session];
  data.revision = 7;
  data.onboarded = true;
  data.settings.favoriteExerciseIds = [data.exercises[0].id];
  return validateAppData(data);
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
  for (const path of directories.splice(0)) {
    if (dirname(resolve(path)) !== resolve(tmpdir()) || !basename(path).startsWith('jianlibao-sqlite-'))
      throw new Error('Unsafe test directory');
    await rm(path, { recursive: true, force: true });
  }
});

describe('SQLite Repository and one-time legacy migration', () => {
  it('recovers the last committed file after another process exits during an uncommitted write', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jianlibao-sqlite-'));
    directories.push(directory);
    const filename = join(directory, 'interrupted.db'),
      db = database(filename);
    const initial = await new SqliteRepository(db, async () => history()).load();
    await db.close();
    databases.splice(databases.indexOf(db), 1);
    execFileSync(process.execPath, [
      '--input-type=module',
      '-e',
      `
      import {DatabaseSync} from 'node:sqlite';
      const db=new DatabaseSync(process.argv[1]);
      db.exec("BEGIN IMMEDIATE; UPDATE workspace SET payload='unfinished',revision=999; DELETE FROM storage_meta;");
      process.exit(0);
    `,
      filename,
    ]);
    expect(
      await new SqliteRepository(database(filename), async () => {
        throw new Error('must keep SQLite commit');
      }).load(),
    ).toEqual(initial);
  });
  it('preserves an active draft alongside completed historical snapshots', async () => {
    const db = database(),
      legacy = history(),
      start = Date.parse('2026-10-16T10:00:00Z');
    let draft = createSession(null, legacy.exercises, start);
    const exercise = createSessionExercise(legacy.exercises[0], 3, 82.5, 6);
    draft.exercises.push(exercise);
    draft = toggleSet(draft, exercise.id, exercise.sets[0].id, start + 1000);
    legacy.sessions.push(draft);
    const original = structuredClone(legacy);
    const copied = await new SqliteRepository(db, async () => legacy).load();
    expect(copied).toEqual(original);
    expect(legacy).toEqual(original);
    expect(copied.sessions[1].restUntil).toBe(draft.restUntil);
    expect(copied.sessions[1].exercises[0].sets[1].status).toBe('pending');
  });
  it('refuses revision overflow without storing a value the validator would later reject', async () => {
    const db = database(),
      legacy = history();
    legacy.revision = Number.MAX_SAFE_INTEGER - 1;
    const repository = new SqliteRepository(db, async () => legacy),
      initial = await repository.load();
    await expect(repository.save(initial, initial.revision)).rejects.toThrow('版本');
    expect(await repository.load()).toEqual(initial);
  });
  it('rejects an unsupported migration marker without reimporting or overwriting SQLite', async () => {
    const db = database(),
      reader = vi.fn(async () => history()),
      repository = new SqliteRepository(db, reader);
    const initial = await repository.load();
    db.handle.prepare('UPDATE storage_meta SET value=?').run(JSON.stringify({ version: 2, complete: true }));
    await expect(repository.load()).rejects.toThrow('迁移记录');
    expect(JSON.parse(String(db.handle.prepare('SELECT payload FROM workspace').get()?.payload))).toEqual(initial);
    expect(reader).toHaveBeenCalledTimes(1);
  });
  it('copies old history, drafts, settings and revision without mutating its source or backup format', async () => {
    const legacy = history(),
      original = structuredClone(legacy),
      db = database();
    const reader = vi.fn(async () => legacy);
    const repository = new SqliteRepository(db, reader);
    expect(await repository.load()).toEqual(original);
    expect(legacy).toEqual(original);
    expect(parseBackup(exportBackup(await repository.load()))).toEqual({ ...original, revision: 0 });
    expect(reader).toHaveBeenCalledTimes(1);
    expect(db.handle.prepare('PRAGMA user_version').get()?.user_version).toBe(1);
    expect(db.handle.prepare('SELECT value FROM storage_meta').get()?.value).toContain('indexeddb');
  });
  it('creates one initial workspace when no old database exists', async () => {
    const db = database(),
      reader = vi.fn(async () => null),
      repository = new SqliteRepository(db, reader);
    const [a, b] = await Promise.all([repository.load(), repository.load()]);
    expect(a).toEqual(b);
    expect(a.revision).toBe(0);
    expect(a.sessions).toEqual([]);
    expect(a.exercises).toHaveLength(302);
    expect(reader).toHaveBeenCalledTimes(1);
  });
  it('never reimports old values over a later SQLite save', async () => {
    const db = database(),
      legacy = history(),
      reader = vi.fn(async () => legacy),
      repository = new SqliteRepository(db, reader);
    const old = await repository.load();
    const saved = await repository.save({ ...old, settings: { ...old.settings, theme: 'light' } }, old.revision);
    reader.mockRejectedValue(new Error('legacy storage now inaccessible'));
    expect(await new SqliteRepository(db, reader).load()).toEqual(saved);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(legacy.settings.theme).toBe('dark');
  });
  it.each(['INSERT INTO workspace', 'INSERT INTO storage_meta'])(
    'rolls back interrupted %s and safely retries from untouched legacy',
    async (failOn) => {
      const db = database(),
        legacy = history(),
        original = structuredClone(legacy),
        repository = new SqliteRepository(db, async () => legacy);
      db.failOn = failOn;
      await expect(repository.load()).rejects.toThrow('injected');
      expect(db.handle.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
      expect(legacy).toEqual(original);
      expect(await repository.load()).toEqual(original);
      expect(db.handle.prepare('SELECT COUNT(*) AS count FROM workspace').get()?.count).toBe(1);
    },
  );
  it('does not report migration success when commit fails, then retries once', async () => {
    const db = database(),
      legacy = history(),
      repository = new SqliteRepository(db, async () => legacy);
    db.failCommit = true;
    await expect(repository.load()).rejects.toThrow('commit');
    expect(db.handle.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
    expect(await repository.load()).toEqual(legacy);
  });
  it('blocks on an invalid old schema instead of creating an empty replacement', async () => {
    const db = database(),
      legacy = { ...history(), schemaVersion: 99 };
    const repository = new SqliteRepository(db, async () => legacy);
    await expect(repository.load()).rejects.toThrow('不支持的数据版本');
    expect(db.handle.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  });
  it('blocks when the old database cannot be read and retries without seeding', async () => {
    const db = database(),
      legacy = history(),
      reader = vi.fn().mockRejectedValueOnce(new Error('blocked old database')).mockResolvedValue(legacy);
    const repository = new SqliteRepository(db, reader);
    await expect(repository.load()).rejects.toThrow('blocked');
    expect(await repository.load()).toEqual(legacy);
  });
  it('keeps a valid SQLite workspace authoritative even if its marker was absent', async () => {
    const db = database(),
      repository = new SqliteRepository(db, async () => history());
    const initial = await repository.load();
    const saved = await repository.save({ ...initial, onboarded: false }, initial.revision);
    db.handle.exec('DELETE FROM storage_meta');
    const legacyReader = vi.fn(async () => history());
    expect(await new SqliteRepository(db, legacyReader).load()).toEqual(saved);
    expect(legacyReader).not.toHaveBeenCalled();
  });
  it('refuses missing data after a completed migration, preserving the source for recovery', async () => {
    const db = database(),
      reader = vi.fn(async () => history()),
      repository = new SqliteRepository(db, reader);
    await repository.load();
    db.handle.exec('DELETE FROM workspace');
    await expect(repository.load()).rejects.toThrow('缺失');
    expect(reader).toHaveBeenCalledTimes(1);
    expect(db.handle.prepare('SELECT COUNT(*) AS count FROM workspace').get()?.count).toBe(0);
  });
  it.each(["UPDATE workspace SET payload='broken'", 'UPDATE workspace SET revision=999'])(
    'does not reset damaged SQLite data: %s',
    async (statement) => {
      const db = database(),
        reader = vi.fn(async () => history()),
        repository = new SqliteRepository(db, reader);
      await repository.load();
      db.handle.exec(statement);
      await expect(repository.load()).rejects.toThrow();
      expect(reader).toHaveBeenCalledTimes(1);
    },
  );
  it('rejects future storage schema versions without changing them', async () => {
    const db = database();
    db.handle.exec('PRAGMA user_version=2');
    await expect(new SqliteRepository(db, async () => history()).load()).rejects.toThrow('SQLite');
    expect(db.handle.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
  });
  it('verifies migration read-back before marking it complete', async () => {
    const db = database(),
      transaction = db.transaction.bind(db);
    db.transaction = (work) =>
      transaction((tx) =>
        work({
          ...tx,
          query: async (sql, values) => {
            const rows = await tx.query(sql, values);
            if (sql.includes('SELECT revision, payload') && rows.length)
              return [{ ...rows[0], payload: JSON.stringify(createInitialData()) }];
            return rows;
          },
        }),
      );
    await expect(new SqliteRepository(db, async () => history()).load()).rejects.toThrow();
    expect(db.handle.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  });
  it('keeps historical exercise snapshots unchanged while expanding a 12-action legacy catalogue once', async () => {
    const db = database(),
      legacy = history();
    legacy.exercises = legacy.exercises.slice(0, 12);
    legacy.exercises[0].description = '我的旧版提示';
    const original = structuredClone(legacy),
      repository = new SqliteRepository(db, async () => legacy);
    const expanded = await repository.load();
    expect(expanded.exercises).toHaveLength(302);
    expect(expanded.revision).toBe(8);
    expect(expanded.exercises[0].description).toBe('我的旧版提示');
    expect(expanded.sessions).toEqual(original.sessions);
    expect(legacy).toEqual(original);
    expect(await repository.load()).toEqual(expanded);
    await expect(repository.save(original, original.revision)).rejects.toBeInstanceOf(StoreConflictError);
  });
  it('serializes writers from two repositories and preserves only the CAS winner', async () => {
    const db = database(),
      first = new SqliteRepository(db, async () => history()),
      second = new SqliteRepository(db, async () => null);
    const initial = await first.load();
    const outcomes = await Promise.allSettled([
      first.save({ ...initial, onboarded: false }, initial.revision),
      second.save({ ...initial, settings: { ...initial.settings, unit: 'lb' } }, initial.revision),
    ]);
    const wins = outcomes.filter((x) => x.status === 'fulfilled'),
      losses = outcomes.filter((x) => x.status === 'rejected');
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0].reason).toBeInstanceOf(StoreConflictError);
    expect(await first.load()).toEqual(wins[0].value);
  });
  it('does not mutate the submitted snapshot or history on save', async () => {
    const db = database(),
      repository = new SqliteRepository(db, async () => history()),
      initial = await repository.load();
    const before = structuredClone(initial),
      saved = await repository.save(initial, initial.revision);
    expect(initial).toEqual(before);
    expect(saved.revision).toBe(before.revision + 1);
    expect(saved.sessions).toEqual(before.sessions);
  });
  it('rejects invalid data/revision before changing any stored value', async () => {
    const db = database(),
      repository = new SqliteRepository(db, async () => history()),
      initial = await repository.load();
    await expect(repository.save(initial, -1)).rejects.toThrow('版本');
    await expect(repository.save({ ...initial, unexpected: true }, initial.revision)).rejects.toThrow('未知');
    expect(await repository.load()).toEqual(initial);
  });
  it('retains the last commit after a write/commit failure and allows retry', async () => {
    const db = database(),
      repository = new SqliteRepository(db, async () => history()),
      initial = await repository.load();
    db.failCommit = true;
    await expect(repository.save({ ...initial, onboarded: false }, initial.revision)).rejects.toThrow('commit');
    expect(await repository.load()).toEqual(initial);
    expect((await repository.save({ ...initial, onboarded: false }, initial.revision)).revision).toBe(
      initial.revision + 1,
    );
  });
  it('persists an actual SQLite file across closing and reopening with no legacy available', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jianlibao-sqlite-'));
    directories.push(directory);
    const filename = join(directory, 'workspace.db'),
      db = database(filename),
      first = new SqliteRepository(db, async () => history());
    const initial = await first.load(),
      saved = await first.save({ ...initial, onboarded: false }, initial.revision);
    await first.close();
    databases.splice(databases.indexOf(db), 1);
    const next = new SqliteRepository(database(filename), async () => {
      throw new Error('must not read legacy');
    });
    expect(await next.load()).toEqual(saved);
  });
});
