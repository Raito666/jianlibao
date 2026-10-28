import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { backupFile, expectPersisted, storedWorkspace } from './helpers';
import { overflowFindings } from './overflow-helpers';
import { sessionStats } from '../../src/domain/training';

async function settings(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('button', { name: '记录身体数据', exact: true })).toBeEnabled();
}
async function add(page: Page, date: string, weight = '70') {
  await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
  await page.getByLabel('记录日期', { exact: true }).fill(date);
  await page.getByLabel('体重 (kg)', { exact: true }).fill(weight);
}
async function failNextWrite(page: Page) {
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = put;
      throw new DOMException('No room', 'QuotaExceededError');
    };
  });
}
for (const reverse of [false, true])
  test(`交叉身份身体备份整批拒绝且保留原记录，reverse=${reverse}`, async ({ page }) => {
    await settings(page);
    await add(page, '2026-10-17');
    await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
    await expectPersisted(page, (data) => data.bodyMetrics.length === 1);
    const before = await storedWorkspace(page),
      incoming = structuredClone(before),
      original = incoming.bodyMetrics[0];
    incoming.bodyMetrics = [
      { ...original, id: 'other-device-body' },
      { ...original, date: '2026-10-18', weightKg: 71 },
    ];
    if (reverse) incoming.bodyMetrics.reverse();
    await page.getByLabel('选择健力宝备份文件', { exact: true }).setInputFiles(backupFile(incoming));
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('交叉对应');
    await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '取消导入', exact: true }).click();
    expect(await storedWorkspace(page)).toEqual(before);
  });
for (const cancel of ['keep', 'close', 'escape'] as const)
  test(`删除失败后${cancel}保留记录，后续重试不能提交已取消删除`, async ({ page }) => {
    await settings(page);
    await add(page, '2026-10-17');
    await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
    await expectPersisted(page, (d) => d.bodyMetrics.length === 1);
    await add(page, '2026-10-18', '71');
    await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
    await expectPersisted(page, (d) => d.bodyMetrics.length === 2);
    const before = (await storedWorkspace(page)).bodyMetrics;
    await page.getByRole('button', { name: '删除2026-10-17身体记录', exact: true }).click();
    await failNextWrite(page);
    await page.getByRole('button', { name: '确认删除身体记录', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('尚未写入磁盘');
    expect((await storedWorkspace(page)).bodyMetrics).toEqual(before);
    if (cancel === 'keep') await page.getByRole('button', { name: '保留身体记录', exact: true }).click();
    else if (cancel === 'close') await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    else await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '编辑2026-10-17身体记录', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await expectPersisted(page, (d) => JSON.stringify(d.bodyMetrics) === JSON.stringify(before));
    await page.reload();
    expect((await storedWorkspace(page)).bodyMetrics).toEqual(before);
  });
for (const mode of ['new', 'edit'] as const)
  test(`身体${mode}保存失败后取消会撤销待保存更改`, async ({ page }) => {
    await settings(page);
    if (mode === 'edit') {
      await add(page, '2026-10-17');
      await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
      await expectPersisted(page, (d) => d.bodyMetrics.length === 1);
    }
    const before = (await storedWorkspace(page)).bodyMetrics;
    if (mode === 'edit') await page.getByRole('button', { name: '编辑2026-10-17身体记录', exact: true }).click();
    else await add(page, '2026-10-17');
    await page.getByLabel('体重 (kg)', { exact: true }).fill('78');
    await failNextWrite(page);
    await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('当前输入已保留');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '重试保存', exact: true }).click();
    await expectPersisted(page, (d) => JSON.stringify(d.bodyMetrics) === JSON.stringify(before));
    await page.reload();
    expect((await storedWorkspace(page)).bodyMetrics).toEqual(before);
  });
