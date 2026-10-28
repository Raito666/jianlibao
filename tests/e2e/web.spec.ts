import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { backupFile, expectPersisted, storedWorkspace } from './helpers';
import { sessionStats } from '../../src/domain/training';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
}

async function begin(page: Page) {
  await ready(page);
  await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
  await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
  await expect(page).toHaveURL(/#\/workout$/);
  await expect(page.getByRole('heading', { name: '全身基础', exact: true, level: 1 })).toBeVisible();
  await expectPersisted(page, data => data.sessions.length === 1);
}

async function settings(page: Page) {
  if (page.viewportSize()!.width <= 760 && /#\/workout$/.test(page.url()))
    await page.getByRole('button', { name: '返回今天', exact: true }).click();
  await page.getByRole('navigation', { name: page.viewportSize()!.width < 768 ? '移动端导航' : '主导航', exact: true }).getByRole('button', { name: '我', exact: true }).click();
  await expect(page.getByRole('heading', { name: '把记录，留在自己手里。' })).toBeVisible();
}

async function finishOneSet(page: Page) {
  await begin(page);
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('60');
  await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('10');
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).volumeKg === 600);
  await page.getByRole('button', { name: '提前回顾', exact: true }).click();
  await page.getByRole('button', { name: '保存训练', exact: true }).click();
  await expectPersisted(page, data => data.sessions.length === 1 && data.sessions[0].status === 'completed');
}

test('训练闭环：热身、完成撤销、休息、刷新暂停恢复和历史归档', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T06:00:00Z') });
  await begin(page);
  const weight = page.getByLabel('杠铃深蹲第1组总重量', { exact: true });
  await weight.fill('60');
  await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('10');
  await page.getByLabel('杠铃深蹲第1组类型', { exact: true }).selectOption('warmup');
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).completedSets === 1 && sessionStats(data.sessions[0]).volumeKg === 0);
  const restBefore = (await storedWorkspace(page)).sessions[0].restUntil!;
  await page.getByRole('button', { name: '+30 秒', exact: true }).click();
  await expectPersisted(page, data => data.sessions[0].restUntil === restBefore + 30_000);
  await page.getByRole('button', { name: '跳过休息', exact: true }).click();
  await page.getByLabel('杠铃深蹲第1组类型', { exact: true }).selectOption('work');
  await page.getByLabel('杠铃深蹲第2组总重量', { exact: true }).fill('60');
  await page.getByRole('button', { name: '完成杠铃深蹲第2组', exact: true }).click();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).volumeKg === 1200);
  await page.getByRole('button', { name: '撤销杠铃深蹲第2组', exact: true }).click();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).volumeKg === 600);
  await page.clock.fastForward(60_000);
  await page.getByRole('button', { name: '暂停训练', exact: true }).click();
  await expectPersisted(page, data => data.sessions[0].status === 'paused');
  const paused = (await storedWorkspace(page)).sessions[0];
  const pausedSeconds = sessionStats(paused, paused.pausedAt).activeSeconds;
  await page.clock.fastForward(180_000);
  await page.reload();
  await expect(page.getByText('训练已暂停', { exact: true })).toBeVisible();
  await expect(weight).toHaveValue('60');
  const restored = (await storedWorkspace(page)).sessions[0];
  expect(sessionStats(restored, await page.evaluate(() => Date.now())).activeSeconds).toBe(pausedSeconds);
  await page.getByRole('button', { name: '继续训练', exact: true }).click();
  await page.clock.fastForward(1_000);
  await page.getByRole('button', { name: '提前回顾', exact: true }).click();
  await expect(page.getByRole('heading', { name: '每一组，都算数。' })).toBeVisible();
  await page.getByRole('button', { name: '保存训练', exact: true }).click();
  await expectPersisted(page, data => data.sessions.length === 1 && data.sessions[0].status === 'completed');
  const archived = (await storedWorkspace(page)).sessions[0];
  expect(sessionStats(archived).volumeKg).toBe(600);
  expect(sessionStats(archived).completedSets).toBe(1);
  expect(sessionStats(archived).activeSeconds).toBeGreaterThanOrEqual(pausedSeconds + 1);
  expect(sessionStats(archived).activeSeconds).toBeLessThan(pausedSeconds + 10);
  await page.getByRole('button', { name: /全身基础.*2026-10-15/ }).click();
  await expect(page.getByRole('dialog', { name: '全身基础', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByText('600', { exact: false }).first()).toBeVisible();
});

