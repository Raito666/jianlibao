import { expect, test } from '@playwright/test';
import { expectPersisted, storedWorkspace } from './helpers';

for (const width of [320, 390, 768, 1440]) {
  for (const theme of ['dark', 'light']) {
    test(`${width}px ${theme} 热图日期触控目标与历史跳转`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.clock.setFixedTime(new Date('2026-10-16T06:00:00Z'));
      await page.goto('/#/progress');
      await expect(page.getByRole('button', { name: '统计总览', exact: true })).toBeEnabled();
      if (theme === 'light') await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.getByRole('button', { name: '统计总览', exact: true }).click();
      const today = page.getByRole('button', { name: '2026-10-16，0场训练', exact: true });
      await today.scrollIntoViewIfNeeded();
      const cells = await page.locator('.heat-cell').evaluateAll(elements => elements.map(element => {
        const { width, height } = element.getBoundingClientRect();
        return { width, height };
      }));
      expect(cells).toHaveLength(84);
      expect(cells.every(cell => cell.width >= 44 && cell.height >= 44)).toBe(true);
      const borderContrast = await page.locator('.heat-cell:not(:disabled)').first().evaluate(element => {
        const foreground = getComputedStyle(element).borderTopColor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const background = getComputedStyle(element.closest('.card')!).backgroundColor.match(/[\d.]+/g)!.slice(0, 3).map(Number);
        const luminance = (rgb: number[]) => rgb.map(channel => {
          const value = channel / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const a = luminance(foreground), b = luminance(background);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });
      expect(borderContrast).toBeGreaterThanOrEqual(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await expect(page.locator('.save-indicator')).toContainText('已保存到本机');
      const before = await storedWorkspace(page);
      await page.screenshot({ path: info.outputPath(`heatmap/${width}-${theme}.png`) });
      await today.click();
      await expect(page.getByRole('heading', { name: '2026-10-16', exact: true })).toBeVisible();
      expect(await storedWorkspace(page)).toEqual(before);
    });
  }
}

for (const theme of ['dark', 'light']) {
  test(`${theme} 热图有记录日期保留可辨场数和颜色对比`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date('2026-10-16T06:00:00Z'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
    if (theme === 'light') await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
    await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await page.getByRole('button', { name: '提前回顾', exact: true }).click();
    await page.getByRole('button', { name: '保存训练', exact: true }).click();
    await expectPersisted(page, data => data.sessions.filter(session => session.status === 'completed').length === 1);
    await page.getByRole('button', { name: '统计总览', exact: true }).click();
    const filled = page.getByRole('button', { name: '2026-10-16，1场训练', exact: true });
    await filled.scrollIntoViewIfNeeded();
    await expect(filled).toHaveText('1');
    const colors = await filled.evaluate(element => ({
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
      empty: getComputedStyle(document.querySelector('.heat-cell.level-0:not(:disabled)')!).backgroundColor,
    }));
    const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.empty, colors.background)).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: info.outputPath(`heatmap/390-${theme}-filled.png`) });
  });

  test(`${theme} 详细讲解署名链接有独立触控目标`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/exercises');
    await expect(page.getByRole('heading', { name: '动作图书馆', exact: true })).toBeVisible();
    if (theme === 'light') await page.getByRole('button', { name: '切换主题', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const before = await storedWorkspace(page);
    await page.getByLabel('搜索动作', { exact: true }).fill('杠铃深蹲');
    await page.getByRole('button', { name: '查看杠铃深蹲讲解', exact: true }).click();
    await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
    await page.getByText('图解来源与内容说明', { exact: true }).click();
    const links = page.locator('.content-credit a');
    await expect(links).toHaveCount(4);
    const targets = await links.evaluateAll(elements => elements.map(element => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    }));
    expect(targets.every(target => target.width >= 44 && target.height >= 44)).toBe(true);
    for (const link of await links.all()) {
      await link.focus();
      await expect(link).toBeFocused();
    }
    expect(await page.locator('.modal-body').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(false);
    expect(await storedWorkspace(page)).toEqual(before);
    await page.screenshot({ path: info.outputPath(`credit/390-${theme}.png`) });
  });
}