test('身体数据完整录入、七项趋势、稳定ID编辑、单位精度、刷新和删除确认', async ({ page }) => {
  await settings(page);
  await add(page, '2026-10-17', '72.123456');
  await page.getByLabel('体脂率 (%)', { exact: true }).fill('18.5');
  await page.getByText('补充围度 · cm', { exact: true }).click();
  for (const [label, value] of [
    ['胸围', '98'],
    ['腰围', '80'],
    ['臀围', '96'],
    ['臂围', '34'],
    ['腿围', '55'],
  ])
    await page.getByLabel(`${label} (cm)`, { exact: true }).fill(value);
  await page.getByLabel('备注（可选）', { exact: true }).fill('晨间实际测量');
  await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
  await expectPersisted(page, (d) => d.bodyMetrics.length === 1 && d.bodyMetrics[0].measurements?.thigh === 55);
  const first = (await storedWorkspace(page)).bodyMetrics[0];
  for (const key of ['weight', 'bodyFat', 'chest', 'waist', 'hip', 'arm', 'thigh']) {
    await page.getByLabel('身体趋势指标', { exact: true }).selectOption(key);
    await expect(page.locator('.body-metrics .chart-point')).toHaveCount(1);
  }
  await page.getByLabel('重量单位', { exact: true }).selectOption('lb');
  await page.getByRole('button', { name: '编辑2026-10-17身体记录', exact: true }).click();
  await expect(page.getByLabel('体重 (lb)', { exact: true })).toHaveValue('159.01');
  await page.getByLabel('备注（可选）', { exact: true }).fill('只修改备注');
  await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
  await expectPersisted(page, (d) => d.bodyMetrics[0].note === '只修改备注');
  expect((await storedWorkspace(page)).bodyMetrics[0]).toMatchObject({ id: first.id, weightKg: first.weightKg });
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑2026-10-17身体记录', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '删除2026-10-17身体记录', exact: true }).click();
  await page.getByRole('button', { name: '保留身体记录', exact: true }).click();
  expect((await storedWorkspace(page)).bodyMetrics).toHaveLength(1);
  await page.getByRole('button', { name: '删除2026-10-17身体记录', exact: true }).click();
  await page.getByRole('button', { name: '确认删除身体记录', exact: true }).click();
  await expectPersisted(page, (d) => d.bodyMetrics.length === 0);
});

test('空项和同日冲突保留输入，保存失败不覆盖磁盘并可重试', async ({ page }) => {
  await settings(page);
  await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
  await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '请检查以下项目' })).toBeFocused();
  await expect(page.getByLabel('体重 (kg)', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await add(page, '2026-10-17');
  await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
  await expectPersisted(page, (d) => d.bodyMetrics.length === 1);
  await add(page, '2026-10-17', '71');
  await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('体重 (kg)', { exact: true })).toHaveValue('71');
  expect((await storedWorkspace(page)).bodyMetrics[0].weightKg).toBe(70);
  await page.getByLabel('记录日期', { exact: true }).fill('2026-10-18');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      IDBObjectStore.prototype.put = put;
      throw new DOMException('No room', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('当前输入已保留');
  expect((await storedWorkspace(page)).bodyMetrics).toHaveLength(1);
  await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
  await expectPersisted(page, (d) => d.bodyMetrics.length === 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await storedWorkspace(page)).bodyMetrics).toHaveLength(2);
});

