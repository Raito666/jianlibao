import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { benchReference, REFERENCE_CACHE } from '../../src/content/reference-media';
import { MEDIA_CACHE } from '../../src/content/catalog';
import { storedWorkspace } from './helpers';
import { overflowFindings } from './overflow-helpers';
import { referenceNetwork } from './reference-network-fixture';
const movie = benchReference.assets.find(asset => asset.kind === 'video')!;
async function open(page: Page, origin = '') {
  await page.goto(`${origin}/#/exercises`);
  await page.getByLabel('搜索动作', { exact: true }).fill('杠铃卧推');
  await page.getByRole('button', { name: '查看杠铃卧推讲解', exact: true }).click();
  await expect(page.getByAltText('杠铃卧推第1幅动作图解', { exact: true })).toHaveJSProperty('naturalWidth', 512);
  await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
  await page.getByText('图片与视频示范', { exact: false }).click();
}
async function play(page: Page) {
  await page.getByRole('button', { name: '加载卧推视频 · 1.4 MB', exact: true }).click();
  const video = page.getByLabel('杠铃卧推实拍示范', { exact: true });
  await Promise.all([
    video.evaluate((v: HTMLVideoElement) => v.play()),
    (async () => {
      await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2);
    })(),
  ]); // Explicit playback shares the original readiness deadline.
  await video.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(.15);
  return video;
}

test('原SVG保留，卧推示范显式保存后离线重载、播放与寻址，训练数据完全不变', async ({ page, context }) => {
  test.setTimeout(60000);
  const external: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname === 'wger.de') external.push(request.url()); });
  await page.goto('/'); await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const before = await storedWorkspace(page);
  await open(page);
  await expect(page.getByLabel('杠铃卧推实拍示范', { exact: true })).toHaveCount(0);
  const svgBefore = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(r => r.url), MEDIA_CACHE);
  await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
  await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toBeVisible();
  const video = await play(page);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeCloseTo(20.781859, 1);
  expect(await video.evaluate((v: HTMLVideoElement) => ({ width: v.videoWidth, height: v.videoHeight, muted: v.muted, loop: v.loop }))).toEqual({ width: 640, height: 352, muted: true, loop: false });
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  const original = await readFile(`public${movie.url}`);
  await context.setOffline(true);
  await page.reload(); await open(page);
  await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toBeVisible();
  for (const [header, start, end] of [['bytes=0-63', 0, 63], ['bytes=-16', original.length - 16, original.length - 1]] as const) {
    const result = await page.evaluate(async ({ url, header }) => { const r = await fetch(url, { headers: { Range: header } }); return { status: r.status, range: r.headers.get('Content-Range'), bytes: Array.from(new Uint8Array(await r.arrayBuffer())) }; }, { url: movie.url, header });
    expect(result.status).toBe(206); expect(result.range).toBe(`bytes ${start}-${end}/${original.length}`);
    expect(result.bytes).toEqual([...original.subarray(start, end + 1)]);
  }
  expect(await page.evaluate(async url => (await fetch(url, { headers: { Range: 'bytes=99999999-' } })).status, movie.url)).toBe(416);
  const offlineVideo = await play(page);
  await offlineVideo.evaluate((v: HTMLVideoElement) => new Promise<void>(resolve => { v.addEventListener('seeked', () => resolve(), { once: true }); v.currentTime = 15; }));
  await expect.poll(() => offlineVideo.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(15);
  for (const asset of benchReference.assets.filter(a => a.kind === 'image')) await expect(page.getByAltText(`杠铃卧推${asset.label}参考图`)).toHaveJSProperty('naturalWidth', 800);
  const svgAfter = await page.evaluate(async name => (await (await caches.open(name)).keys()).map(r => r.url), MEDIA_CACHE);
  expect(svgBefore.every(url => svgAfter.includes(url))).toBe(true);
  expect(await storedWorkspace(page)).toEqual(before); expect(external).toEqual([]);
});

test('错误旧缓存不会显示就绪，可修复且不删除原SVG缓存', async ({ page }) => {
  await page.goto('/'); await page.evaluate(async ({ name, url }) => { await (await caches.open(name)).put(url, new Response('<html>old error</html>', { headers: { 'Content-Type': 'video/mp4' } })); }, { name: REFERENCE_CACHE, url: movie.url });
  await open(page);
  await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
  await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toBeVisible();
  expect(await page.evaluate(async ({ name, url }) => (await (await caches.open(name)).match(url))?.headers.get('content-type'), { name: REFERENCE_CACHE, url: movie.url })).toBe('video/mp4');
});

