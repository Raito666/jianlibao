import { expect, test, type Page } from '@playwright/test';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise } from '../../src/domain/training';
import { muscleGroups } from '../../src/content/body-map';
import { backupFile, expectPersisted, storedWorkspace } from './helpers';
import { readFile } from 'node:fs/promises';
import { overflowFindings } from './overflow-helpers';
import { validateAppData } from '../../src/data/backup';

async function install(page: Page, theme: 'dark' | 'light') {
  const data = createInitialData();
  const session = createSession(null, data.exercises, Date.parse('2026-10-18T06:00:00Z'));
  session.status = 'completed';
  session.finishedAt = '2026-10-18T06:20:00.000Z';
  session.updatedAt = session.finishedAt;
  session.exercises = data.exercises.slice(0, 6).map((ex) => {
    const item = createSessionExercise(ex, 1, 60, 10, 30);
    item.sets[0].status = 'completed';
    return item;
  });
  data.sessions = [session];
  data.onboarded = true;
  data.settings.theme = theme;
  data.exercises.push({
    id: 'legacy-ambiguous',
    name: '旧手臂动作',
    muscle: '手臂',
    equipment: '自重',
    kind: 'reps',
    description: '保留旧版私人说明',
  });
  data.bodyMetrics = [{ id: 'stage7-body', date: '2026-10-18', weightKg: 72, note: '阶段6数据保留' }];
  validateAppData(data);
  await page.clock.setFixedTime(new Date('2026-10-19T06:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('jianlibao', 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('workspace', 'readwrite');
          tx.objectStore('workspace').put(data, 'main');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    data,
  );
  await page.reload();
  return data;
}

for (const width of [320, 390, 768, 1440])
  for (const theme of ['dark', 'light'] as const) {
    test(`阶段7首屏、单一分类、统计分层与只读浏览 ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      const original = await install(page, theme);
      await page.goto('/#/exercises');
      await expect(page.locator('.movement-card')).toHaveCount(24);
      const disclosure = page.getByRole('button', { name: /按身体部位筛选/ });
      await expect(disclosure).toHaveAttribute('aria-expanded', String(width > 760));
      if (width <= 760) {
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() =>
          document.getAnimations().every((a) => a.playState !== 'running' && !a.pending),
        );
        const firstCards = await page.locator('.movement-card').evaluateAll((cards) =>
          cards.slice(0, 2).map((card) => {
            const rect = card.getBoundingClientRect(),
              nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, limit: nav?.top ?? innerHeight };
          }),
        );
        expect(firstCards).toHaveLength(2);
        for (const card of firstCards) {
          expect(card.top).toBeGreaterThanOrEqual(0);
          expect(card.bottom).toBeLessThanOrEqual(card.limit + 1);
        }
        await expect(page.locator('.body-atlas')).not.toBeVisible();
        await disclosure.click();
      }
      await expect(page.locator('.body-atlas')).toBeVisible();
      const names = page.locator('.atlas-region-picker');
      if (!(await names.evaluate((el) => (el as HTMLDetailsElement).open))) await names.locator('summary').click();
      const group = page.getByRole('group', { name: '身体部位名称', exact: true });
      await expect(group.getByRole('button')).toHaveCount(17);
      for (const muscle of muscleGroups)
        await expect(group.getByRole('button', { name: new RegExp(`^${muscle.label}\\s*\\d`) })).toHaveCount(1);
      await expect(page.getByRole('group', { name: '部位筛选', exact: true })).toHaveCount(0);
      await group.getByRole('button', { name: /^大腿后侧/ }).click();
      await expect(page.locator('.selected-body-label')).toHaveText(' · 大腿后侧');
      const count = await page.locator('.library-filter-line strong').innerText();
      expect(Number(count)).toBeGreaterThan(0);
      await disclosure.click();
      await expect(page.locator('.body-atlas')).not.toBeVisible();
      await expect(disclosure).toContainText('大腿后侧');
      await expect(page.locator('.library-filter-line strong')).toHaveText(count);
      await disclosure.click();
      await expect(page.locator('.atlas-selection-copy h4')).toHaveText('大腿后侧');
      await page.getByRole('button', { name: '取消部位选择', exact: true }).click();
      await page.getByLabel('搜索动作', { exact: true }).fill('大腿后侧');
      expect(Number(await page.locator('.library-filter-line strong').innerText())).toBeGreaterThan(0);
      await page.goto('/#/progress');
      await page.getByRole('button', { name: '统计总览', exact: true }).click();
      if (width <= 760) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() =>
          document.getAnimations().every((a) => a.playState !== 'running' && !a.pending),
        );
        const metrics = await page.locator('.analytics-metric').evaluateAll((elements) =>
          elements.map((el) => ({
            bottom: el.getBoundingClientRect().bottom,
            limit: document.querySelector('.mobile-nav')!.getBoundingClientRect().top,
          })),
        );
        expect(metrics).toHaveLength(4);
        for (const metric of metrics) expect(metric.bottom).toBeLessThanOrEqual(metric.limit + 1);
      }
      await expect(page.locator('.records-list > button')).toHaveCount(3);
      const order = await page.locator('.statistics-page').evaluate((el) => {
        const selectors = [
          '.analytics-overview',
          '.analytics-trend',
          '.muscle-balance',
          '.heatmap-panel',
          '.personal-records',
          '.training-breakdown',
        ];
        return selectors.map((selector) => {
          const node = el.querySelector(selector);
          if (!node) throw Error(`Missing ${selector}`);
          return [...el.querySelectorAll('*')].indexOf(node);
        });
      });
      expect(order).toEqual([...order].sort((a, b) => a - b));
      await page.getByRole('button', { name: /查看全部 6 项纪录/ }).click();
      await expect(page.locator('.records-list > button')).toHaveCount(6);
      await page.getByRole('button', { name: '收起纪录', exact: true }).click();
      await expect(page.locator('.records-list > button')).toHaveCount(3);
      await page.getByRole('button', { name: /查看全部 6 项纪录/ }).click();
      await page
        .getByRole('group', { name: '统计周期', exact: true })
        .getByRole('button', { name: '近7天', exact: true })
        .click();
      await expect(page.locator('.records-list > button')).toHaveCount(3);
      const labels = await page.locator('.muscle-bars strong').allTextContents();
      for (const label of labels) expect(muscleGroups.map((g) => g.label)).toContain(label);
      expect(await overflowFindings(page)).toEqual([]);
      await page.locator('.records-list > button').first().click();
      await expect(page.getByLabel('趋势动作', { exact: true })).toBeVisible();
      expect(await storedWorkspace(page)).toEqual(original);
    });
  }

test('创建动作统一16项，旧宽泛标签仍可搜索和阅读且不会被重写', async ({ page }) => {
  const original = await install(page, 'dark');
  await page.goto('/#/exercises');
  await page
    .getByRole('group', { name: '动作收藏筛选', exact: true })
    .getByRole('button', { name: '自定义', exact: true })
    .click();
  await page.getByLabel('搜索动作', { exact: true }).fill('手臂');
  const legacy = page
    .locator('.movement-card')
    .filter({ has: page.getByRole('heading', { name: '旧手臂动作', exact: true }) });
  await expect(legacy).toContainText('手臂 · 未细分');
  await legacy.getByRole('button', { name: '查看旧手臂动作讲解', exact: true }).click();
  await expect(page.locator('.custom-exercise-guide')).toContainText('保留旧版私人说明');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  expect((await storedWorkspace(page)).exercises).toEqual(original.exercises);
  await page.getByRole('button', { name: '自定义动作', exact: true }).click();
  const select = page.getByLabel(/^主要部位/);
  await expect(select).toBeVisible();
  await expect(select.locator('option:not([value=""])')).toHaveText(muscleGroups.map((g) => g.label));
  await page.getByLabel('动作名称', { exact: true }).fill('我的腿后侧');
  await select.selectOption('大腿后侧');
  await page.getByRole('button', { name: '创建动作', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const stored = await storedWorkspace(page);
  expect(stored.exercises.find((ex) => ex.name === '我的腿后侧')?.muscle).toBe('大腿后侧');
  expect(stored.sessions).toEqual(original.sessions);
  expect(stored.bodyMetrics).toEqual(original.bodyMetrics);
  await page.getByLabel('搜索动作', { exact: true }).fill('大腿后侧');
  await expect(page.getByRole('heading', { name: '我的腿后侧', exact: true })).toBeVisible();
});

test('复合旧标签经真实备份导入、统计、导出及刷新后保持原值和阶段6记录', async ({ page }) => {
  const original = await install(page, 'dark'),
    incoming = structuredClone(original);
  const exercise = {
    id: 'compound-legacy',
    name: '旧复合动作',
    muscle: '胸部/背部',
    equipment: '自重',
    kind: 'reps' as const,
    description: '旧版双部位私人说明',
  };
  incoming.exercises.push(exercise);
  const session = createSession(null, [], Date.parse('2026-10-18T08:00:00Z'));
  session.status = 'completed';
  session.finishedAt = '2026-10-18T08:10:00.000Z';
  session.updatedAt = session.finishedAt;
  session.exercises = [createSessionExercise(exercise, 1)];
  session.exercises[0].sets[0] = { ...session.exercises[0].sets[0], type: 'failure', rpe: 8.5, status: 'completed' };
  incoming.sessions.push(session);
  validateAppData(incoming);
  await page.goto('/#/settings');
  await page.getByLabel('选择健力宝备份文件', { exact: true }).setInputFiles(backupFile(incoming));
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectPersisted(page, (d) => d.sessions.some((s) => s.id === session.id));
  await page.goto('/#/exercises');
  await page.getByLabel('搜索动作', { exact: true }).fill('胸部/背部');
  await expect(page.locator('.movement-card')).toHaveCount(1);
  await expect(page.locator('.movement-card')).toContainText('胸部/背部 · 未细分');
  await page.goto('/#/progress');
  await page.getByRole('button', { name: '统计总览', exact: true }).click();
  await expect(
    page.locator('.muscle-bars > div').filter({ has: page.getByText('未细分', { exact: true }) }),
  ).toContainText('1 组');
  await page.goto('/#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const path = await (await download).path();
  expect(path).not.toBeNull();
  const exported = JSON.parse(await readFile(path!, 'utf8'));
  expect(exported.formatVersion).toBe(2);
  expect(exported.data.sessions).toEqual(incoming.sessions);
  expect(exported.data.bodyMetrics).toEqual(original.bodyMetrics);
  expect(exported.data.exercises.find((ex: { id: string }) => ex.id === exercise.id)).toEqual(exercise);
  await page.reload();
  const stored = await storedWorkspace(page);
  expect(stored.sessions).toEqual(incoming.sessions);
  expect(stored.bodyMetrics).toEqual(original.bodyMetrics);
});
