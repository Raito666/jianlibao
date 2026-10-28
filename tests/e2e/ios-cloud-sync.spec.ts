import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { getE2ERunDirectory } from '../../scripts/e2e-output.mjs';
import { cloudBackend, nativeCloudBridge, nativeActivity, webCloud } from './native-cloud-helpers';
import { storedWorkspace } from './helpers';
test.use({ serviceWorkers: 'block' });
const folder = joinPath(getE2ERunDirectory(), 'ios-cloud-sync');
async function settings(page: Page) {
  await page.goto('/#/settings'); await expect(page.getByRole('button', { name: '记录身体数据', exact: true })).toBeEnabled();
}
async function sync(page: Page) {
  const button = page.getByRole('button', { name: '立即同步', exact: true }); await expect(button).toBeEnabled(); await button.click();
  await expect(page.locator('.cloud-status')).toContainText('最近同步');
  await expect(page.locator('.cloud-sync [role=alert]')).toHaveCount(0);
}
async function create(page: Page) {
  await page.getByRole('button', { name: '创建加密同步', exact: true }).click();
  const dialog = page.getByRole('dialog'), key = await dialog.getByLabel('同步密钥', { exact: true }).inputValue();
  await dialog.getByRole('checkbox', { name: '我已将同步密钥保存在安全位置' }).check();
  await dialog.getByRole('button', { name: '开启同步', exact: true }).click(); await expect(dialog).not.toBeVisible(); await sync(page); return key;
}
async function join(page: Page, key: string) {
  await page.getByRole('button', { name: '连接已有同步', exact: true }).click(); const dialog = page.getByRole('dialog');
  await dialog.getByLabel('同步密钥', { exact: true }).fill(key); await dialog.getByRole('button', { name: '连接并合并', exact: true }).click();
  await expect(dialog).not.toBeVisible(); await sync(page);
}
async function body(page: Page, weight: number, editing = false) {
  await page.getByRole('button', { name: editing ? '编辑2026-10-26身体记录' : '记录身体数据', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('记录日期', { exact: true }).fill('2026-10-26');
  await dialog.getByLabel('体重 (kg)', { exact: true }).fill(String(weight)); await dialog.getByLabel('备注（可选）', { exact: true }).fill('原生云同步本地验收合成记录');
  await dialog.getByRole('button', { name: '保存身体记录', exact: true }).click(); await expect(dialog).not.toBeVisible();
}
async function noIndexedDb(page: Page) {
  // The established first-install migration probes the old workspace and aborts
  // creation if absent. That one read probe is allowed; no database may persist
  // and the Web sync store must never be opened by the native path.
  const opened: string[] = await page.evaluate(() => Reflect.get(window, '__nativeIdbOpened'));
  expect(opened.every(name => name === 'jianlibao')).toBe(true);
  expect(opened.length).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
}

test('原生SQLite与Web往返同步，训练/密钥导出及重开保留，备份格式不变', async ({ browser, baseURL }, info) => {
  test.setTimeout(90000);
  const backend = cloudBackend(), secrets = new Map<string, string>(), filename = info.outputPath('native.db');
  const a = await browser.newContext({ baseURL, serviceWorkers: 'block' }), b = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const pa = await a.newPage(), pb = await b.newPage(), native = await nativeCloudBridge(pa, filename, secrets, backend); await webCloud(b, backend);
  let reopened: Awaited<ReturnType<typeof nativeCloudBridge>> | null = null;
  try {
    await settings(pa); await body(pa, 70); const key = await create(pa);
    await pa.goto('/'); await pa.getByRole('button', { name: '开始今天的训练', exact: true }).click(); await pa.getByRole('button', { name: '确认开始训练', exact: true }).click();
    await pa.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('60'); await pa.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('10');
    await pa.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click(); await pa.getByRole('button', { name: '提前回顾', exact: true }).click(); await pa.getByRole('button', { name: '保存训练', exact: true }).click();
    await expect.poll(() => native.data().sessions[0]?.status).toBe('completed'); await settings(pa); await sync(pa);
    await settings(pb); await join(pb, key);
    await expect.poll(async () => (await storedWorkspace(pb)).bodyMetrics[0]?.weightKg).toBe(70);
    expect((await storedWorkspace(pb)).sessions).toEqual(native.data().sessions);
    await body(pb, 73, true); await sync(pb); await sync(pa); await expect.poll(() => native.data().bodyMetrics[0]?.weightKg).toBe(73);
    expect(native.rawMetadata()).not.toContain(key); await noIndexedDb(pa);
    await pa.getByRole('button', { name: '导出备份', exact: true }).click(); await expect.poll(() => native.exports.length).toBe(1);
    expect(JSON.parse(native.exports[0]).formatVersion).toBe(2); expect(native.exports[0]).not.toContain(key); expect(native.exports[0]).not.toContain('slot');
    await pa.getByRole('button', { name: '查看同步密钥', exact: true }).click(); await pa.getByRole('dialog').getByRole('button', { name: '保存密钥文件', exact: true }).click();
    await expect.poll(() => native.exports.length).toBe(2); expect(native.exports[1]).toContain(key); await pa.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
    const before = native.data(); await pa.close(); native.close();
    const next = await a.newPage(); reopened = await nativeCloudBridge(next, filename, secrets, backend); await settings(next); await expect(next.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled();
    expect(reopened.data()).toEqual(before); await noIndexedDb(next);
    await mkdir(folder, { recursive: true }); await next.screenshot({ path: `${folder}/native-reopened.png`, fullPage: true });
  } finally { await a.close(); await b.close(); if (reopened) reopened.close(); else { try { native.close(); } catch {} } }
});

test('原生离线修改与Web冲突逐条选择，断开后保留SQLite记录', async ({ browser, baseURL }, info) => {
  test.setTimeout(60000); const backend = cloudBackend(), secrets = new Map<string, string>();
  const a = await browser.newContext({ baseURL, serviceWorkers: 'block' }), b = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const pa = await a.newPage(), pb = await b.newPage(), native = await nativeCloudBridge(pa, info.outputPath('offline.db'), secrets, backend); await webCloud(b, backend);
  try {
    await settings(pa); await body(pa, 70); const key = await create(pa); await settings(pb); await join(pb, key);
    native.offline(true); await body(pa, 74, true); await pa.getByRole('button', { name: '立即同步', exact: true }).click();
    await expect(pa.locator('.cloud-sync [role=alert]')).toContainText('本机'); expect(native.data().bodyMetrics[0].weightKg).toBe(74);
    await body(pb, 72, true); await sync(pb); native.offline(false); await pa.getByRole('button', { name: '立即同步', exact: true }).click();
    await expect(pa.locator('.cloud-status')).toContainText('需要选择版本');
    await pa.getByLabel('2026-10-26 身体记录 保留版本', { exact: true }).selectOption('local'); await pa.getByRole('button', { name: '合并并同步', exact: true }).click();
    await expect(pa.locator('.cloud-status')).toContainText('最近同步'); await sync(pb); expect((await storedWorkspace(pb)).bodyMetrics[0].weightKg).toBe(74);
    const before = native.data(); await pa.getByRole('button', { name: '断开本机同步', exact: true }).click(); await pa.getByRole('dialog').getByRole('button', { name: '确认断开', exact: true }).click();
    await expect(pa.getByRole('button', { name: '创建加密同步', exact: true })).toBeEnabled(); expect(native.data()).toEqual(before); expect(secrets.size).toBe(0); await noIndexedDb(pa);
  } finally { await a.close(); await b.close(); native.close(); }
});

test('Keychain失败可取消重试，丢失密钥可重新连接而不清空业务数据', async ({ page }, info) => {
  const secrets = new Map<string, string>(), native = await nativeCloudBridge(page, info.outputPath('failure.db'), secrets, cloudBackend());
  try {
    await settings(page); await body(page, 71); const before = native.data();
    await page.getByRole('button', { name: '创建加密同步', exact: true }).click(); let dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: '我已将同步密钥保存在安全位置' }).check(); native.failNextKeyWrite();
    await dialog.getByRole('button', { name: '开启同步', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('Keychain');
    await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect(native.data()).toEqual(before);
    const key = await create(page); secrets.clear(); await page.reload();
    await expect(page.locator('.cloud-sync [role=alert]')).toContainText('未找到同步密钥');
    expect(native.data()).toEqual(before); await join(page, key); expect(native.data().bodyMetrics).toEqual(before.bodyMetrics); await noIndexedDb(page);
  } finally { await page.close(); native.close(); }
});

test('进入后台取消在途结果，恢复前台读取持久连接并拉取最新记录', async ({ browser, baseURL }, info) => {
  test.setTimeout(60000); const backend = cloudBackend();
  const a = await browser.newContext({ baseURL, serviceWorkers: 'block' }), b = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const pa = await a.newPage(), pb = await b.newPage(), native = await nativeCloudBridge(pa, info.outputPath('lifecycle.db'), new Map(), backend); await webCloud(b, backend);
  try {
    await settings(pa); await body(pa, 70); const key = await create(pa); await settings(pb); await join(pb, key);
    native.hold(); await pa.getByRole('button', { name: '立即同步', exact: true }).click(); await expect.poll(native.held).toBeGreaterThan(0);
    await nativeActivity(pa, false); await body(pb, 75, true); await sync(pb); native.release();
    await expect(pa.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled(); expect(native.data().bodyMetrics[0].weightKg).toBe(70);
    await nativeActivity(pa, true); await expect.poll(() => native.data().bodyMetrics[0]?.weightKg).toBe(75); await noIndexedDb(pa);
  } finally { native.release(); await a.close(); await b.close(); native.close(); }
});

for (const edited of [false, true]) test(`恢复原密钥保留离线删除语义，云端修改=${edited}`, async ({ browser, baseURL }, info) => {
  test.setTimeout(60000);
  const backend = cloudBackend(), secrets = new Map<string, string>();
  const a = await browser.newContext({ baseURL, serviceWorkers: 'block' }), b = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const pa = await a.newPage(), pb = await b.newPage(), native = await nativeCloudBridge(pa, info.outputPath('recovery.db'), secrets, backend); await webCloud(b, backend);
  try {
    await settings(pa); await body(pa, 70); const key = await create(pa); await settings(pb); await join(pb, key);
    native.offline(true);
    await pa.getByRole('button', { name: '删除2026-10-26身体记录', exact: true }).click();
    await pa.getByRole('dialog').getByRole('button', { name: '确认删除身体记录', exact: true }).click();
    await expect.poll(() => native.data().bodyMetrics.length).toBe(0);
    if (edited) { await body(pb, 76, true); await sync(pb); }
    secrets.clear(); await pa.reload(); await expect(pa.locator('.cloud-sync [role=alert]')).toContainText('未找到同步密钥');
    native.offline(false); await pa.getByRole('button', { name: '连接已有同步', exact: true }).click();
    const dialog = pa.getByRole('dialog'); await dialog.getByLabel('同步密钥', { exact: true }).fill(key);
    await dialog.getByRole('button', { name: '连接并合并', exact: true }).click(); await expect(dialog).not.toBeVisible();
    if (edited) {
      await pa.getByRole('button', { name: '立即同步', exact: true }).click();
      await expect(pa.locator('.cloud-status')).toContainText('需要选择版本');
      expect(native.data().bodyMetrics).toEqual([]); expect((await storedWorkspace(pb)).bodyMetrics[0].weightKg).toBe(76);
      await pa.getByLabel('2026-10-26 身体记录 保留版本', { exact: true }).selectOption('local');
      await pa.getByRole('button', { name: '合并并同步', exact: true }).click();
      await expect(pa.locator('.cloud-status')).toContainText('最近同步');
    } else await sync(pa);
    await sync(pb); expect((await storedWorkspace(pb)).bodyMetrics).toEqual([]); expect(native.data().bodyMetrics).toEqual([]); await noIndexedDb(pa);
  } finally { await a.close(); await b.close(); native.close(); }
});

for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light'] as const) test(`原生同步入口 ${width}px ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); const native = await nativeCloudBridge(page, info.outputPath('matrix.db'), new Map(), cloudBackend());
  try {
    await settings(page); await page.getByLabel('界面主题', { exact: true }).selectOption(theme); await expect(page.getByRole('button', { name: '创建加密同步', exact: true })).toBeEnabled();
    await expect(page.getByText(/密钥由此设备的系统钥匙串保管/)).toBeVisible(); await noIndexedDb(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.locator('.cloud-sync').scrollIntoViewIfNeeded(); await mkdir(`${folder}/matrix`, { recursive: true });
    await page.screenshot({ path: `${folder}/matrix/${width}-${theme}-${info.project.name || 'edge'}.png`, fullPage: true });
  } finally { await page.close(); native.close(); }
});
