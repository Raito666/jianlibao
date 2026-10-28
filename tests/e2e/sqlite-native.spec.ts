import { expect, test, type Page } from '@playwright/test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppData } from '../../src/domain/types';
import { storedWorkspace, expectPersisted } from './helpers';

/** Real production JS + simulated Capacitor iOS bridge backed by a real desktop SQLite file.
 * This is not a device/SQLCipher/Capacitor native runtime test.
 */
async function nativeBridge(page: Page, filename: string) {
  await mkdir(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  let registered = false,
    opened = false,
    failOpen = false;
  const temporaryFiles = new Map<string, string>();
  const sharedFiles: string[] = [];
  await page.exposeFunction(
    '__jlbSqlite',
    async (
      plugin: string,
      method: string,
      options: {
        statement?: string;
        statements?: string;
        values?: SQLInputValue[];
        transaction?: boolean;
        path?: string;
        data?: string;
        directory?: string;
        encoding?: string;
        files?: string[];
      },
    ) => {
      if (plugin === 'Filesystem') {
        expect(options.directory).toBe('CACHE');
        expect(options.path).toMatch(/^exports\/[\w-]+-健力宝备份-\d{4}-\d{2}-\d{2}\.json$/);
        if (method === 'writeFile') {
          expect(options.encoding).toBe('utf8');
          expect(typeof options.data).toBe('string');
          temporaryFiles.set(options.path!, options.data!);
          return { uri: `file:///cache/${options.path}` };
        }
        if (method === 'deleteFile') {
          expect(temporaryFiles.delete(options.path!)).toBe(true);
          return;
        }
      }
      if (plugin === 'Share' && method === 'share') {
        expect(options.files).toHaveLength(1);
        expect(options.files![0]).toMatch(/^file:\/\/\/cache\/exports\//);
        const text = temporaryFiles.get(options.files![0].slice('file:///cache/'.length));
        expect(text).toBeDefined();
        sharedFiles.push(text!);
        return { activityType: 'com.apple.CloudDocsUI.AddToiCloudDrive' };
      }
      if (plugin !== 'CapacitorSQLite') throw new Error(`Unexpected native plugin: ${plugin}`);
      const done = () => ({ changes: { changes: 0 } });
      switch (method) {
        case 'isDBOpen':
          if (!registered) throw new Error('connection unavailable');
          return { result: opened };
        case 'isTransactionActive':
          return { result: db.isTransaction };
        case 'createConnection':
          if (registered) throw new Error('duplicate connection');
          registered = true;
          return;
        case 'open':
          if (failOpen) throw new Error('模拟原生SQLite打开失败');
          opened = true;
          return;
        case 'closeConnection':
          if (db.isTransaction) db.exec('ROLLBACK');
          registered = false;
          opened = false;
          return;
        case 'execute':
          expect(options.transaction).toBe(false);
          db.exec(options.statements!);
          return done();
        case 'beginTransaction':
          db.exec('BEGIN TRANSACTION');
          return done();
        case 'commitTransaction':
          db.exec('COMMIT');
          return done();
        case 'rollbackTransaction':
          db.exec('ROLLBACK');
          return done();
        case 'query': {
          const statement = db.prepare(options.statement!);
          return {
            values: [
              { ios_columns: statement.columns().map((x) => x.name) },
              ...statement.all(...(options.values ?? [])),
            ],
          };
        }
        case 'run':
          expect(options.transaction).toBe(false);
          return {
            changes: { changes: Number(db.prepare(options.statement!).run(...(options.values ?? [])).changes) },
          };
        default:
          throw new Error(`Unexpected native method: ${method}`);
      }
    },
  );
  await page.addInitScript(() => {
    Object.assign(window, {
      webkit: { messageHandlers: { bridge: { postMessage() {} } } },
      Capacitor: {
        PluginHeaders: [
          {
            name: 'Filesystem',
            methods: ['writeFile', 'deleteFile'].map((name) => ({ name, rtype: 'promise' })),
          },
          {
            name: 'Share',
            methods: [{ name: 'share', rtype: 'promise' }],
          },
          {
            name: 'CapacitorSQLite',
            methods: [
              'isDBOpen',
              'isTransactionActive',
              'createConnection',
              'open',
              'closeConnection',
              'execute',
              'beginTransaction',
              'commitTransaction',
              'rollbackTransaction',
              'query',
              'run',
            ].map((name) => ({ name, rtype: 'promise' })),
          },
        ],
        nativePromise: (plugin: string, method: string, options: unknown) =>
          Reflect.get(window, '__jlbSqlite')(plugin, method, options),
      },
    });
  });
  return {
    data: () =>
      JSON.parse(String(db.prepare("SELECT payload FROM workspace WHERE id='main'").get()?.payload)) as AppData,
    setFailure: (value: boolean) => {
      failOpen = value;
    },
    tableCount: () => Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get()?.count),
    sharedFiles,
    temporaryFiles,
    close: () => db.close(),
  };
}
async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
}
async function settings(page: Page) {
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('button', { name: '我', exact: true })
    .click();
}
async function legacyWorkout(page: Page) {
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
  await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('67.5');
  await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('8');
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await page.getByRole('button', { name: '提前回顾', exact: true }).click();
  await page.getByRole('button', { name: '保存训练', exact: true }).click();
  await expectPersisted(page, (data) => data.sessions[0]?.status === 'completed');
  return storedWorkspace(page);
}

