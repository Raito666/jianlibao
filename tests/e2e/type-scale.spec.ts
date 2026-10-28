import { expect, test, type Locator } from '@playwright/test';

async function size(locator: Locator, expected: number) {
  await expect(locator.first()).toHaveCSS('font-size', `${expected}px`);
}

for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light']) {
  test(`A2字号语义与训练回归 ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 980 });
    await page.clock.setFixedTime(new Date('2026-10-16T06:00:00Z'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
    if (theme === 'light') await page.getByRole('button', { name: '切换主题', exact: true }).click();
    const tokens = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return ['xs', 'sm', 'base', 'md', 'lg', 'xl', 'display'].map(name => css.getPropertyValue(`--text-${name}`).trim());
    });
    expect(tokens).toEqual(['11px', '13px', '16px', '18px', '22px', '26px', '40px']);
    await size(page.locator('.hero h2'), 26);
    await size(page.locator('.section-heading h2'), 26);
    await size(page.locator('.stats .stat-value'), 40);
    await size(page.locator('.stats .stat-value small'), 13);
    await size(page.locator('.exercise-row strong'), 18);
    await expect(page.locator('.stats .stat-value').first()).toHaveCSS('font-weight', '700');
    const nav = page.getByRole('navigation', { name: width < 768 ? '移动端导航' : '主导航', exact: true });
    await nav.getByRole('button', { name: '计划', exact: true }).click();
    await size(page.locator('.template-card h2'), 18);
    await nav.getByRole('button', { name: '动作', exact: true }).click();
    await size(page.locator('.main[data-page="exercises"] .topbar h1'), 26);
    await size(page.locator('.movement-info h3'), 18);
    await size(page.getByLabel('搜索动作', { exact: true }), 16);
    await nav.getByRole('button', { name: '进步', exact: true }).click();
    await size(page.locator('.main[data-page="progress"] .topbar h1'), 26);
    await size(page.locator('.progress-tabbar .segmented button'), width <= 359 ? 18 : 22);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole('button', { name: '统计总览', exact: true }).click();
    await size(page.locator('.analytics-metric > strong'), 40);
    await size(page.locator('.analytics-metric > strong > small'), 13);
    await size(page.locator('.analytics-trend .section-heading h3'), 18);
    await expect(page.locator('.analytics-metric > strong').first()).toHaveCSS('font-weight', '700');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await nav.getByRole('button', { name: '今天', exact: true }).click();
    await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
    await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
    await size(page.locator('.exercise-heading h2'), 26);
    await size(page.getByLabel('杠铃深蹲第1组总重量', { exact: true }), 16);
    if (width <= 390) {
      const complete = (await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).boundingBox())!;
      const scroll = (await page.locator('.workout-view').boundingBox())!;
      expect(complete.y + complete.height).toBeLessThanOrEqual(scroll.y + scroll.height);
    }
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('67.5');
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await size(page.locator('.rest-time'), 40);
    await expect(page.locator('.save-indicator')).toContainText('已保存到本机');
    await page.getByRole('button', { name: '提前回顾', exact: true }).click();
    await size(page.locator('.summary-grid .stat-value'), 26);
    await size(page.locator('.summary-grid .stat-value small'), 13);
    await page.getByRole('button', { name: '保存训练', exact: true }).click();
    await expect(page.getByRole('button', { name: '统计总览', exact: true })).toBeVisible();
  });
}
