import type { AppData } from '../domain/types';
import { createInitialData } from '../domain/seed';
import { validateAppData } from './backup';
import type { SqliteTransaction } from './sqlite-database';
import { expandCatalog } from '../content/catalog';

export const SQLITE_SCHEMA_VERSION = 1;
const MIGRATION_KEY = 'legacy-indexeddb-v1';

/** Physical SQLite schema stays at 1; the versioned AppData payload migrates independently. */
export async function migrateSqliteSchema(tx: SqliteTransaction): Promise<void> {
  const rows = await tx.query('PRAGMA user_version');
  const version = rows[0]?.user_version;
  if (version !== 0 && version !== SQLITE_SCHEMA_VERSION) throw new Error('不支持的SQLite存储版本，原数据库已保留');
  await tx.run(
    "CREATE TABLE IF NOT EXISTS workspace (id TEXT PRIMARY KEY CHECK (id='main'), revision INTEGER NOT NULL CHECK (revision>=0), payload TEXT NOT NULL)",
  );
  await tx.run('CREATE TABLE IF NOT EXISTS storage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  if (version === 0) await tx.run('PRAGMA user_version=1');
}

export async function readSqliteWorkspace(tx: SqliteTransaction): Promise<AppData | null> {
  const rows = await tx.query("SELECT revision, payload FROM workspace WHERE id='main'");
  if (!rows.length) return null;
  if (rows.length !== 1 || typeof rows[0].payload !== 'string') throw new Error('SQLite训练数据无效，原数据已保留');
  const data = validateAppData(JSON.parse(rows[0].payload));
  if (rows[0].revision !== data.revision) throw new Error('SQLite训练版本不一致，原数据已保留');
  return data;
}

/** Call inside the caller's transaction: data, read-back verification and marker commit together. */
export async function migrateLegacyWorkspace(
  tx: SqliteTransaction,
  readLegacy: () => Promise<unknown | null>,
): Promise<AppData> {
  await migrateSqliteSchema(tx);
  let current = await readSqliteWorkspace(tx);
  const originals = await tx.query("SELECT payload FROM workspace WHERE id='main'");
  if (current && typeof originals[0]?.payload === 'string' && JSON.parse(originals[0].payload).schemaVersion === 1) {
    if (current.revision >= Number.MAX_SAFE_INTEGER - 1) throw new Error('本地数据版本已达上限，请先导出备份');
    await tx.run('INSERT OR IGNORE INTO storage_meta (key, value) VALUES (?, ?)', ['appdata-v1-before-v2', originals[0].payload]);
    const next = validateAppData({ ...expandCatalog(current), revision: current.revision + 1 });
    const changed = await tx.run("UPDATE workspace SET revision=?, payload=? WHERE id='main' AND revision=?", [next.revision, JSON.stringify(next), current.revision]);
    if (changed !== 1) throw new Error('SQLite迁移版本冲突，旧数据已保留');
    if (JSON.stringify(await readSqliteWorkspace(tx)) !== JSON.stringify(next)) throw new Error('SQLite迁移核对失败，旧数据已保留');
    current = next;
  }
  const rows = await tx.query('SELECT value FROM storage_meta WHERE key=?', [MIGRATION_KEY]);
  if (rows.length) {
    const marker: unknown = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : null;
    if (
      !marker ||
      typeof marker !== 'object' ||
      !('version' in marker) ||
      marker.version !== 1 ||
      !('complete' in marker) ||
      marker.complete !== true
    )
      throw new Error('SQLite迁移记录无效，原数据已保留');
    if (!current) throw new Error('SQLite迁移后训练数据缺失，请从保留的旧数据或备份恢复');
    return current;
  }
  let source = 'sqlite-existing';
  if (!current) {
    const legacy = await readLegacy();
    current = validateAppData(legacy === null ? createInitialData() : legacy);
    source = legacy === null ? 'new' : 'indexeddb';
    await tx.run('INSERT INTO workspace (id, revision, payload) VALUES (?, ?, ?)', [
      'main',
      current.revision,
      JSON.stringify(current),
    ]);
    const copied = await readSqliteWorkspace(tx);
    if (JSON.stringify(copied) !== JSON.stringify(current)) throw new Error('SQLite迁移核对失败，旧数据已保留');
  }
  await tx.run('INSERT INTO storage_meta (key, value) VALUES (?, ?)', [
    MIGRATION_KEY,
    JSON.stringify({ version: 1, complete: true, source, revision: current.revision }),
  ]);
  return current;
}
