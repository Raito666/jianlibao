import { expect, test } from '@playwright/test';
import { benchReference } from '../../src/content/reference-media';
import { storedWorkspace } from './helpers';

for (const theme of ['dark', 'light']) {
  test(`resizing during page entry retains native lifecycle and real DOM feedback ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 980 });
    await page.addInitScript(() => {
      const state = { native: 0, ready: 0, finished: 0, entries: 0, timings: [] as number[] };
      Object.assign(window, { pageEntryEvidence: state });
      const native = document.startViewTransition.bind(document);
      document.startViewTransition = callback => {
        state.native++;
        const transition = native(callback);
        void transition.ready.then(() => { state.ready++; });
        void transition.finished.then(() => { state.finished++; });
        return transition;
      };
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.matches('[data-motion-part="title"]')) {
          state.entries++;
          state.timings.push(Number(animation.effect!.getComputedTiming().duration));
        }
        return animation;
      };
    });
    await page.goto('/#/settings');
    await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
    const before = await storedWorkspace(page);
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '进步', exact: true }).click();
    await expect(page.getByRole('heading', { name: '训练档案', exact: true })).toBeVisible();
    // Keep this immediate; waiting for the transition would conceal the bug.
    await page.setViewportSize({ width: 760, height: 980 });
    await expect.poll(() => page.evaluate(() => (window as unknown as {pageEntryEvidence: {finished: number}}).pageEntryEvidence.finished)).toBe(1);
    const result = await page.evaluate(() => ({
      state: (window as unknown as {pageEntryEvidence: {native: number; ready: number; finished: number; entries: number; timings: number[]}}).pageEntryEvidence,
      isWindowsWebKit: /^Win/.test(navigator.platform) && /AppleWebKit\//.test(navigator.userAgent) && !/(Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent),
    }));
    expect(result.state.native).toBe(1);
    expect(result.state.ready).toBe(1);
    if (result.isWindowsWebKit) {
      expect(result.state.entries).toBe(1);
      expect(result.state.timings).toEqual([200]);
    }
    expect((await storedWorkspace(page)).sessions).toEqual(before.sessions);
    expect((await storedWorkspace(page)).bodyMetrics).toEqual(before.bodyMetrics);
  });
}

for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light']) {
  test(`video avoids source upscaling and stays proportional at ${width}/${theme}`, async ({ page }, info) => {
    const movie = benchReference.assets.find(asset => asset.kind === 'video')!;
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/#/settings');
    await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
    await page.goto('/#/exercises');
    await page.getByLabel('搜索动作', { exact: true }).fill('杠铃卧推');
    await page.getByRole('button', { name: '查看杠铃卧推讲解', exact: true }).click();
    await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
    await page.getByText('图片与视频示范', { exact: false }).click();
    await page.getByRole('button', { name: '加载卧推视频 · 1.4 MB', exact: true }).click();
    const video = page.getByLabel('杠铃卧推实拍示范', { exact: true });
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(.15);
    const geometry = await video.evaluate((v: HTMLVideoElement) => {
      const r = v.getBoundingClientRect(), parent = v.closest('.reference-video')!.getBoundingClientRect();
      return { width: r.width, height: r.height, left: r.left, right: r.right, parentLeft: parent.left, parentRight: parent.right,
        controls: v.controls, widthAttribute: v.width, heightAttribute: v.height };
    });
    expect(geometry.width).toBeLessThanOrEqual(movie.width + 1);
    expect(geometry.left).toBeGreaterThanOrEqual(geometry.parentLeft - 1);
    expect(geometry.right).toBeLessThanOrEqual(geometry.parentRight + 1);
    expect(Math.abs(geometry.height - geometry.width * movie.height / movie.width)).toBeLessThanOrEqual(1);
    expect(geometry.controls).toBe(true);
    expect([geometry.widthAttribute, geometry.heightAttribute]).toEqual([movie.width, movie.height]);
    await video.evaluate((v: HTMLVideoElement) => v.pause());
    await video.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`video-${width}-${theme}.png`), animations: 'disabled' });
    await page.setViewportSize({ width: 1440, height: 844 });
    await expect.poll(() => video.evaluate(v => Math.round(v.getBoundingClientRect().width))).toBe(movie.width);
    await page.setViewportSize({ width: 320, height: 844 });
    const narrow = await video.evaluate(v => ({ right: v.getBoundingClientRect().right, width: v.getBoundingClientRect().width, height: v.getBoundingClientRect().height }));
    expect(narrow.right).toBeLessThanOrEqual(321);
    expect(Math.abs(narrow.height - narrow.width * movie.height / movie.width)).toBeLessThanOrEqual(1);
  });
}