test('下载备份并在空环境导入，重复导入不重复历史', async ({ page, browser }) => {
  await finishOneSet(page);
  const original = await storedWorkspace(page);
  await settings(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/健力宝备份.*\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  const downloaded = JSON.parse(await readFile(path!, 'utf8'));
  expect(downloaded.data.sessions).toEqual(original.sessions);
  const clean = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  try {
    const empty = await clean.newPage();
    await ready(empty);
    await settings(empty);
    await empty.getByLabel('选择健力宝备份文件').setInputFiles(path!);
    await expect(empty.getByRole('dialog', { name: '预览导入备份' })).toBeVisible();
    expect((await storedWorkspace(empty)).sessions).toHaveLength(0);
    await empty.getByRole('button', { name: '确认导入', exact: true }).click();
    await expectPersisted(empty, data => data.sessions.length === 1);
    expect((await storedWorkspace(empty)).sessions).toEqual(original.sessions);
    await empty.getByLabel('选择健力宝备份文件').setInputFiles(path!);
    await empty.getByRole('button', { name: '确认导入', exact: true }).click();
    await expectPersisted(empty, data => data.sessions.length === 1);
    await empty.reload();
    expect((await storedWorkspace(empty)).sessions).toEqual(original.sessions);
  } finally { await clean.close(); }
});

test('错误JSON拒绝；冲突预览/取消不写，显式选择后合并', async ({ page }) => {
  await finishOneSet(page);
  await settings(page);
  const original = await storedWorkspace(page);
  await page.getByLabel('选择健力宝备份文件').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('不是有效的 JSON');
  expect(await storedWorkspace(page)).toEqual(original);
  const changed = structuredClone(original);
  changed.sessions[0].note = '来自备份的训练备注';
  await page.getByLabel('选择健力宝备份文件').setInputFiles(backupFile(changed));
  await expect(page.getByRole('dialog')).toContainText('1 条冲突');
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  expect(await storedWorkspace(page)).toEqual(original);
  await page.getByRole('button', { name: '取消导入', exact: true }).click();
  expect(await storedWorkspace(page)).toEqual(original);
  await page.getByLabel('选择健力宝备份文件').setInputFiles(backupFile(changed));
  await page.getByLabel('冲突处理').selectOption('use-import');
  await page.getByLabel('我已查看冲突项，确认按所选方式合并').check();
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expectPersisted(page, data => data.sessions.length === 1 && data.sessions[0].note === changed.sessions[0].note);
});

test('单位反复切换不重写原始kg记录，已有训练自动休息设置生效', async ({ page }) => {
  await begin(page);
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('21.37');
  await expectPersisted(page, data => data.sessions[0].exercises[0].sets[0].weightKg === 21.37);
  for (const unit of ['lb', 'kg', 'lb', 'kg']) {
    await settings(page);
    await page.getByLabel('重量单位', { exact: true }).selectOption(unit);
    await expectPersisted(page, data => data.settings.unit === unit);
    await page.goto('/#/workout');
    await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue(unit === 'kg' ? '21.37' : '47.11');
  }
  const stored = (await storedWorkspace(page)).sessions[0].exercises[0].sets[0];
  expect(stored.weightKg).toBe(21.37);
  await settings(page);
  await page.getByLabel('自动休息', { exact: true }).uncheck();
  await expectPersisted(page, data => !data.settings.autoRest);
  await page.goto('/#/workout');
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await expectPersisted(page, data => data.sessions[0].exercises[0].sets[0].status === 'completed');
  expect((await storedWorkspace(page)).sessions[0].restUntil).toBeNull();
});

test('本地写入失败保留界面输入、导出当前草稿、重试恢复', async ({ page }) => {
  await begin(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.defineProperty(window, '__restoreTestStore', { configurable: true, value: () => { IDBObjectStore.prototype.put = original; } });
    IDBObjectStore.prototype.put = function () { throw new DOMException('测试模拟存储空间不足', 'QuotaExceededError'); };
  });
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('72.5');
  await expect(page.getByRole('alert')).toContainText('本地保存未完成');
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('72.5');
  expect((await storedWorkspace(page)).sessions[0].exercises[0].sets[0].weightKg).toBe(0);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前记录', exact: true }).click();
  const path = await (await downloadPromise).path();
  const unsaved = JSON.parse(await readFile(path!, 'utf8'));
  expect(unsaved.data.sessions[0].exercises[0].sets[0].weightKg).toBe(72.5);
  await page.evaluate(() => { (window as unknown as { __restoreTestStore: () => void }).__restoreTestStore(); });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expectPersisted(page, data => data.sessions[0].exercises[0].sets[0].weightKg === 72.5);
  await expect(page.getByText('已保存到本机', { exact: false }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('72.5');
});

test('双页面显式切换编辑权，旧页不能覆盖当前编辑页', async ({ page, context }) => {
  await begin(page);
  const second = await context.newPage();
  await second.goto('/#/workout');
  await expect(second.getByText('当前为只读模式：另一个页面正在编辑。')).toBeVisible();
  await expect(second.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toBeDisabled();
  await second.getByRole('button', { name: '在此页编辑', exact: true }).click();
  await expect(second.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toBeEnabled();
  await second.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('65');
  await expectPersisted(second, data => data.sessions[0].exercises[0].sets[0].weightKg === 65);
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toBeDisabled();
  expect((await storedWorkspace(page)).sessions[0].exercises[0].sets[0].weightKg).toBe(65);
  await second.close();
  await page.getByRole('button', { name: '在此页编辑', exact: true }).click();
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('65');
});

test('没有跨页通信的降级环境仍拒绝过期写入并保留当前输入', async ({ page, context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    Reflect.deleteProperty(window, 'BroadcastChannel');
  });
  await begin(page);
  const stale = await context.newPage();
  await stale.goto('/#/workout');
  await expect(stale.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toBeEnabled();
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('50');
  await expectPersisted(page, data => data.sessions[0].exercises[0].sets[0].weightKg === 50);
  await stale.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('70');
  await expect(stale.getByRole('alert')).toContainText('本地内容已被另一页面更新');
  await expect(stale.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('70');
  expect((await storedWorkspace(stale)).sessions[0].exercises[0].sets[0].weightKg).toBe(50);
});

test('双击完成/撤销与归档只改变一次，非法次数不能完成', async ({ page }) => {
  await begin(page);
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('60');
  await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('0');
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  expect((await storedWorkspace(page)).sessions[0].exercises[0].sets[0].status).toBe('pending');
  await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('10');
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).dblclick();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).completedSets === 1);
  await page.getByRole('button', { name: '撤销杠铃深蹲第1组', exact: true }).dblclick();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).completedSets === 0);
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await page.getByRole('button', { name: '提前回顾', exact: true }).click();
  await page.getByRole('button', { name: '保存训练', exact: true }).dblclick();
  await expectPersisted(page, data => data.sessions.length === 1 && data.sessions[0].status === 'completed');
});

