import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import type { CapacitorSQLitePlugin } from '@capacitor-community/sqlite';
import { NativeSqliteDatabase } from '../../src/data/sqlite-database';
import { SqliteRepository } from '../../src/data/sqlite-repository';
import { createInitialData } from '../../src/domain/seed';

function bridge() {
  const handle = new DatabaseSync(':memory:');
  let registered = false,
    opened = false;
  const result = () => ({ changes: { changes: 0 } });
  const plugin = {
    createConnection: vi.fn<CapacitorSQLitePlugin['createConnection']>(async () => {
      if (registered) throw new Error('connection already exists');
      registered = true;
    }),
    open: vi.fn<CapacitorSQLitePlugin['open']>(async () => {
      opened = true;
    }),
    closeConnection: vi.fn<CapacitorSQLitePlugin['closeConnection']>(async () => {
      if (handle.isTransaction) handle.exec('ROLLBACK');
      registered = false;
      opened = false;
    }),
    isDBOpen: vi.fn<CapacitorSQLitePlugin['isDBOpen']>(async () => {
      if (!registered) throw new Error('connection not available');
      return { result: opened };
    }),
    isTransactionActive: vi.fn<CapacitorSQLitePlugin['isTransactionActive']>(async () => ({
      result: handle.isTransaction,
    })),
    execute: vi.fn<CapacitorSQLitePlugin['execute']>(async (options) => {
      handle.exec(options.statements!);
      return result();
    }),
    beginTransaction: vi.fn<CapacitorSQLitePlugin['beginTransaction']>(async () => {
      handle.exec('BEGIN TRANSACTION');
      return result();
    }),
    commitTransaction: vi.fn<CapacitorSQLitePlugin['commitTransaction']>(async () => {
      handle.exec('COMMIT');
      return result();
    }),
    rollbackTransaction: vi.fn<CapacitorSQLitePlugin['rollbackTransaction']>(async () => {
      handle.exec('ROLLBACK');
      return result();
    }),
    query: vi.fn<CapacitorSQLitePlugin['query']>(async (options) => {
      const statement = handle.prepare(options.statement!);
      return {
        values: [
          { ios_columns: statement.columns().map((column) => column.name) },
          ...statement.all(...(options.values ?? [])),
        ],
      };
    }),
    run: vi.fn<CapacitorSQLitePlugin['run']>(async (options) => {
      expect(options.transaction).toBe(false);
      return {
        changes: { changes: Number(handle.prepare(options.statement!).run(...(options.values ?? [])).changes) },
      };
    }),
  };
  return { handle, plugin };
}
describe('native SQLite bridge transaction boundary', () => {
  it('reuses the native connection after a JS reload and rolls back its abandoned transaction', async () => {
    const { handle, plugin } = bridge(),
      first = new NativeSqliteDatabase(async () => ({ plugin }));
    const initial = await new SqliteRepository(first, async () => null).load();
    handle.exec('BEGIN TRANSACTION');
    handle.exec("UPDATE workspace SET payload='uncommitted'");
    const second = new NativeSqliteDatabase(async () => ({ plugin }));
    try {
      expect(
        await new SqliteRepository(second, async () => {
          throw new Error('must not reimport');
        }).load(),
      ).toEqual(initial);
      expect(plugin.createConnection).toHaveBeenCalledTimes(1);
    } finally {
      await second.close();
      handle.close();
    }
  });
  it('filters iOS column headers, uses explicit transactions and preserves committed results', async () => {
    const { handle, plugin } = bridge(),
      db = new NativeSqliteDatabase(async () => ({ plugin })),
      repo = new SqliteRepository(db, async () => null);
    try {
      const initial = await repo.load(),
        saved = await repo.save({ ...initial, onboarded: true }, initial.revision);
      expect(await repo.load()).toEqual(saved);
      expect(plugin.createConnection).toHaveBeenCalledTimes(1);
      expect(plugin.beginTransaction).toHaveBeenCalledTimes(3);
      expect(plugin.commitTransaction).toHaveBeenCalledTimes(3);
      expect(plugin.rollbackTransaction).not.toHaveBeenCalled();
    } finally {
      await db.close();
      handle.close();
    }
  });
  it('serializes independently created repositories sharing a native connection', async () => {
    const { handle, plugin } = bridge(),
      db = new NativeSqliteDatabase(async () => ({ plugin }));
    try {
      const first = new SqliteRepository(db, async () => null),
        second = new SqliteRepository(db, async () => null);
      const [a, b] = await Promise.all([first.load(), second.load()]);
      expect(a).toEqual(b);
      const outcomes = await Promise.allSettled([first.save(a, a.revision), second.save(b, b.revision)]);
      expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    } finally {
      await db.close();
      handle.close();
    }
  });
  it('rejects a missing query result and rolls back without seeding', async () => {
    const { handle, plugin } = bridge(),
      db = new NativeSqliteDatabase(async () => ({ plugin }));
    try {
      plugin.query.mockResolvedValueOnce({});
      const repo = new SqliteRepository(db, async () => null);
      await expect(repo.load()).rejects.toThrow('查询结果');
      expect(plugin.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect((await repo.load()).revision).toBe(0);
    } finally {
      await db.close();
      handle.close();
    }
  });
  it('rejects a negative write acknowledgement and preserves the previous commit', async () => {
    const { handle, plugin } = bridge(),
      db = new NativeSqliteDatabase(async () => ({ plugin })),
      repo = new SqliteRepository(db, async () => null);
    try {
      const initial = await repo.load();
      plugin.run.mockResolvedValueOnce({ changes: { changes: -1 } });
      await expect(repo.save(initial, initial.revision)).rejects.toThrow('写入');
      expect(await repo.load()).toEqual(initial);
    } finally {
      await db.close();
      handle.close();
    }
  });
  it('does not resolve save before the commit promise completes', async () => {
    const { handle, plugin } = bridge(),
      db = new NativeSqliteDatabase(async () => ({ plugin })),
      repo = new SqliteRepository(db, async () => null);
    try {
      const initial = await repo.load();
      let release!: () => void;
      let completed = false;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      plugin.commitTransaction.mockImplementationOnce(async () => {
        await gate;
        handle.exec('COMMIT');
        return { changes: { changes: 0 } };
      });
      const saving = repo.save(initial, initial.revision).then((value) => {
        completed = true;
        return value;
      });
      await vi.waitFor(() => expect(plugin.commitTransaction).toHaveBeenCalledTimes(2));
      expect(completed).toBe(false);
      release();
      expect((await saving).revision).toBe(1);
    } finally {
      await db.close();
      handle.close();
    }
  });
  it('rejects a negative commit acknowledgement and keeps migration retryable', async () => {
    const { handle, plugin } = bridge(),
      db = new NativeSqliteDatabase(async () => ({ plugin })),
      repo = new SqliteRepository(db, async () => null);
    try {
      plugin.commitTransaction.mockResolvedValueOnce({ changes: { changes: -1 } });
      await expect(repo.load()).rejects.toThrow('事务');
      expect(handle.prepare('PRAGMA user_version').get()?.user_version).toBe(0);
      expect((await repo.load()).revision).toBe(0);
    } finally {
      await db.close();
      handle.close();
    }
  });
  it('retries a plugin load failure and never opens storage while merely closing an unused adapter', async () => {
    const { handle, plugin } = bridge(),
      loader = vi.fn().mockRejectedValueOnce(new Error('bridge unavailable')).mockResolvedValue({ plugin });
    const db = new NativeSqliteDatabase(loader),
      repo = new SqliteRepository(db, async () => null);
    try {
      await db.close();
      expect(loader).not.toHaveBeenCalled();
      await expect(repo.load()).rejects.toThrow('bridge unavailable');
      expect((await repo.load()).revision).toBe(0);
      expect(loader).toHaveBeenCalledTimes(2);
    } finally {
      await db.close();
      handle.close();
    }
  });
  it('keeps operation failures from poisoning the connection queue', async () => {
    const { handle, plugin } = bridge(),
      db = new NativeSqliteDatabase(async () => ({ plugin })),
      repo = new SqliteRepository(db, async () => createInitialData());
    try {
      plugin.open.mockRejectedValueOnce(new Error('open failed'));
      await expect(repo.load()).rejects.toThrow('open failed');
      expect((await repo.load()).sessions).toEqual([]);
    } finally {
      await db.close();
      handle.close();
    }
  });
});
