import { expect, test, type Page } from '@playwright/test';
import { storedWorkspace } from './helpers';

async function openGuide(page: Page, name = '死虫式') {
  await page.goto('/#/exercises');
  await page.getByLabel('搜索动作', { exact: true }).fill(name);
  await page.getByRole('button', { name: `查看${name}讲解`, exact: true }).click();
  await expect(page.getByAltText(`${name}第1幅动作图解`)).toHaveJSProperty('naturalWidth', 512);
}
const frame = (page: Page, n: number) => page.getByRole('button', { name: `查看第${n}幅图解`, exact: true });
async function freezeClock(page: Page) {
  await page.clock.install({ time: new Date('2026-10-19T06:00:00.000Z') });
  await page.clock.pauseAt(new Date('2026-10-19T06:00:01.000Z'));
}
async function observeSlowDecode(page: Page) {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (this.src.includes('/dead-bug/frame-2.svg')) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            document.documentElement.dataset.frame2Decode = 'settled';
          }),
        );
      }
    };
  });
}

test('播放速度、单次播放和暂停保持当前帧，操作不写入训练数据', async ({ page }) => {
  await openGuide(page);
  const before = await storedWorkspace(page);
  await freezeClock(page);
  await page.getByLabel('图解播放速度', { exact: true }).selectOption('0.5');
  await page.getByLabel('循环播放图解', { exact: true }).uncheck();
  await page.getByRole('button', { name: '播放分步图解', exact: true }).click();
  await page.clock.runFor(2199);
  await expect(frame(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(1);
  await expect(frame(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(2200);
  await expect(frame(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '播放分步图解', exact: true })).toBeVisible();
  await page.clock.runFor(5000);
  await expect(frame(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '播放分步图解', exact: true }).click();
  await expect(frame(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('图解播放速度', { exact: true }).selectOption('1.5');
  await page.clock.runFor(734);
  await expect(frame(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '暂停图解播放', exact: true }).click();
  await page.clock.runFor(5000);
  await expect(frame(page, 2)).toHaveAttribute('aria-pressed', 'true');
  expect(await storedWorkspace(page)).toEqual(before);
});

test('循环播放从第三帧回到第一帧，切换讲解视图停止播放', async ({ page }) => {
  await openGuide(page);
  await freezeClock(page);
  await expect(page.getByLabel('循环播放图解', { exact: true })).toBeChecked();
  await frame(page, 3).click();
  await page.getByRole('button', { name: '播放分步图解', exact: true }).click();
  await page.clock.runFor(1100);
  await expect(frame(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放分步图解', exact: true })).toBeVisible();
  await page.clock.runFor(4000);
  await expect(frame(page, 1)).toHaveAttribute('aria-pressed', 'true');
});

test('同一详情往返我的表现，保留手动帧、速度和循环设置且停止播放', async ({ page }) => {
  await openGuide(page);
  await frame(page, 3).click();
  await expect(frame(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('图解播放速度', { exact: true }).selectOption('0.5');
  await page.getByLabel('循环播放图解', { exact: true }).uncheck();
  await page.getByRole('tab', { name: '我的表现', exact: true }).click();
  await page.getByRole('tab', { name: '简洁讲解', exact: true }).click();
  await expect(frame(page, 3)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('图解播放速度', { exact: true })).toHaveValue('0.5');
  await expect(page.getByLabel('循环播放图解', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: '播放分步图解', exact: true })).toBeVisible();
});

test('减少动态默认暂停、仍可手动切帧，运行时切换偏好会暂停', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openGuide(page);
  await freezeClock(page);
  await page.clock.runFor(5000);
  await expect(frame(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await frame(page, 2).click();
  await expect(frame(page, 2)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.technique-art > img')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '播放分步图解', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: '播放分步图解', exact: true })).toBeVisible();
});

test.describe('慢加载请求隔离', () => {
  test.use({ serviceWorkers: 'block' });
  test('未完成的预加载不替换已显示图解，过期请求不会覆盖新帧', async ({ page }) => {
    await observeSlowDecode(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/dead-bug/frame-2.svg*', async (route) => {
      await gate;
      await route.continue().catch(() => undefined);
    });
    try {
      await openGuide(page);
      await frame(page, 2).click();
      await expect(page.getByAltText('死虫式第1幅动作图解')).toHaveJSProperty('naturalWidth', 512);
      await frame(page, 3).click();
      await expect(page.getByAltText('死虫式第3幅动作图解')).toHaveJSProperty('naturalWidth', 512);
      release();
      await expect(page.locator('html')).toHaveAttribute('data-frame2-decode', 'settled');
      await expect(frame(page, 3)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByAltText('死虫式第3幅动作图解')).toBeVisible();
    } finally {
      release();
    }
  });

  test('失败重试等待缓存删除时，后来的切帧不会被旧重试覆盖', async ({ page }) => {
    let failing = true;
    await page.route('**/dead-bug/frame-2.svg*', (route) => (failing ? route.abort() : route.continue()));
    await openGuide(page);
    await frame(page, 2).click();
    await expect(page.getByText('这张图解暂不可用', { exact: true })).toBeVisible();
    failing = false;
    await page.evaluate(() => {
      const open = caches.open.bind(caches);
      caches.open = async (name) => {
        const cache = await open(name);
        const remove = cache.delete.bind(cache);
        cache.delete = async (...args) => {
          document.documentElement.dataset.cacheDelete = 'waiting';
          await new Promise<void>((resolve) =>
            document.addEventListener('stage8-cache-release', () => resolve(), { once: true }),
          );
          return remove(...args);
        };
        return cache;
      };
    });
    try {
      await page.getByRole('button', { name: '重新加载图解', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-cache-delete', 'waiting');
      await frame(page, 3).click();
      await expect(page.getByAltText('死虫式第3幅动作图解')).toHaveJSProperty('naturalWidth', 512);
      await page.evaluate(() => document.dispatchEvent(new Event('stage8-cache-release')));
      await expect(page.getByRole('region', { name: '分步图解', exact: true })).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByRole('button', { name: '播放分步图解', exact: true })).toBeEnabled();
      await expect(frame(page, 3)).toHaveAttribute('aria-pressed', 'true');
      // Allow decoded stale requests to settle before the final, unchanged-frame assertion.
      await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
      await expect(page.getByAltText('死虫式第3幅动作图解')).toHaveJSProperty('naturalWidth', 512);
    } finally {
      await page.evaluate(() => document.dispatchEvent(new Event('stage8-cache-release')));
    }
  });
});

for (const width of [320, 390, 768, 1440])
  for (const theme of ['dark', 'light']) {
    test(`${width}px ${theme} 播放控件可操作、补充提示和来源可阅读`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/#/settings');
      await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
      await openGuide(page);
      const controls = page.locator('.art-playback-options');
      await controls.scrollIntoViewIfNeeded();
      for (const input of [page.getByLabel('图解播放速度', { exact: true }), page.locator('.art-loop-control')]) {
        const box = await input.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      }
      await page.getByRole('tab', { name: '详细讲解', exact: true }).click();
      await page.getByText('补充练习提示', { exact: true }).click();
      await expect(page.locator('.supplement-guidance')).toContainText('对侧手臂和腿');
      await page.getByText('图解来源与内容说明', { exact: true }).click();
      await expect(page.locator('.content-credit')).toContainText('Hasan Emir Yıldırım');
      await expect(page.locator('.content-credit')).toContainText('MIT');
      await page.getByText('第三方文字许可全文', { exact: true }).click();
      await expect(page.locator('.text-license')).toContainText('Permission is hereby granted');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  }
