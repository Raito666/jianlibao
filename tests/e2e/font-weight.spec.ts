import { expect, test, type Locator } from '@playwright/test';

async function weight(locator: Locator, expected: number) {
  await expect(locator.first()).toHaveCSS('font-weight', String(expected));
}

for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light']) {
  test(`A3字重语义和训练回归 ${width} ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 980 });
    await page.clock.setFixedTime(new Date('2026-10-16T06:00:00Z'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
    if (theme === 'light') await page.getByRole('button', { name: '切换主题', exact: true }).click();
    expect(await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ['regular', 'semibold', 'bold', 'medium'].map(name => style.getPropertyValue(`--weight-${name}`).trim());
    })).toEqual(['400', '600', '700', '']);
    await weight(page.locator('body'), 400);
    await weight(page.locator('main h1'), 700);
    await weight(page.locator('.hero h2'), 700);
    await weight(page.locator('.section-heading h2'), 700);
    await weight(page.locator('.stats .stat-value'), 700);
    await weight(page.locator('.stats .stat-value small'), 400);
    await weight(page.locator('.exercise-row strong'), 600);
    const nav = page.getByRole('navigation', { name: width < 768 ? '移动端导航' : '主导航', exact: true });
    await nav.getByRole('button', { name: '计划', exact: true }).click();
    await weight(page.locator('.template-card h2'), 600);
    await nav.getByRole('button', { name: '动作', exact: true }).click();
    await weight(page.locator('.main[data-page="exercises"] .topbar h1'), 700);
    await weight(page.locator('.movement-info h3'), 600);
    await nav.getByRole('button', { name: '进步', exact: true }).click();
    await weight(page.locator('.main[data-page="progress"] .topbar h1'), 700);
    await weight(page.locator('.progress-tabbar .segmented button'), 600);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole('button', { name: '统计总览', exact: true }).click();
    await weight(page.locator('.analytics-metric > strong'), 700);
    await weight(page.locator('.analytics-metric > strong > small'), 400);
    await weight(page.locator('.analytics-trend .section-heading h3'), 600);
    expect(await page.evaluate(() => [...document.querySelectorAll('main *')].filter(el => el.getClientRects().length).every(el => ['400', '600', '700'].includes(getComputedStyle(el).fontWeight)))).toBe(true);
    await nav.getByRole('button', { name: '今天', exact: true }).click();
    await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
    await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
    await weight(page.locator('.exercise-heading h2'), 700);
    await weight(page.getByLabel('杠铃深蹲第1组总重量', { exact: true }), 600);
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('67.5');
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await weight(page.locator('.rest-time'), 700);
    await expect(page.locator('.save-indicator')).toContainText('已保存到本机');
    await page.getByRole('button', { name: '提前回顾', exact: true }).click();
    await weight(page.locator('.summary-grid .stat-value'), 600);
    await weight(page.locator('.summary-grid .stat-value small'), 400);
    await page.getByRole('button', { name: '保存训练', exact: true }).click();
    await expect(page.getByRole('button', { name: '统计总览', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '统计总览', exact: true }).click();
    await weight(page.locator('.chart-readout strong'), 600);
  });
}
