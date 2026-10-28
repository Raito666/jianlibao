import { expect, test } from '@playwright/test';
import { storedWorkspace } from './helpers';

async function settings(page: import('@playwright/test').Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: '应用与离线', exact: true })).toBeVisible();
}
test('真实离线资源SHA检查、缓存丢失提示和联网修复不改训练数据', async ({ page }) => {
  await settings(page); const card = page.locator('.pwa-readiness');
  await expect(card.getByText('离线启动已就绪', { exact: true })).toBeVisible({ timeout: 15000 });
  const before = await storedWorkspace(page);
  await page.evaluate(async () => {
    const names = (await caches.keys()).filter(n => /^jianlibao-[a-f0-9]{16}$/.test(n));
    if (names.length !== 1) throw Error('Expected current shell cache');
    const cache = await caches.open(names[0]), file = (await cache.keys()).find(r => r.url.endsWith('.css'));
    if (!file) throw Error('Missing shell CSS'); await cache.delete(file);
  });
  await card.getByRole('button', { name: '检查离线状态', exact: true }).click();
  await expect(card.getByText('离线页面尚未完整', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: '准备离线页面', exact: true }).click();
  await expect(card.getByText('离线启动已就绪', { exact: true })).toBeVisible({ timeout: 15000 });
  expect(await storedWorkspace(page)).toEqual(before);
});
test('持久存储授权拒绝不抛出页面错误，可重试并保留本地数据', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await settings(page); const before = await storedWorkspace(page), card = page.locator('.pwa-readiness');
  // Instance-only overrides were not retained in the WebKit application run.
  // Override the canonical prototype and assert actual calls as well as the UI.
  await page.evaluate(() => {
    let calls = 0;
    Object.defineProperty(window, '__jlbPersistCalls', { configurable: true, get: () => calls });
    Object.defineProperty(Object.getPrototypeOf(navigator.storage), 'persist', { configurable: true, value: async () => { calls++; if (calls === 1) throw Error('Synthetic blocked permission'); return false; } });
  });
  expect(await page.evaluate(() => Reflect.get(window, '__jlbPersistCalls'))).toBe(0);
  await card.getByRole('button', { name: '申请持久存储', exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, '__jlbPersistCalls'))).toBe(1);
  await expect(card.getByRole('status')).toContainText('存储保护申请未完成');
  await card.getByRole('button', { name: '申请持久存储', exact: true }).click();
  await expect(card.getByRole('status')).toContainText('浏览器暂未批准');
  expect(await storedWorkspace(page)).toEqual(before); expect(errors).toEqual([]);
});
test('离线管理入口直接展开原有图解下载面板，手机保存状态可见', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await settings(page);
  await expect(page.locator('.save-compact')).toHaveText('已保存'); await expect(page.locator('.save-compact')).toBeVisible();
  await page.getByRole('link', { name: '管理离线图解', exact: true }).click();
  await expect(page).toHaveURL(/#\/exercises\?offline=1$/);
  await expect(page.locator('.offline-library')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: /保存全部图解供离线使用|正在保存|全部图解已就绪/ })).toBeVisible();
});
test('离线时检查更新不会承诺联网成功或影响已保存数据', async ({ page, context }) => {
  await settings(page); await expect(page.locator('.pwa-readiness')).toContainText('离线启动已就绪', { timeout: 15000 }); const before = await storedWorkspace(page);
  await context.setOffline(true); await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(page.locator('.pwa-readiness')).toContainText('当前离线'); expect(await storedWorkspace(page)).toEqual(before);
});
test('注册失败有明确恢复入口，恢复后可准备离线页面', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.serviceWorker.register.bind(navigator.serviceWorker); let fail = true;
    navigator.serviceWorker.register = (...args) => { if (fail) { fail = false; return Promise.reject(Error('Synthetic SW blocked')); } return original(...args); };
  });
  await settings(page); await expect(page.locator('.pwa-readiness')).toContainText('离线准备未完成');
  await page.getByRole('button', { name: '准备离线页面', exact: true }).click();
  await expect(page.locator('.pwa-readiness')).toContainText('离线启动已就绪', { timeout: 15000 });
});

test('注册被移除后不误报离线就绪，可重新准备且保留记录', async ({ page }) => {
  await settings(page); const card = page.locator('.pwa-readiness');
  await expect(card).toContainText('离线启动已就绪', { timeout: 15000 }); const before = await storedWorkspace(page);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.unregister())).toBe(true);
  await expect.poll(() => page.evaluate(async () => !!await navigator.serviceWorker.getRegistration())).toBe(false);
  await card.getByRole('button', { name: '检查离线状态', exact: true }).click();
  await expect(card).toContainText('离线状态尚未确认');
  await card.getByRole('button', { name: '准备离线页面', exact: true }).click();
  await expect(card).toContainText('离线启动已就绪', { timeout: 15000 });
  expect(await page.evaluate(async () => !!await navigator.serviceWorker.getRegistration())).toBe(true);
  expect(await storedWorkspace(page)).toEqual(before);
});
for (const width of [320,390,768,1440]) for (const theme of ['dark','light']) test(`成熟PWA状态与触控 ${width} ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width,height:980 }); await settings(page); await page.getByLabel('界面主题', { exact:true }).selectOption(theme);
  const card = page.locator('.pwa-readiness'); await expect(card).toContainText('离线启动已就绪', { timeout:15000 }); await card.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  const bounds=(await card.boundingBox())!;
  for (const button of await card.getByRole('button').all()) { const b=(await button.boundingBox())!; expect(b.height).toBeGreaterThanOrEqual(44); expect(b.x+b.width).toBeLessThanOrEqual(bounds.x+bounds.width+1); }
  await card.screenshot({path:info.outputPath(`pwa-readiness-${width}-${theme}.png`)});
  await page.evaluate(() => window.scrollTo(0,0));
  const header=page.locator('.topbar'); expect(await header.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  if(width<=760) await expect(page.locator('.save-compact')).toBeVisible();
  await page.screenshot({path:info.outputPath(`pwa-header-${width}-${theme}.png`)});
});
