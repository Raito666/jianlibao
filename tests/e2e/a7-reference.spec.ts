import { expect, test, type Page } from '@playwright/test';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise } from '../../src/domain/training';
import type { AppData } from '../../src/domain/types';
import { validateAppData } from '../../src/data/backup';
import { storedWorkspace } from './helpers';

const equipment = ['A7杠铃', 'A7哑铃', 'A7自重'];
function fixture(theme: 'dark' | 'light') {
  const data = createInitialData();
  for (let i = 0; i < 30; i++) data.exercises.push({
    id: `a7-ex-${i}`, name: `A7分组动作${String(i + 1).padStart(2, '0')}`, muscle: '背部',
    equipment: equipment[i % 3], kind: 'weight-reps', description: '个人提示：保持动作稳定。',
  });
  const history = createSession(null, data.exercises, Date.parse('2026-10-16T06:00:00Z'));
  history.status = 'completed';
  history.finishedAt = '2026-10-16T06:10:00.000Z';
  history.updatedAt = history.finishedAt;
  history.exercises = [createSessionExercise(data.exercises.find(ex => ex.id === 'ex-squat')!, 1, 1000, 1000, 30)];
  history.exercises[0].sets[0].status = 'completed';
  data.sessions = [history]; data.onboarded = true; data.settings.theme = theme;
  validateAppData(data);
  return data;
}
async function install(page: Page, data: AppData) {
  await page.clock.setFixedTime(new Date('2026-10-17T06:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
  await page.evaluate(data => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('jianlibao', 1);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(data, 'main');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    }; request.onerror = () => reject(request.error);
  }), data);
  await page.reload();
}

for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light'] as const) {
  test(`A7器械分组、讲解入口与统计层级 ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 980 });
    const data = fixture(theme); await install(page, data);
    const nav = page.getByRole('navigation', { name: width <= 760 ? '移动端导航' : '主导航', exact: true });
    await nav.getByRole('button', { name: '动作', exact: true }).click();
    await page.getByLabel('搜索动作', { exact: true }).fill('A7分组');
    await expect(page.locator('.movement-card')).toHaveCount(24);
    await expect(page.locator('.equipment-group')).toHaveCount(3);
    for (const eq of equipment) {
      const group = page.getByRole('region', { name: `${eq}动作分组`, exact: true });
      await expect(group.getByRole('heading', { name: eq, exact: true })).toHaveCSS('font-size', '26px');
      await expect(group.locator('.movement-card')).toHaveCount(8);
      await expect(group.locator('.equipment-count')).toHaveText('已显示 8 / 10');
      for (const title of await group.locator('.movement-info > span > span:last-child').allTextContents()) expect(title).toBe(eq);
    }
    await page.getByRole('button', { name: '继续浏览 · 还有 6 个动作', exact: true }).click();
    await expect(page.locator('.movement-card')).toHaveCount(30);
    const names = await page.locator('.movement-card h3').allTextContents();
    expect(new Set(names).size).toBe(30);
    expect([...names].sort()).toEqual(data.exercises.filter(ex => ex.id.startsWith('a7-ex-')).map(ex => ex.name).sort());
    for (const group of await page.locator('.equipment-group').all()) await expect(group.locator('.movement-card')).toHaveCount(10);
    await page.getByLabel('器械筛选', { exact: true }).selectOption(equipment[1]);
    await expect(page.locator('.equipment-group')).toHaveCount(1);
    await expect(page.locator('.movement-card')).toHaveCount(10);
    const favorite = data.exercises.find(ex => ex.id === 'a7-ex-1')!;
    await page.getByRole('button', { name: `收藏${favorite.name}`, exact: true }).click();
    await page.getByRole('group', { name: '动作收藏筛选', exact: true }).getByRole('button', { name: '收藏', exact: true }).click();
    await expect(page.locator('.movement-card')).toHaveCount(1);
    await page.getByRole('button', { name: `查看${favorite.name}讲解`, exact: true }).click();
    await expect(page.locator('.custom-exercise-guide')).toContainText(favorite.description!);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await page.getByRole('button', { name: '重置筛选', exact: true }).click();
    await page.getByLabel('搜索动作', { exact: true }).fill('杠铃深蹲');
    const official = page.locator('.movement-card').filter({ has: page.getByRole('button', { name: '查看杠铃深蹲讲解', exact: true }) });
    await expect(official.locator('.movement-guide-badge')).toHaveText('讲解');
    const badgeContrast = await official.locator('.movement-guide-badge').evaluate(el => {
      const css = getComputedStyle(el);
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const foreground = luminance(css.color), background = luminance(css.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(badgeContrast).toBeGreaterThanOrEqual(4.5);
    await official.getByRole('button', { name: '查看杠铃深蹲讲解', exact: true }).click();
    await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
    await expect(page.locator('.technique-steps li p').first()).toBeVisible();
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('.equipment-heading').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${width}-${theme}-library.png`) });
    await nav.getByRole('button', { name: '进步', exact: true }).click();
    await page.getByRole('button', { name: '统计总览', exact: true }).click();
    const overview = page.getByRole('region', { name: '训练概况', exact: true });
    await expect(overview.getByRole('heading', { name: '训练概况', exact: true })).toHaveCSS('font-size', '26px');
    const volume = page.locator('.analytics-metric').filter({ has: page.getByText('正式组重量容量', { exact: true }) });
    await expect(volume.locator('.metric-number')).toHaveText('1,000,000');
    await expect(volume.locator('small')).toHaveText('kg·次');
    await expect(volume.locator('strong')).toHaveCSS('font-size', '40px');
    await expect(volume.locator('small')).toHaveCSS('font-size', '13px');
    await page.evaluate(() => document.fonts.ready);
    expect(await volume.locator('.metric-number').evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length; })).toBe(1);
    expect(await volume.locator('strong').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${width}-${theme}-statistics.png`) });
    const stored = await storedWorkspace(page);
    expect(stored.sessions).toEqual(data.sessions); expect(stored.exercises).toEqual(data.exercises);
  });
}
