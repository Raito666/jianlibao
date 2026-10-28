import { chromium, webkit, expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise } from '../../src/domain/training';
import { storedWorkspace } from './helpers';
import { validateAppData } from '../../src/data/backup';

async function ready(page: Page) {
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
}
async function offlineReady(page: Page) {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  try {
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  } catch (error) {
    // Observe only after failure: no extra wait or navigation can mask the race.
    try {
      const state = await page.evaluate(async () => ({
        origin: location.origin, document: document.readyState, online: navigator.onLine,
        controller: navigator.serviceWorker.controller?.scriptURL ?? null,
        registrations: (await navigator.serviceWorker.getRegistrations()).map(r => ({
          scope: r.scope, active: r.active?.state, installing: r.installing?.state, waiting: r.waiting?.state,
        })),
        caches: await caches.keys(),
      }));
      await test.info().attach('offline-worker-failure', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
    } catch { /* Diagnostic failure must not replace the original assertion. */ }
    throw error;
  }
}
async function settings(page: Page) {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: '安装到手机', exact: true })).toBeVisible();
}
const apple = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36';

for (const [platform, userAgent] of [['iPhone', apple], ['安卓', android]] as const) {
  test.describe(`PWA ${platform}安装引导`, () => {
    test.use({ viewport: { width: 390, height: 844 }, userAgent, hasTouch: true, isMobile: true });
    test('提供正确手动安装步骤，未提供虚假IPA下载', async ({ page }) => {
      await settings(page);
      const guide = page.locator('.install-app');
      await expect(guide.getByRole('button', { name: platform === 'iPhone' ? 'iPhone / iPad' : '安卓手机', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(guide.locator('.install-steps')).toContainText(platform === 'iPhone' ? 'Safari' : 'Chrome');
      await expect(guide).toContainText('存储可能独立');
      await expect(guide).toContainText('不要清除原站点数据');
      await expect(guide.locator('a[href$=".ipa"]')).toHaveCount(0);
      const other = guide.getByRole('button', { name: platform === 'iPhone' ? '安卓手机' : 'iPhone / iPad', exact: true });
      await other.tap(); await expect(other).toHaveAttribute('aria-pressed', 'true');
      await expect(guide.locator('.install-steps')).toContainText(platform === 'iPhone' ? 'Chrome' : 'Safari');
      await expect(guide.getByRole('button', { name: '安装健力宝', exact: true })).toHaveCount(0);
    });
  });
}

async function fakePrompt(page: Page, outcome: 'accepted' | 'dismissed', fail = false) {
  await page.evaluate(({ outcome, fail }) => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(window, { pwaPromptCalls: 0 });
    Object.assign(event, { prompt: async () => {
      const host = window as unknown as { pwaPromptCalls: number }; host.pwaPromptCalls++;
      if (fail) throw new Error('synthetic installation error');
    }, userChoice: Promise.resolve({ outcome, platform: 'web' }) });
    window.dispatchEvent(event);
  }, { outcome, fail });
}

test('早于进入设置的安装事件保留，接受后等待系统确认', async ({ page }) => {
  await page.goto('/'); await ready(page); await fakePrompt(page, 'accepted');
  await settings(page); await page.getByRole('button', { name: '安装健力宝', exact: true }).click();
  await expect(page.locator('.install-app')).toContainText('请按系统提示完成安装');
  await expect(page.locator('.install-state')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { pwaPromptCalls: number }).pwaPromptCalls)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('.install-state')).toContainText('已安装到设备');
  await expect(page.locator('.install-guide')).toHaveCount(0);
});

for (const fail of [false, true]) test(`安装${fail ? '异常' : '取消'}后可继续使用且不误报成功`, async ({ page }) => {
  await settings(page); const before = await storedWorkspace(page);
  await fakePrompt(page, 'dismissed', fail);
  await page.getByRole('button', { name: '安装健力宝', exact: true }).click();
  await expect(page.locator('.install-app [role=status]')).toContainText(fail ? '系统安装未完成' : '已取消安装');
  await expect(page.locator('.install-state')).toHaveCount(0);
  expect(await storedWorkspace(page)).toEqual(before);
  await fakePrompt(page, 'accepted'); await expect(page.getByRole('button', { name: '安装健力宝', exact: true })).toBeEnabled();
});