test.describe('无SW的实际网络失败恢复', () => {
  test.use({ serviceWorkers: 'block' });
  test('假200视频拒绝离线就绪，图像与视频失败均能重试，原SVG可继续查看', async ({ page, baseURL }) => {
    const network = await referenceNetwork(baseURL!);
    try {
      await open(page, network.origin);
      await expect(page.getByText('这张参考图暂不可用，仍可查看上方三帧图解。').first()).toBeVisible();
      await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
      await expect(page.locator('.reference-offline [role="alert"]')).toContainText('未完整保存');
      await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: '加载卧推视频 · 1.4 MB', exact: true }).click();
      await expect(page.getByText('视频暂不可用，仍可查看上方三帧图解和中文讲解。')).toBeVisible();
      expect(network.failures.some(response => response.path === movie.url && response.status === 200)).toBe(true);
      network.setFailure();
      const retries = page.getByRole('button', { name: '重新加载参考图', exact: true });
      await expect(retries).toHaveCount(2);
      await retries.first().click(); await retries.first().click();
      await expect(page.getByAltText('杠铃卧推推起位置参考图')).toHaveJSProperty('naturalWidth', 800);
      await page.getByRole('button', { name: '重新加载示范视频', exact: true }).click();
      await Promise.all([
        page.getByLabel('杠铃卧推实拍示范', { exact: true }).evaluate((v: HTMLVideoElement) => v.play()),
        (async () => {
          await expect.poll(() => page.getByLabel('杠铃卧推实拍示范', { exact: true }).evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
        })(),
      ]); // Explicit playback shares the original readiness deadline.
      await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
      await expect(page.getByRole('button', { name: '示范文件已校验，离线服务未就绪', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toHaveCount(0);
      await expect(page.getByAltText('杠铃卧推第1幅动作图解', { exact: true })).toHaveJSProperty('naturalWidth', 512);
    } finally { await network.close(); }
  });
  test('只有CacheStorage而没有离线服务时不得承诺离线播放', async ({ page }) => {
    await open(page); await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
    await expect(page.getByRole('button', { name: '示范文件已校验，离线服务未就绪', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toHaveCount(0);
    expect(await page.evaluate(async name => (await (await caches.open(name)).keys()).length, REFERENCE_CACHE)).toBe(3);
  });
  test('暂停保存不会把部分文件当完整，继续保存可完成', async ({ page }) => {
    let unblock!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    await page.route('**/exercise-media/**/*.mp4', async route => { await blocked; await route.continue().catch(() => {}); });
    await open(page); await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停保存示范', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '暂停保存示范', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存示范供离线使用', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toHaveCount(0);
    unblock(); await page.unroute('**/exercise-media/**/*.mp4');
    await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
    await expect(page.getByRole('button', { name: '示范文件已校验，离线服务未就绪', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toHaveCount(0);
  });
});

test('关闭示范区暂停视频，切换别的动作不借用卧推素材', async ({ page }) => {
  await open(page); const video = await play(page);
  await page.getByText('图片与视频示范', { exact: false }).click();
  await expect(video).toHaveCount(0);
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByLabel('搜索动作', { exact: true }).fill('死虫式'); await page.getByRole('button', { name: '查看死虫式讲解', exact: true }).click();
  await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
  await expect(page.getByText('图片与视频示范', { exact: false })).toHaveCount(0);
});

for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light']) {
  test(`${width}px ${theme} 卧推原图、实拍、署名和离线操作完整可用`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 }); await page.goto('/#/settings');
    await page.getByLabel('界面主题', { exact: true }).selectOption(theme); await open(page);
    for (const asset of benchReference.assets.filter(a => a.kind === 'image')) await expect(page.getByAltText(`杠铃卧推${asset.label}参考图`)).toHaveJSProperty('naturalWidth', 800);
    await expect(page.locator('.reference-media')).toContainText('Everkinetic · CC BY-SA 3.0');
    await expect(page.locator('.reference-media')).toContainText('Goulart · CC BY-SA 4.0');
    expect(await overflowFindings(page)).toEqual([]);
    await page.locator('.reference-images').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('bench-images.png'), animations: 'disabled' });
    const video = await play(page); await video.evaluate((v: HTMLVideoElement) => v.pause());
    await page.locator('.reference-video').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('bench-video.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
    const ready = page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true }); await expect(ready).toBeVisible();
    await ready.scrollIntoViewIfNeeded(); const box = await ready.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await overflowFindings(page)).toEqual([]); await page.screenshot({ path: info.outputPath('bench-offline-credits.png'), animations: 'disabled' });
  });
}