test('模拟iOS桥：迁移真实Web记录后SQLite独立保存、刷新和导出，旧IndexedDB保持原样', async ({ page }, info) => {
  const legacy = await legacyWorkout(page),
    bridge = await nativeBridge(page, info.outputPath('workspace.db'));
  try {
    await page.goto('/');
    await ready(page);
    await expect.poll(() => bridge.data()).toEqual(legacy);
    await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
    await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('72.5');
    await expect
      .poll(() => bridge.data().sessions.find((x) => x.status === 'active')?.exercises[0].sets[0].weightKg)
      .toBe(72.5);
    const saved = bridge.data();
    expect(await storedWorkspace(page)).toEqual(legacy);
    await page.reload();
    await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('72.5');
    expect(bridge.data()).toEqual(saved);
    expect(await storedWorkspace(page)).toEqual(legacy);
    await page.getByRole('button', { name: '返回今天', exact: true }).click();
    await settings(page);
    let browserDownloads = 0;
    page.on('download', () => { browserDownloads++; });
    await page.getByRole('button', { name: '导出备份', exact: true }).click();
    await expect.poll(() => bridge.sharedFiles.length).toBe(1);
    await expect(page.getByText('备份已交给系统分享，请确认保存到所选位置', { exact: true })).toBeVisible();
    await expect.poll(() => bridge.temporaryFiles.size).toBe(0);
    expect(browserDownloads).toBe(0);
    const backup = JSON.parse(bridge.sharedFiles[0]);
    expect(backup.app).toBe('jianlibao');
    expect(backup.formatVersion).toBe(2);
    expect(backup.data.schemaVersion).toBe(2);
    expect(backup.data.sessions).toEqual(saved.sessions);
    expect(await storedWorkspace(page)).toEqual(legacy);
  } finally {
    await page.close();
    bridge.close();
  }
});
test('模拟iOS桥：新安装只建立SQLite，Web旧库不会被顺手创建', async ({ page }, info) => {
  const bridge = await nativeBridge(page, info.outputPath('new-install.db'));
  try {
    await page.goto('/');
    await ready(page);
    expect(bridge.data().sessions).toEqual([]);
    expect(bridge.data().exercises).toHaveLength(302);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    await page.reload();
    await ready(page);
    expect(bridge.data().revision).toBe(0);
  } finally {
    await page.close();
    bridge.close();
  }
});
test('模拟iOS桥：SQLite失败显示错误并保留旧记录，恢复后重试迁移', async ({ page }, info) => {
  const legacy = await legacyWorkout(page),
    bridge = await nativeBridge(page, info.outputPath('retry.db'));
  bridge.setFailure(true);
  try {
    await page.goto('/');
    await expect(page.getByText('模拟原生SQLite打开失败', { exact: true })).toBeVisible();
    expect(await storedWorkspace(page)).toEqual(legacy);
    expect(bridge.tableCount()).toBe(0);
    bridge.setFailure(false);
    await page.getByRole('button', { name: '重新打开本地数据', exact: true }).click();
    await ready(page);
    expect(bridge.data()).toEqual(legacy);
    expect(await storedWorkspace(page)).toEqual(legacy);
  } finally {
    await page.close();
    bridge.close();
  }
});
