import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqliteDatabase, SqliteTransaction } from '../../src/data/sqlite-database';

/** Real SQLite engine and real transactions; no SQL-string response mocks. */
export class TestSqliteDatabase implements SqliteDatabase {
  handle: DatabaseSync;
  queue: Promise<unknown> = Promise.resolve();
  failOn = '';
  failCommit = false;
  constructor(readonly filename = ':memory:') {
    this.handle = new DatabaseSync(filename);
  }
  transaction<T>(work: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      this.handle.exec('BEGIN IMMEDIATE');
      const tx: SqliteTransaction = {
        query: async (sql, values = []) => this.handle.prepare(sql).all(...(values as SQLInputValue[])),
        run: async (sql, values = []) => {
          const result = this.handle.prepare(sql).run(...(values as SQLInputValue[]));
          if (this.failOn && sql.includes(this.failOn)) {
            this.failOn = '';
            throw new Error('injected write failure');
          }
          return Number(result.changes);
        },
      };
      try {
        const result = await work(tx);
        if (this.failCommit) {
          this.failCommit = false;
          throw new Error('injected commit failure');
        }
        this.handle.exec('COMMIT');
        return result;
      } catch (error) {
        this.handle.exec('ROLLBACK');
        throw error;
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async close() {
    await this.queue;
    this.handle.close();
  }
}
