import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expectPersisted, listenForBrowser, storedWorkspace } from './helpers';
import { sessionStats } from '../../src/domain/training';

async function readBuild(directory: string, prefix = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [name, content] of await readBuild(path.join(directory, entry.name), url)) files.set(name, content);
    } else files.set(url, await readFile(path.join(directory, entry.name)));
  }
  return files;
}

test('新 Service Worker 等待安装，活跃训练不刷新且可继续归档', async ({ browser }, testInfo) => {
  // Serve an immutable snapshot of the real production build on our own loopback port.
  // Only the in-memory worker script changes; dist and the normal 4173 server are untouched.
  const files = await readBuild(path.resolve('dist'));
  const originalWorker = files.get('/sw.js')?.toString('utf8');
  expect(originalWorker, '先运行 pnpm build 生成正式 Service Worker').toBeTruthy();
  const cacheMatch = originalWorker!.match(/const CACHE = "([^"]+)";/);
  expect(cacheMatch).not.toBeNull();
  const originalCache = cacheMatch![1];
  const updatedCache = `${originalCache}-sw-update-test2`;
  const updatedWorker = originalWorker!.replace(`const CACHE = "${originalCache}";`, `const CACHE = "${updatedCache}";`);
  let serveUpdatedWorker = false;
  let updatedWorkerRequests = 0;
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const content = pathname === '/sw.js' && serveUpdatedWorker ? Buffer.from(updatedWorker) : files.get(pathname);
    if (!content) { response.writeHead(404); response.end(); return; }
    if (pathname === '/sw.js' && serveUpdatedWorker) updatedWorkerRequests++;
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(pathname)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(content);
  });
  const origin = await listenForBrowser(server);
  const context = await browser.newContext({ baseURL: origin, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, '__qaDocumentToken', { value: crypto.randomUUID() });
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    const documentToken = await page.evaluate(() => (window as unknown as { __qaDocumentToken: string }).__qaDocumentToken);
    let documentLoadsAfterControl = 0;
    page.on('load', () => { documentLoadsAfterControl++; });
    await page.evaluate(() => {
      Object.defineProperty(window, '__qaOriginalController', { value: navigator.serviceWorker.controller });
    });

    await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
    await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
    await expect(page).toHaveURL(/#\/workout$/);
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('52.5');
    await expectPersisted(page, data => data.sessions[0].exercises[0].sets[0].weightKg === 52.5);
    const sessionId = (await storedWorkspace(page)).sessions[0].id;

    serveUpdatedWorker = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) throw new Error('生产 Service Worker 没有注册');
      await registration.update();
    });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    await expect(page.locator('.pwa-update-notice')).toHaveCount(0);
    expect(updatedWorkerRequests).toBeGreaterThan(0);
    const waitingEvidence = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        documentToken: (window as unknown as { __qaDocumentToken: string }).__qaDocumentToken,
        originalControllerStillActive: navigator.serviceWorker.controller === (window as unknown as { __qaOriginalController: ServiceWorker }).__qaOriginalController,
        activeState: registration?.active?.state,
        waitingState: registration?.waiting?.state,
        cacheNames: await caches.keys(),
      };
    });
    expect(waitingEvidence.documentToken).toBe(documentToken);
    expect(waitingEvidence.originalControllerStillActive).toBe(true);
    expect(waitingEvidence.activeState).toBe('activated');
    expect(waitingEvidence.cacheNames).toEqual(expect.arrayContaining([originalCache, updatedCache]));
    expect(documentLoadsAfterControl).toBe(0);
    await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('52.5');
    const retained = (await storedWorkspace(page)).sessions[0];
    expect(retained.id).toBe(sessionId);
    expect(retained.status).toBe('active');
    expect(retained.exercises[0].sets[0].weightKg).toBe(52.5);
    await page.screenshot({ path: testInfo.outputPath('sw-update-waiting.png'), fullPage: true });

    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await expectPersisted(page, data => sessionStats(data.sessions[0]).volumeKg === 525);
    await page.getByRole('button', { name: '提前回顾', exact: true }).click();
    await page.getByRole('button', { name: '保存训练', exact: true }).click();
    await expectPersisted(page, data => data.sessions[0].id === sessionId && data.sessions[0].status === 'completed');
    await expect(page.locator('.pwa-update-notice')).toContainText('新版本已准备');
    expect(sessionStats((await storedWorkspace(page)).sessions[0]).volumeKg).toBe(525);
    expect(await page.evaluate(() => (window as unknown as { __qaDocumentToken: string }).__qaDocumentToken)).toBe(documentToken);
    expect(documentLoadsAfterControl).toBe(0);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    await page.screenshot({ path: testInfo.outputPath('sw-update-saved.png'), fullPage: true });
    await writeFile(testInfo.outputPath('sw-update-evidence.json'), JSON.stringify({
      origin, originalCache, updatedCache, updatedWorkerRequests, waitingEvidence,
      documentLoadsAfterControl, sessionId, completedVolumeKg: 525,
    }, null, 2));
  } finally {
    await context.close();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  }
});
