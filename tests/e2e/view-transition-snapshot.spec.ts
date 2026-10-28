import { expect, test } from '@playwright/test';
import { storedWorkspace } from './helpers';

test('原生转场后页面可绘制、导航可继续且不改训练数据', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => errors.push('page crashed'));
  await page.addInitScript(() => {
    const start = document.startViewTransition.bind(document);
    let sequence = 0;
    document.startViewTransition = callback => {
      const id = ++sequence;
      const transition = start(callback);
      document.documentElement.dataset.qaNativeStarted = String(id);
      void transition.ready.then(() => {
        document.documentElement.dataset.qaNativeReady = String(id);
      }).catch(() => { document.documentElement.dataset.qaNativeReady = 'failed'; });
      void transition.finished.then(() => {
        document.documentElement.dataset.qaNativeFinished = String(id);
      }).catch(() => { document.documentElement.dataset.qaNativeFinished = 'failed'; });
      return transition;
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
  const before = await storedWorkspace(page);
  for (const [name, heading, route] of [
    ['进步', '训练档案', 'progress'],
    ['计划', '训练计划', 'plans'],
  ]) {
    const previous = Number(await page.locator('html').getAttribute('data-qa-native-started') ?? 0);
    await page.getByRole('navigation', { name: '移动端导航', exact: true })
      .getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/${route}$`));
    await expect.poll(async () => Number(await page.locator('html').getAttribute('data-qa-native-started')))
      .toBeGreaterThan(previous);
    const current = await page.locator('html').getAttribute('data-qa-native-started');
    if (current === null) throw new Error('Native transition was not started');
    await expect(page.locator('html')).toHaveAttribute('data-qa-native-ready', current);
    await expect(page.locator('html')).toHaveAttribute('data-qa-native-finished', current);
    const png = await page.screenshot({ path: info.outputPath(`native-${route}.png`), animations: 'disabled' });
    expect(png.length).toBeGreaterThan(1000);
  }
  expect(errors).toEqual([]);
  expect(await storedWorkspace(page)).toEqual(before);
});
