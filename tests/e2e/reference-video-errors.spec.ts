import { expect, test } from '@playwright/test';
import { benchReference } from '../../src/content/reference-media';
import { storedWorkspace } from './helpers';
import { overflowFindings } from './overflow-helpers';
import { referenceNetwork } from './reference-network-fixture';

test.use({ serviceWorkers: 'block' });
const movie = benchReference.assets.find(asset => asset.kind === 'video')!;
const failures = ['html', 'not-found', 'truncated'] as const;

// A missing onError, broken retry URL, or layout hiding the recovery action must fail.
for (const [index, width] of [320, 390, 768, 1440].entries()) {
  for (const theme of ['dark', 'light']) {
    const failure = failures[(index + (theme === 'light' ? 1 : 0)) % failures.length];
    test(`${width}px ${theme} ${failure} 视频损坏提示和重试完整可用`, async ({ page, baseURL }, info) => {
      const network = await referenceNetwork(baseURL!, [movie.url]);
      network.setFailure(failure);
      try {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`${network.origin}/#/settings`);
        await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
        await page.goto(`${network.origin}/#/exercises`);
        await page.getByLabel('搜索动作', { exact: true }).fill('杠铃卧推');
        await page.getByRole('button', { name: '查看杠铃卧推讲解', exact: true }).click();
        await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
        await page.getByText('图片与视频示范', { exact: false }).click();
        const before = await storedWorkspace(page);
        expect(network.failures.filter(response => response.path === movie.url)).toEqual([]);
        await page.getByRole('button', { name: '加载卧推视频 · 1.4 MB', exact: true }).click();
        const error = page.getByText('视频暂不可用，仍可查看上方三帧图解和中文讲解。');
        await expect(error).toBeVisible();
        expect(network.failures.some(response => response.path === movie.url && response.status === (failure === 'not-found' ? 404 : 200))).toBe(true);
        if (failure === 'truncated') expect(network.failures.find(response => response.path === movie.url)?.bytes).toBe(48);
        const retry = page.getByRole('button', { name: '重新加载示范视频', exact: true });
        await retry.scrollIntoViewIfNeeded();
        const box = await retry.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(await overflowFindings(page)).toEqual([]);
        await page.screenshot({ path: info.outputPath(`video-error-${width}-${theme}.png`), animations: 'disabled' });
        const requestsBeforeSave = network.failures.length;
        await page.getByRole('button', { name: '保存示范供离线使用', exact: true }).click();
        await expect(page.locator('.reference-offline [role="alert"]')).toContainText('未完整保存');
        expect(network.failures.length).toBeGreaterThan(requestsBeforeSave);
        await expect(page.getByRole('button', { name: '示范已完整保存，可离线查看', exact: true })).toHaveCount(0);
        network.setFailure();
        await retry.click();
        const video = page.getByLabel('杠铃卧推实拍示范', { exact: true });
        await Promise.all([
          video.evaluate((v: HTMLVideoElement) => v.play()),
          expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2),
        ]);
        await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.15);
        await expect(video).toHaveJSProperty('currentSrc', `${network.origin}${movie.url}?attempt=1`);
        await expect(error).toHaveCount(0);
        await expect(page.getByAltText('杠铃卧推第1幅动作图解', { exact: true })).toHaveJSProperty('naturalWidth', 512);
        await video.evaluate((v: HTMLVideoElement) => v.pause());
        await video.scrollIntoViewIfNeeded();
        expect(await overflowFindings(page)).toEqual([]);
        await page.screenshot({ path: info.outputPath(`video-retry-${width}-${theme}.png`), animations: 'disabled' });
        expect(await storedWorkspace(page)).toEqual(before);
        await page.reload();
        await expect(page.getByLabel('搜索动作', { exact: true })).toBeVisible();
        expect(await storedWorkspace(page)).toEqual(before);
        await info.attach('actual-http-faults', { body: JSON.stringify(network.failures, null, 2), contentType: 'application/json' });
      } finally { await network.close(); }
    });
  }
}