test('应用内浏览器提示打开Safari，不拦截系统安装', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, userAgent: `${apple} MicroMessenger/8.0`, viewport: { width: 320, height: 700 }, hasTouch: true });
  try {
    const page = await context.newPage(); await settings(page);
    await expect(page.locator('.install-hint')).toContainText('应用内浏览器');
    await fakePrompt(page, 'accepted'); await expect(page.getByRole('button', { name: '安装健力宝', exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test('manifest及Apple元标签支持独立窗口启动，安装身份保持', async ({ page, request }) => {
  await page.goto('/'); await ready(page);
  const response = await request.get('/manifest.webmanifest'); expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toMatch(/^application\/(?:manifest\+json|json)(?:;|$)/i);
  const worker = await request.get('/sw.js'); expect(worker.ok()).toBe(true);
  const shellAssets: string[] = JSON.parse((await worker.text()).match(/^const ASSETS = (\[[^\n]+\]);/m)![1]);
  expect(shellAssets).not.toContain('/_headers'); expect(shellAssets).not.toContain('/_redirects');
  const manifest = await response.json(); expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', background_color: '#0A0C0A', theme_color: '#0A0C0A' });
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', '健力宝');
});

test('隔离浏览器进程重开后离线启动，完整训练和身体数据保留且可继续记录', async ({ browserName, baseURL }, info) => {
  test.setTimeout(90000);
  const profile = info.outputPath('pwa-private-profile'); await mkdir(profile, { recursive: true });
  const options = { baseURL, viewport: { width: 390, height: 844 }, userAgent: browserName === 'webkit' ? apple : android, isMobile: true, hasTouch: true, locale: 'zh-CN' };
  const launch = () => browserName === 'webkit'
    ? webkit.launchPersistentContext(profile, { ...options, ignoreDefaultArgs: ['--disable-accelerated-compositing'] })
    : chromium.launchPersistentContext(profile, { ...options, channel: 'msedge' });
  let context = await launch();
  try {
    let page = context.pages()[0] ?? await context.newPage(); await page.goto('/'); await ready(page);
    const data = createInitialData(); data.onboarded = true;
    const session = createSession(null, data.exercises, Date.parse('2026-10-27T02:00:00Z'));
    session.name = 'PWA离线保留训练'; session.status = 'completed'; session.finishedAt = new Date('2026-10-27T03:00:00Z').toISOString();
    session.updatedAt = session.finishedAt;
    session.exercises = [createSessionExercise(data.exercises.find(e => e.id === 'ex-squat')!, 1, 80, 8)];
    session.exercises[0].sets[0].status = 'completed'; data.sessions = [session];
    data.bodyMetrics = [{ id: 'pwa-body-1', date: '2026-10-27', weightKg: 70, note: '离线与进程重开验收，合成数据' }];
    validateAppData(data);
    await page.evaluate(data => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('jianlibao', 1); open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result, tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put(data, 'main'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    }), data);
    await page.reload(); await ready(page); await offlineReady(page);
    await page.goto('/#/exercises'); await page.getByLabel('搜索动作', { exact: true }).fill('杠铃卧推');
    await page.getByRole('button', { name: '查看杠铃卧推讲解', exact: true }).tap();
    const art = page.getByAltText('杠铃卧推第1幅动作图解', { exact: true }); await expect(art).toHaveJSProperty('naturalWidth', 512);
    await page.getByRole('button', { name: '关闭弹窗', exact: true }).tap();
    const before = await storedWorkspace(page);
    await context.close(); context = await launch(); await context.setOffline(true);
    page = context.pages()[0] ?? await context.newPage(); await page.goto('/'); await ready(page);
    expect(await storedWorkspace(page)).toEqual(before);
    await page.goto('/#/progress'); await expect(page.getByText('PWA离线保留训练', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '统计总览', exact: true }).click();
    await expect(page.getByRole('group', { name: '统计周期', exact: true })).toBeVisible();
    await expect(page.locator('.analytics-metric').first()).toBeVisible();
    await settings(page); await expect(page.locator('.body-note')).toContainText('离线与进程重开验收');
    await page.getByRole('button', { name: '编辑2026-10-27身体记录', exact: true }).tap();
    await page.getByLabel('体重 (kg)', { exact: true }).fill('71');
    await page.getByRole('button', { name: '保存身体记录', exact: true }).tap();
    await expect.poll(async () => (await storedWorkspace(page)).bodyMetrics[0].weightKg).toBe(71);
    await page.goto('/#/exercises'); await page.getByLabel('搜索动作', { exact: true }).fill('杠铃卧推');
    await page.getByRole('button', { name: '查看杠铃卧推讲解', exact: true }).tap();
    await expect(page.getByAltText('杠铃卧推第1幅动作图解', { exact: true })).toHaveJSProperty('naturalWidth', 512);
    await page.getByRole('tab', { name: '详细讲解', exact: true }).tap(); await expect(page.locator('dialog')).toContainText('卧推');
    const after = await storedWorkspace(page); expect(after.sessions).toEqual(before.sessions);
    await page.reload(); await expect.poll(async () => (await storedWorkspace(page)).bodyMetrics[0].weightKg).toBe(71);
    await page.screenshot({ path: info.outputPath('offline-reopened.png') });
  } finally { await context.close(); }
});

for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light'] as const) test(`安装引导 ${width}px ${theme}完整可见`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 980 }); await settings(page);
  await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
  const card = page.locator('.install-app'); await card.scrollIntoViewIfNeeded();
  for (const choice of ['iPhone / iPad', '安卓手机']) {
    const button = card.getByRole('button', { name: choice, exact: true }); await button.click();
    const bounds = (await card.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    for (const row of await card.locator('li, p, button').all()) {
      const box = (await row.boundingBox())!; expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
    }
    const box = (await button.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(48);
    await card.screenshot({ path: info.outputPath(`install-${width}-${theme}-${choice === '安卓手机' ? 'android' : 'ios'}.png`) });
  }
});