test('自由训练覆盖次数和时长，已加载页面断网仍可记录归档', async ({ page, context }, info) => {
  await ready(page);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '计划', exact: true }).click();
  await page.getByRole('button', { name: '直接开始自由训练', exact: true }).click();
  await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
  await page.getByRole('button', { name: '添加动作', exact: true }).click();
  await page.getByRole('combobox', { name: '选择动作', exact: true }).selectOption('ex-pushup');
  await page.getByRole('button', { name: '加入训练', exact: true }).click();
  await context.setOffline(true);
  await expect(page.getByText('当前离线，已加载的记录功能继续保存在本机。')).toBeVisible();
  await page.getByLabel('俯卧撑第1组次数', { exact: true }).fill('12');
  await page.getByRole('button', { name: '完成俯卧撑第1组', exact: true }).click();
  await page.getByRole('button', { name: '添加 / 替换动作', exact: true }).click();
  await page.getByRole('combobox', { name: '选择动作', exact: true }).selectOption('ex-plank');
  await page.getByRole('button', { name: '加入训练', exact: true }).click();
  await page.getByLabel('平板支撑第1组时长', { exact: true }).fill('45');
  await page.getByRole('button', { name: '完成平板支撑第1组', exact: true }).click();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).completedSets === 2);
  await page.getByRole('button', { name: '提前回顾', exact: true }).click();
  await expect(page.getByText('不适用', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('free-training-review.png'), fullPage: true });
  await page.getByRole('button', { name: '保存训练', exact: true }).click();
  await expectPersisted(page, data => data.sessions[0].status === 'completed');
  const stats = sessionStats((await storedWorkspace(page)).sessions[0]);
  expect(stats).toMatchObject({ reps: 12, durationSeconds: 45, volumeKg: 0, completedSets: 2 });
});

