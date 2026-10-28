import { chromium, webkit, expect, test, type Page, type Locator } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise } from '../../src/domain/training';
import { validateAppData } from '../../src/data/backup';
import type { AppData } from '../../src/domain/types';
import { storedWorkspace } from './helpers';

function fixture(theme: 'dark' | 'light') {
  const data = createInitialData();
  data.onboarded = true; data.settings.theme = theme;
  for (let index = 1; index <= 20; index++) {
    const now = Date.parse(`2026-10-${String(index).padStart(2, '0')}T06:00:00Z`);
    const session = createSession(null, data.exercises, now);
    session.name = `长列表训练${index} · 保持完整的训练标题`;
    session.note = '长列表滚动回归，浏览不应改动已保存记录。';
    session.status = 'completed'; session.finishedAt = new Date(now + 600000).toISOString();
    session.updatedAt = session.finishedAt;
    session.exercises = [createSessionExercise(data.exercises.find(item => item.id === 'ex-squat')!, 1, 60, 10)];
    session.exercises[0].sets[0].status = 'completed';
    data.sessions.push(session);
  }
  data.bodyMetrics = Array.from({ length: 30 }, (_, index) => ({
    id: `continuity-body-${index}`, date: `2026-09-${String(index + 1).padStart(2, '0')}`,
    weightKg: 70 + index / 10, note: `第${index + 1}条身体记录，保留测量值和完整备注。`,
  }));
  validateAppData(data);
  return data;
}
async function install(page: Page, data: AppData) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
  await page.evaluate(data => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('jianlibao', 1);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(data, 'main');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  }), data);
  await page.reload();
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
}
async function keyboardHarness(page: Page) {
  await page.addInitScript(() => {
    let height: number | null = null, top = 0;
    const viewport = visualViewport!;
    Object.defineProperties(viewport, {
      height: { configurable: true, get: () => height ?? innerHeight },
      offsetTop: { configurable: true, get: () => top },
    });
    Object.assign(window, { continuityKeyboard: (value: number, offset: number) => {
      height = value; top = offset;
      viewport.dispatchEvent(new Event('resize')); viewport.dispatchEvent(new Event('scroll'));
    } });
  });
}
async function keyboard(page: Page, height: number, top = 0) {
  await page.evaluate(({ height, top }) => {
    (window as unknown as { continuityKeyboard: (height: number, top: number) => void }).continuityKeyboard(height, top);
  }, { height, top });
}
async function fitsField(field: Locator, top: number, bottom: number) {
  await expect.poll(() => field.evaluate((element, range) => {
    const box = element.getBoundingClientRect();
    const area = element.closest('.modal-body,.workout-view')?.getBoundingClientRect();
    return box.top >= Math.max(range.top, area?.top ?? range.top) - 1 && box.bottom <= Math.min(range.bottom, area?.bottom ?? range.bottom) + 1;
  }, { top, bottom })).toBe(true);
}
async function touchable(control: Locator) {
  await control.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect.poll(() => control.evaluate(element => {
    const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const nav = document.querySelector('.mobile-nav')?.getBoundingClientRect();
    return box.top >= 0 && box.bottom <= (nav?.top ?? innerHeight) + 1 && Boolean(hit && element.contains(hit));
  })).toBe(true);
}

