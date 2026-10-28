import type { CapacitorSQLitePlugin } from '@capacitor-community/sqlite';

export type SqlValue = string | number | null;
export interface SqliteTransaction {
  query(sql: string, values?: SqlValue[]): Promise<Record<string, unknown>[]>;
  run(sql: string, values?: SqlValue[]): Promise<number>;
}
export interface SqliteDatabase {
  transaction<T>(work: (tx: SqliteTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

type NativePlugin = Pick<
  CapacitorSQLitePlugin,
  | 'createConnection'
  | 'open'
  | 'isDBOpen'
  | 'isTransactionActive'
  | 'closeConnection'
  | 'beginTransaction'
  | 'commitTransaction'
  | 'rollbackTransaction'
  | 'execute'
  | 'query'
  | 'run'
>;

async function loadNativePlugin(): Promise<{ plugin: NativePlugin }> {
  const { registerPlugin } = await import('@capacitor/core');
  // Same native registration as the package entry, without importing its Web/WASM adapter.
  // Capacitor proxies expose a then property too. Wrap the proxy to avoid Promise thenable assimilation.
  return { plugin: registerPlugin<CapacitorSQLitePlugin>('CapacitorSQLite') };
}

/** One queue owns this native connection, including opening, transactions, failure recovery and closing. */
export class NativeSqliteDatabase implements SqliteDatabase {
  private queue: Promise<unknown> = Promise.resolve();
  private plugin?: NativePlugin;
  private connected = false;
  private readonly options = { database: 'jianlibao', readonly: false };
  constructor(private readonly loadPlugin: () => Promise<{ plugin: NativePlugin }> = loadNativePlugin) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async reset(): Promise<void> {
    if (!this.plugin) return;
    try {
      await this.plugin.closeConnection(this.options);
    } finally {
      this.connected = false;
    }
  }

  private async open(): Promise<void> {
    this.plugin ??= (await this.loadPlugin()).plugin;
    if (!this.connected) {
      try {
        let isOpen: boolean | undefined;
        try {
          isOpen = (await this.plugin.isDBOpen(this.options)).result;
        } catch {
          /* No connection registered yet. createConnection will still report actual native failures. */
        }
        if (isOpen === undefined) {
          await this.plugin.createConnection({ ...this.options, version: 1, encrypted: false, mode: 'no-encryption' });
        }
        if (isOpen !== true) await this.plugin.open(this.options);
        // A WKWebView/JS reload can retain the plugin's native connection and an unfinished transaction.
        if ((await this.plugin.isTransactionActive(this.options)).result)
          await this.plugin.rollbackTransaction(this.options);
        await this.plugin.execute({
          ...this.options,
          statements: 'PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;',
          transaction: false,
        });
        this.connected = true;
      } catch (error) {
        await this.reset().catch(() => undefined);
        throw error;
      }
    }
  }

  transaction<T>(work: (tx: SqliteTransaction) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.open();
      const plugin = this.plugin!;
      const confirm = (result: { changes?: { changes?: number } }) => {
        const changes = result.changes?.changes;
        if (!Number.isSafeInteger(changes) || changes! < 0) throw new Error('SQLite未确认事务，当前输入尚未保存');
      };
      try {
        confirm(await plugin.beginTransaction(this.options));
        const result = await work({
          query: async (statement, values = []) => {
            const result = await plugin.query({ ...this.options, statement, values });
            if (!Array.isArray(result.values)) throw new Error('SQLite没有返回查询结果，原数据已保留');
            // Native iOS may prepend a column-name row; it is not a workspace record.
            return result.values.filter((row: unknown): row is Record<string, unknown> => {
              if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('SQLite查询结果无效');
              return !Object.hasOwn(row, 'ios_columns');
            });
          },
          run: async (statement, values = []) => {
            const result = await plugin.run({ ...this.options, statement, values, transaction: false });
            const changes = result.changes?.changes;
            if (!Number.isSafeInteger(changes) || changes! < 0)
              throw new Error('SQLite未确认写入结果，当前输入尚未保存');
            return changes!;
          },
        });
        confirm(await plugin.commitTransaction(this.options));
        return result;
      } catch (error) {
        try {
          await plugin.rollbackTransaction(this.options);
        } catch {
          await this.reset().catch(() => undefined);
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.enqueue(async () => {
      if (this.connected) await this.reset();
    });
  }
}

// All app Repository instances share the same serialized plugin connection.
export const nativeSqliteDatabase = new NativeSqliteDatabase();