test('实际旧版导出通过界面导入并迁移，v2身体备份重复导入与同日冲突可核对', async ({ page }) => {
  await settings(page);
  const oldText = await readFile(new URL('../fixtures/legacy-v1-ui-backup.json', import.meta.url), 'utf8');
  await page
    .getByLabel('选择健力宝备份文件', { exact: true })
    .setInputFiles({ name: 'old-v1.json', mimeType: 'application/json', buffer: Buffer.from(oldText) });
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expectPersisted(page, (d) => d.schemaVersion === 2 && d.sessions.length === 2);
  const old = JSON.parse(oldText).data,
    imported = await storedWorkspace(page);
  expect(imported.sessions).toEqual(old.sessions);
  expect(imported.settings.favoriteExerciseIds).toEqual(undefined); // import preserves local preferences
  await add(page, '2026-10-17');
  await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
  await expectPersisted(page, (d) => d.bodyMetrics.length === 1);
  const before = await storedWorkspace(page),
    incoming = structuredClone(before);
  incoming.bodyMetrics[0] = { ...incoming.bodyMetrics[0], id: 'other-device-body', weightKg: 80 };
  await page.getByLabel('选择健力宝备份文件', { exact: true }).setInputFiles(backupFile(incoming));
  await expect(page.getByRole('dialog')).toContainText('身体数据');
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '取消导入', exact: true }).click();
  expect((await storedWorkspace(page)).bodyMetrics).toEqual(before.bodyMetrics);
  await page.getByLabel('选择健力宝备份文件', { exact: true }).setInputFiles(backupFile(incoming));
  await page.getByLabel('冲突处理', { exact: true }).selectOption('use-import');
  await page.getByLabel('我已查看冲突项，确认按所选方式合并', { exact: true }).check();
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expectPersisted(page, (d) => d.bodyMetrics[0].weightKg === 80);
  await page.getByLabel('选择健力宝备份文件', { exact: true }).setInputFiles(backupFile(incoming));
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await storedWorkspace(page)).bodyMetrics).toHaveLength(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const savedPath = await (await download).path();
  expect(savedPath).not.toBeNull();
  const exported = JSON.parse(await readFile(savedPath!, 'utf8'));
  expect(exported.formatVersion).toBe(2);
  expect(exported.data.bodyMetrics).toEqual(incoming.bodyMetrics);
  expect(exported.data.sessions).toEqual(old.sessions);
});

test('已落盘v1自动迁移保留回退副本，第二页面身体数据只读', async ({ page, context }) => {
  const old = JSON.parse(await readFile(new URL('../fixtures/legacy-v1-ui-backup.json', import.meta.url), 'utf8')).data;
  await page.addInitScript(async (data) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open('jianlibao', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('workspace');
      r.onsuccess = () => {
        const tx = r.result.transaction('workspace', 'readwrite');
        tx.objectStore('workspace').put(data, 'main');
        tx.oncomplete = () => {
          r.result.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
      r.onerror = () => reject(r.error);
    });
  }, old);
  await settings(page);
  await expectPersisted(page, (d) => d.schemaVersion === 2 && d.revision === old.revision + 1);
  expect((await storedWorkspace(page)).sessions).toEqual(old.sessions);
  const copy = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open('jianlibao', 1);
        r.onsuccess = () => {
          const tx = r.result.transaction('workspace');
          const get = tx.objectStore('workspace').get('pre-schema-v2');
          get.onsuccess = () => resolve(get.result);
          tx.oncomplete = () => r.result.close();
        };
      }),
  );
  expect(copy).toEqual(old);
  const second = await context.newPage();
  await second.goto('/#/settings');
  await expect(second.getByRole('button', { name: '记录身体数据', exact: true })).toBeDisabled();
  await expect(second.getByLabel('显示主观用力 RPE', { exact: true })).toBeDisabled();
  await second.close();
});