for (const width of [320, 390]) for (const theme of ['dark', 'light'] as const) {
  test.describe(`${width}px ${theme} 手机连续使用`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    test.beforeEach(async ({ page }) => { await keyboardHarness(page); await install(page, fixture(theme)); });

    test('四模块横竖屏切换仍保留手机布局、触控和训练输入', async ({ page }) => {
      for (const size of [{ width, height: 844 }, { width: 844, height: 390 }, { width, height: 568 }, { width: 956, height: 440 }]) {
        await page.setViewportSize(size); await keyboard(page, size.height);
        await expect(page.locator('.sidebar')).toBeHidden();
        const nav = page.getByRole('navigation', { name: '移动端导航', exact: true });
        await expect(nav).toBeVisible();
        for (const name of ['动作', '进步', '我', '今天']) {
          const button = nav.getByRole('button', { name, exact: true });
          await button.tap(); await expect(button).toHaveClass(/(?:^| )active(?: |$)/);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
      }
      await page.getByRole('button', { name: '开始今天的训练', exact: true }).tap();
      await page.getByRole('button', { name: '确认开始训练', exact: true }).tap();
      const weight = page.getByLabel('杠铃深蹲第1组总重量', { exact: true });
      await weight.fill('65'); await keyboard(page, 220);
      await fitsField(weight, 0, 220);
      await keyboard(page, 440); await weight.blur();
      await expect(weight).toHaveValue('65');
      await expect(page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true })).toBeEnabled();
    });

    test('键盘六次弹收与旋转保留备注，短横屏输入和保存可达', async ({ page }, info) => {
      await page.goto('/#/settings');
      await page.getByRole('button', { name: '记录身体数据', exact: true }).tap();
      await page.getByLabel('体重 (kg)', { exact: true }).fill('72');
      const note = page.getByLabel('备注（可选）', { exact: true });
      await note.fill('反复旋转和键盘弹收后，这条备注仍应完整保留。');
      await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '20px'));
      for (let index = 0; index < 6; index++) {
        const landscape = index % 2 === 1;
        const size = landscape ? { width: 844, height: 390 } : { width, height: 568 };
        await page.setViewportSize(size); await keyboard(page, size.height);
        await note.focus();
        const visible = landscape ? 190 : 260;
        await keyboard(page, visible, 8); await fitsField(note, 8, visible + 8);
        const save = page.getByRole('button', { name: '保存身体记录', exact: true });
        const box = (await save.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.y + box.height).toBeLessThanOrEqual(visible + 9);
        await keyboard(page, size.height);
      }
      await page.screenshot({ path: info.outputPath('rotated-note.png') });
      await page.getByRole('button', { name: '保存身体记录', exact: true }).tap();
      await expect(page.locator('dialog')).toHaveCount(0);
      await page.reload();
      await expect(page.locator('.body-note').filter({ hasText: '反复旋转和键盘弹收后' })).toBeVisible();
      expect((await storedWorkspace(page)).bodyMetrics).toHaveLength(31);
    });

    test('长动作/历史/身体列表可达末项，刷新和关闭重开保留完整数据', async ({ page, context }, info) => {
      const before = await storedWorkspace(page);
      await page.goto('/#/exercises');
      for (let index = 0; index < 2; index++) await page.getByRole('button', { name: /继续浏览 · 还有/ }).tap();
      await expect(page.locator('.movement-card')).toHaveCount(72);
      const lastMovement = page.locator('.movement-card .movement-open').last();
      await touchable(lastMovement); await lastMovement.tap();
      await expect(page.getByRole('tab', { name: '详细讲解', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).tap();
      await page.goto('/#/progress');
      await expect(page.locator('.session-card')).toHaveCount(20);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await touchable(page.locator('.session-card').last());
      await page.goto('/#/settings');
      for (let index = 0; index < 2; index++) await page.getByRole('button', { name: '查看更多身体记录', exact: true }).tap();
      await expect(page.locator('.body-records > li')).toHaveCount(30);
      const lastEdit = page.locator('.body-record-actions').last().getByRole('button', { name: /编辑/ });
      await touchable(lastEdit); await lastEdit.tap();
      await expect(page.getByLabel('备注（可选）', { exact: true })).toHaveValue('第1条身体记录，保留测量值和完整备注。');
      await page.getByRole('button', { name: '取消', exact: true }).tap();
      expect(await storedWorkspace(page)).toEqual(before);
      for (let index = 0; index < 3; index++) { await page.reload(); expect(await storedWorkspace(page)).toEqual(before); }
      const origin = new URL(page.url()).origin; await page.close();
      const reopened = await context.newPage(); await reopened.goto(origin);
      await expect(reopened.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
      expect(await storedWorkspace(reopened)).toEqual(before);
      await reopened.screenshot({ path: info.outputPath('reopened-data.png') });
    });
  });
}

test('独立浏览器进程关闭并重开后，本地训练和身体数据完整保留', async ({ browserName }, info) => {
  const profile = info.outputPath('persistent-profile'); await mkdir(profile, { recursive: true });
  const baseURL = info.project.use.baseURL!;
  const options = { baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' };
  const launch = () => browserName === 'webkit'
    ? webkit.launchPersistentContext(profile, { ...options, ignoreDefaultArgs: ['--disable-accelerated-compositing'] })
    : chromium.launchPersistentContext(profile, { ...options, channel: 'msedge' });
  let context = await launch();
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await install(page, fixture('dark'));
    await page.getByRole('button', { name: '开始今天的训练', exact: true }).tap();
    await page.getByRole('button', { name: '确认开始训练', exact: true }).tap();
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('80');
    await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('8');
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).tap();
    await page.getByRole('button', { name: '提前回顾', exact: true }).tap();
    await page.getByRole('button', { name: '保存训练', exact: true }).tap();
    await expect(page.getByRole('heading', { name: '训练档案', exact: true })).toBeVisible();
    const before = await storedWorkspace(page);
    expect(before.sessions.filter(session => session.status === 'completed')).toHaveLength(21);
    await context.close(); context = await launch();
    const reopened = context.pages()[0] ?? await context.newPage();
    await reopened.goto('/#/progress');
    await expect(reopened.getByRole('heading', { name: '训练档案', exact: true })).toBeVisible();
    expect(await storedWorkspace(reopened)).toEqual(before);
    await reopened.screenshot({ path: info.outputPath('process-reopened.png') });
  } finally { await context.close(); }
});

test.describe('手机横屏安全区', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  test('正文、导航和弹窗避开左右安全区', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-left', '44px');
      document.documentElement.style.setProperty('--safe-right', '20px');
    });
    expect((await page.getByRole('heading', { name: '今天的训练', exact: true }).boundingBox())!.x).toBeGreaterThanOrEqual(44);
    const nav = page.getByRole('navigation', { name: '移动端导航', exact: true });
    expect((await nav.getByRole('button').first().boundingBox())!.x).toBeGreaterThanOrEqual(44);
    await nav.getByRole('button', { name: '我', exact: true }).tap();
    await page.getByRole('button', { name: '记录身体数据', exact: true }).tap();
    const modal = (await page.getByRole('dialog').boundingBox())!;
    expect(modal.x).toBeGreaterThanOrEqual(44);
    expect(modal.x + modal.width).toBeLessThanOrEqual(824);
  });
});
