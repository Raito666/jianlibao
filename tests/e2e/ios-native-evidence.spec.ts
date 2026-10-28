import { expect, test } from '@playwright/test';
import { collectIosViewportDiagnostics } from '../../src/platform/ios-viewport-diagnostics';
import { benchReference } from '../../src/content/reference-media';
import { mediaCreditFindings } from './media-credit-helpers';

test('viewport diagnostics detect clipped labels despite unchanged navigation bounds and omit form contents', async ({ page }, testInfo) => {
  for (const width of [320, 390]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/#/settings');
    await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
    await page.locator('html').evaluate(root => {
      root.style.setProperty('--safe-top', '62px');
      root.style.setProperty('--safe-bottom', '34px');
    });
    await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
    await page.getByLabel('备注（可选）', { exact: true }).fill('PRIVATE-NOTE-NOT-IN-DIAGNOSTICS');
    const duringInput = await page.evaluate(collectIosViewportDiagnostics);
    expect(JSON.stringify(duringInput)).not.toContain('PRIVATE-NOTE');
    expect(JSON.stringify(duringInput)).not.toContain('备注');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    const before = await page.evaluate(collectIosViewportDiagnostics);
    expect(before.navigation?.controls).toHaveLength(5);
    expect(before.navigation?.controls.every(control => control.labelExposed)).toBe(true);
    // A compositor-style paint crop must not be mistaken for valid bounds.
    // This is a DOM characterization, not a claim to simulate UIKit rendering.
    await page.locator('.mobile-nav').evaluate(nav => { (nav as HTMLElement).style.clipPath = 'inset(0 0 68px 0)'; });
    const clipped = await page.evaluate(collectIosViewportDiagnostics);
    expect(clipped.navigation?.box).toEqual(before.navigation?.box);
    expect(clipped.navigation?.controls.map(control => control.box)).toEqual(before.navigation?.controls.map(control => control.box));
    expect(clipped.navigation?.controls.some(control => !control.labelExposed)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`diagnostic-clipped-${width}-${theme}.png`) });
    await page.locator('.mobile-nav').evaluate(nav => { (nav as HTMLElement).style.removeProperty('clip-path'); });
    expect((await page.evaluate(collectIosViewportDiagnostics)).navigation?.controls.every(control => control.labelExposed)).toBe(true);
  }
});

for (const width of [320, 390]) for (const theme of ['dark', 'light']) {
  test(`media credits keep exact author, license and source inside each media at ${width}/${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto('/#/settings');
    await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
    await page.goto('/#/exercises');
    await page.getByLabel('搜索动作', { exact: true }).fill('杠铃卧推');
    await page.getByRole('button', { name: '查看杠铃卧推讲解', exact: true }).click();
    await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
    await page.getByText('图片与视频示范', { exact: false }).click();
    const figures = page.locator('.reference-images figure');
    const images = benchReference.assets.filter(asset => asset.kind === 'image');
    await expect(figures).toHaveCount(2);
    for (const [index, asset] of images.entries()) {
      const figure = figures.nth(index);
      await figure.scrollIntoViewIfNeeded();
      await expect(figure.locator('img')).toHaveJSProperty('naturalWidth', 800);
      await expect.poll(() => mediaCreditFindings(figure, asset)).toEqual([]);
      const full = await figure.evaluate(node => {
        const rect = node.getBoundingClientRect(), body = node.closest('.modal-body')!.getBoundingClientRect();
        return rect.top >= body.top - 1 && rect.bottom <= body.bottom + 1;
      });
      expect(full).toBe(true);
    }
    const movie = benchReference.assets.find(asset => asset.kind === 'video')!;
    const region = page.getByRole('region', { name: '杠铃卧推视频示范', exact: true });
    await region.scrollIntoViewIfNeeded();
    await expect.poll(() => mediaCreditFindings(region, movie)).toEqual([]);
  });
}

test('credit evidence rejects hidden altered or displaced text and links even with a visible parent', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 852 });
  await page.goto('/#/exercises');
  await page.getByLabel('搜索动作', { exact: true }).fill('杠铃卧推');
  await page.getByRole('button', { name: '查看杠铃卧推讲解', exact: true }).click();
  await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
  await page.getByText('图片与视频示范', { exact: false }).click();
  const figure = page.locator('.reference-images figure').first();
  const asset = benchReference.assets.find(asset => asset.kind === 'image')!;
  await figure.scrollIntoViewIfNeeded();
  await expect.poll(() => mediaCreditFindings(figure, asset)).toEqual([]);
  const credit = figure.locator('.reference-credit > span').first();
  await credit.evaluate(node => { (node as HTMLElement).style.visibility = 'hidden'; });
  expect(await mediaCreditFindings(figure, asset)).toContain('credit:hidden');
  await credit.evaluate(node => { (node as HTMLElement).style.removeProperty('visibility'); node.textContent += ' WRONG'; });
  expect(await mediaCreditFindings(figure, asset)).toContain('credit:text');
  await credit.evaluate((node, value) => { node.textContent = value; }, `${asset.author} · ${asset.license}`);
  const source = figure.getByRole('link', { name: '原始素材', exact: true });
  await source.evaluate(node => { (node as HTMLElement).style.transform = 'translateY(1000px)'; });
  expect(await mediaCreditFindings(figure, asset)).toContain('source:clipped');
  await source.evaluate(node => { (node as HTMLElement).style.removeProperty('transform'); });
  await expect.poll(() => mediaCreditFindings(figure, asset)).toEqual([]);
  const region = page.getByRole('region', { name: '杠铃卧推视频示范', exact: true });
  const movie = benchReference.assets.find(asset => asset.kind === 'video')!;
  await region.scrollIntoViewIfNeeded();
  await region.locator('.reference-credit > span').first().evaluate(node => { (node as HTMLElement).style.opacity = '0'; });
  expect(await mediaCreditFindings(region, movie)).toContain('credit:hidden');
});