test('历史修正重算，模板改名/归档不改变已完成快照', async ({ page }) => {
  await finishOneSet(page);
  await page.getByRole('button', { name: /全身基础.*组.*分钟/ }).click();
  await page.getByRole('button', { name: '修正记录', exact: true }).click();
  await page.getByLabel('修正杠铃深蹲第1组重量', { exact: true }).fill('80');
  await page.getByRole('button', { name: '保存修正', exact: true }).click();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).volumeKg === 800);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '计划', exact: true }).click();
  const card = page.locator('.template-card').filter({ has: page.getByRole('heading', { name: '全身基础', exact: true }) });
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('模板名称', { exact: true }).fill('全身基础·已调整');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expectPersisted(page, data => data.templates[0].name === '全身基础·已调整');
  await page.getByRole('button', { name: '归档模板全身基础·已调整', exact: true }).click();
  await page.getByRole('button', { name: '确认归档模板', exact: true }).click();
  await expectPersisted(page, data => !!data.templates[0].archived);
  const archived = (await storedWorkspace(page)).sessions[0];
  expect(archived.name).toBe('全身基础');
  expect(archived.exercises[0].exercise.name).toBe('杠铃深蹲');
  expect(sessionStats(archived).volumeKg).toBe(800);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '进步', exact: true }).click();
  await page.getByRole('button', { name: /全身基础.*组.*分钟/ }).click();
  await expect(page.getByRole('dialog', { name: '全身基础', exact: true })).toBeVisible();
});

test('空白模板名被拒绝不污染数据，之后可正常保存', async ({ page }) => {
  await ready(page);
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '计划', exact: true }).click();
  await page.locator('.template-card').filter({ has: page.getByRole('heading', { name: '全身基础', exact: true }) }).getByRole('button', { name: '编辑', exact: true }).click();
  const before = await storedWorkspace(page);
  await page.getByLabel('模板名称', { exact: true }).fill('   ');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑训练日模板' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('请填写模板名称');
  expect(await storedWorkspace(page)).toEqual(before);
  await page.getByLabel('模板名称', { exact: true }).fill('可以继续保存');
  await page.getByRole('button', { name: '保存模板', exact: true }).click();
  await expectPersisted(page, data => data.templates[0].name === '可以继续保存');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('取消草稿冻结训练时长且不生成完成历史', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-15T06:00:00Z') });
  await begin(page);
  await page.clock.fastForward(60_000);
  await page.getByRole('button', { name: '取消这场训练', exact: true }).click();
  await page.getByRole('button', { name: '确认取消训练', exact: true }).click();
  await expectPersisted(page, data => data.sessions[0].status === 'cancelled');
  const cancelled = (await storedWorkspace(page)).sessions[0];
  const seconds = sessionStats(cancelled).activeSeconds;
  await page.clock.fastForward(180_000);
  expect(sessionStats((await storedWorkspace(page)).sessions[0], await page.evaluate(() => Date.now())).activeSeconds).toBe(seconds);
  expect((await storedWorkspace(page)).sessions.filter(s => s.status === 'completed')).toHaveLength(0);
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeVisible();
});

test('生产离线缓存：刷新恢复并继续保存和归档', async ({ page, context }) => {
  await begin(page);
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('52.5');
  await expectPersisted(page, data => data.sessions[0].exercises[0].sets[0].weightKg === 52.5);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(async () => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('52.5');
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await expectPersisted(page, data => sessionStats(data.sessions[0]).volumeKg === 525);
  await page.getByRole('button', { name: '提前回顾', exact: true }).click();
  await page.getByRole('button', { name: '保存训练', exact: true }).click();
  await expectPersisted(page, data => data.sessions[0].status === 'completed');
  await page.reload();
  await expect(page.getByRole('button', { name: /全身基础.*组.*分钟/ })).toBeVisible();
  expect(sessionStats((await storedWorkspace(page)).sessions[0]).volumeKg).toBe(525);
});

for (const width of [320, 390, 768, 1440]) {
  test(`${width}px 布局与关键训练操作`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    await page.screenshot({ path: info.outputPath(`today-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
    await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('40');
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await expectPersisted(page, data => sessionStats(data.sessions[0]).volumeKg === 400);
    await page.screenshot({ path: info.outputPath(`workout-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await settings(page);
    await page.getByLabel('界面主题', { exact: true }).selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: info.outputPath(`settings-light-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
