import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

async function actualFonts(page: Page, selector: string) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const { root } = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    return (await client.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  } finally {
    await client.detach();
  }
}

test('本机可变字体实际绘制中文，600与700不同且没有字体网络请求', async ({ page }, info) => {
  const fontRequests: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'font') fontRequests.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const weight of [600, 700]) {
      const sample = document.createElement('div');
      sample.id = `local-font-${weight}`;
      sample.textContent = '健力宝训练国 MW123 kg';
      sample.style.cssText = `position:fixed;inset:0 auto auto 0;width:1080px;height:120px;line-height:120px;font-family:var(--font-sans);font-size:64px;font-weight:${weight};font-synthesis:none;color:black;background:white;z-index:9999`;
      sample.hidden = true;
      document.body.append(sample);
    }
  });
  const headingFonts = await actualFonts(page, 'main h1');
  expect(headingFonts.some(font => font.familyName === 'Noto Sans SC')).toBe(true);
  expect(await page.evaluate(() => document.fonts.check('16px "Noto Sans SC"', '健力宝'))).toBe(true);
  const hashes: string[] = [];
  for (const weight of [600, 700]) {
    const sample = page.locator(`#local-font-${weight}`);
    await sample.evaluate(el => {
      if (!(el instanceof HTMLElement)) throw new Error('Expected an HTML font sample');
      el.hidden = false;
    });
    await page.evaluate(() => document.fonts.ready);
    const fonts = await actualFonts(page, `#local-font-${weight}`);
    expect(fonts.some(font => font.familyName === 'Noto Sans SC')).toBe(true);
    expect(await sample.evaluate(el => getComputedStyle(el).fontSynthesis)).toBe('none');
    const png = await sample.screenshot({ path: info.outputPath(`local-${weight}.png`) });
    hashes.push(createHash('sha256').update(png).digest('hex'));
    await sample.evaluate(el => {
      if (!(el instanceof HTMLElement)) throw new Error('Expected an HTML font sample');
      el.hidden = true;
    });
  }
  expect(hashes[0]).not.toBe(hashes[1]);
  expect(fontRequests).toEqual([]);
});

test('本地可变字体不可用时使用系统回退，训练记录与浏览器下载仍正常', async ({ page }) => {
  const fontRequests: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'font') fontRequests.push(request.url()); });
  // Fail only the local-face lookup in this isolated response; production files stay untouched.
  await page.route('**/assets/*.css', async route => {
    const response = await route.fetch();
    const original = await response.text();
    const unavailable = original.replace(/local\(["']?Noto Sans SC Thin["']?\)/g, 'local("JLB Missing Variable Font Test")');
    expect(unavailable).not.toBe(original);
    await route.fulfill({ response, body: unavailable });
  });
    await page.goto('/');
    await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
    const face = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].find(font => font.family.replaceAll('"', '') === 'Jianlibao Local Noto VF')?.status;
    });
    expect(face).toBe('error');
    expect((await actualFonts(page, 'main h1')).some(font => font.glyphCount > 0)).toBe(true);
    await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
    await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('67.5');
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await expect(page.locator('.save-indicator')).toContainText('已保存到本机');
    await page.reload();
    await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('67.5');
    await page.getByRole('button', { name: '返回今天', exact: true }).click();
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '我', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出备份', exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
    expect(fontRequests).toEqual([]);
});
