import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

// This fixture deliberately has no application code, storage, mocks of native
// transition methods, or added delay before resizing/continuing navigation.
for (const theme of ['dark', 'light']) {
  for (const scenario of ['resize', 'rapid']) {
    test(`native capture remains live through ${scenario} (${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('crash', () => errors.push('page crashed'));
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width: 768, height: 980 });
      const fixture = await readFile('tests/fixtures/webkit-native-transition.html');
      await page.route('**/native-transition-fixture', route => route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: fixture,
      }));
      await page.goto('/native-transition-fixture');
      await page.locator('html').evaluate((html, value) => html.dataset.theme = value, theme);
      const destinations = scenario === 'resize'
        ? [['历史', 'history']]
        : [['计划', 'plans'], ['动作', 'library'], ['历史', 'history']];
      for (const [button, title] of destinations) {
        await page.getByRole('button', { name: button, exact: true }).click();
        await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        if (scenario === 'resize') await page.setViewportSize({ width: 760, height: 980 });
      }
      await expect.poll(() => page.evaluate(() => (window as unknown as {
        evidence: { started: number; updated: number; ready: number; finished: number; errors: string[] };
      }).evidence)).toEqual({
        started: destinations.length, updated: destinations.length,
        ready: destinations.length, finished: destinations.length, errors: [],
      });
      await expect(page.locator('.day')).toHaveCount(31);
      const size = await page.locator('.calendar').evaluate(calendar => ({
        content: calendar.scrollWidth, available: calendar.clientWidth,
        viewport: innerWidth, document: document.documentElement.scrollWidth,
      }));
      expect(size.content).toBeLessThanOrEqual(size.available + 1);
      expect(size.document).toBeLessThanOrEqual(size.viewport + 1);
      expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