test('新组类型与RPE贯穿训练、刷新、回顾、历史修正，关闭偏好保留已有RPE', async ({ page }) => {
  await settings(page);
  await page.getByLabel('显示主观用力 RPE', { exact: true }).check();
  await expectPersisted(page, (d) => d.settings.showRpe);
  await page.goto('/#/today');
  await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
  await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
  for (const [index, type, weight, rpe] of [
    [1, 'drop', '60', '8.5'],
    [2, 'failure', '50', '10'],
  ] as const) {
    await page.getByLabel(`杠铃深蹲第${index}组类型`, { exact: true }).selectOption(type);
    await page.getByLabel(`杠铃深蹲第${index}组总重量`, { exact: true }).fill(weight);
    await page.getByLabel(`杠铃深蹲第${index}组RPE`, { exact: true }).selectOption(rpe);
    await page.getByRole('button', { name: `完成杠铃深蹲第${index}组`, exact: true }).click();
    await page.getByRole('button', { name: '跳过休息', exact: true }).click();
  }
  await expectPersisted(
    page,
    (d) => sessionStats(d.sessions[0]).workSets === 2 && sessionStats(d.sessions[0]).volumeKg === 1100,
  );
  await page.reload();
  await expect(page.getByLabel('杠铃深蹲第1组RPE', { exact: true })).toHaveValue('8.5');
  await page.getByLabel('杠铃深蹲第1组RPE', { exact: true }).selectOption('');
  await expectPersisted(page, (d) => !Object.hasOwn(d.sessions[0].exercises[0].sets[0], 'rpe'));
  await page.getByRole('button', { name: '提前回顾', exact: true }).click();
  await expect(page.locator('.rpe-select')).toHaveCount(0);
  await page.getByRole('button', { name: '保存训练', exact: true }).click();
  await expectPersisted(page, (d) => d.sessions[0].status === 'completed');
  await settings(page);
  await page.getByLabel('显示主观用力 RPE', { exact: true }).uncheck();
  await expectPersisted(page, (d) => !d.settings.showRpe);
  await page.goto('/#/progress');
  await page
    .getByRole('button', { name: /全身基础.*\d{4}-\d{2}-\d{2}/ })
    .first()
    .click();
  await expect(page.getByRole('dialog').getByText('力竭', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('columnheader', { name: 'RPE', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '修正记录', exact: true }).click();
  await page.getByLabel('修正杠铃深蹲第2组RPE', { exact: true }).selectOption('9.5');
  await page.getByLabel('修正杠铃深蹲第2组类型', { exact: true }).selectOption('drop');
  await page.getByRole('button', { name: '保存修正', exact: true }).click();
  await expectPersisted(
    page,
    (d) => d.sessions[0].exercises[0].sets[1].rpe === 9.5 && d.sessions[0].exercises[0].sets[1].type === 'drop',
  );
});

for (const width of [320, 390, 768, 1440])
  for (const theme of ['dark', 'light'] as const)
    test(`${width}px ${theme} 身体表单和长备注完整可见`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await settings(page);
      await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await add(page, '2026-10-17', '72.4');
      await page.getByText('补充围度 · cm', { exact: true }).click();
      for (const label of ['胸围', '腰围', '臀围', '臂围', '腿围'])
        await page.getByLabel(`${label} (cm)`, { exact: true }).fill('80.5');
      await page.getByLabel('备注（可选）', { exact: true }).fill('阶段6实际测量记录BodyMetric'.repeat(200));
      await expect.poll(() => overflowFindings(page)).toEqual([]);
      await page.screenshot({ path: info.outputPath('body-form.png') });
      await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
      await expectPersisted(page, (d) => d.bodyMetrics.length === 1);
      await expect.poll(() => overflowFindings(page)).toEqual([]);
      await page.screenshot({ path: info.outputPath('body-long-note.png'), fullPage: true });
    });

for (const width of [320, 390, 768, 1440])
  for (const theme of ['dark', 'light'] as const)
    test(`${width}px ${theme} RPE训练行不越界且完成按钮可操作`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width < 768 ? 667 : 1000 });
      await settings(page);
      await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
      await page.getByLabel('显示主观用力 RPE', { exact: true }).check();
      await expectPersisted(page, (d) => d.settings.showRpe);
      await page.goto('/#/today');
      await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
      await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
      await page.getByLabel('杠铃深蹲第1组类型', { exact: true }).selectOption('failure');
      await page.getByLabel('杠铃深蹲第1组RPE', { exact: true }).selectOption('9.5');
      await expect.poll(() => overflowFindings(page)).toEqual([]);
      const complete = page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true });
      await complete.scrollIntoViewIfNeeded();
      // Native view-transition snapshots temporarily hit HTML, even though the real button is unobscured.
      // Wait for the existing finite entry animation, then retain the exact physical hit assertion.
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .every((animation) => animation.playState !== 'running' && !animation.pending),
      );
      expect(
        await complete.evaluate((button) => {
          const r = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath('rpe-training.png') });
      await complete.click();
      await expectPersisted(
        page,
        (d) =>
          d.sessions[0].exercises[0].sets[0].status === 'completed' && d.sessions[0].exercises[0].sets[0].rpe === 9.5,
      );
    });
