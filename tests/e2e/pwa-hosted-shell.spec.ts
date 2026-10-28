import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { listenForBrowser, storedWorkspace } from './helpers';

test('托管平台改写HTML时，离线缓存仍是完整的原始构建且重开保留数据', async ({ page, context }) => {
  const root = resolve('dist'), original = await readFile(resolve(root, 'index.html'), 'utf8');
  const annotation = '<!-- hosting annotation absent from the build -->';
  const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
      const file = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
      if (!file.startsWith(root + sep)) throw Error('Invalid public path');
      let bytes = await readFile(file);
      if (extname(file) === '.html') bytes = Buffer.from(bytes.toString('utf8').replace('<head>', '<head>' + annotation));
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(bytes);
    } catch { response.writeHead(404); response.end(); }
  });
  const origin = await listenForBrowser(server);
  try {
    await page.goto(origin + '/#/settings');
    await expect(page.locator('.pwa-readiness')).toContainText('离线启动已就绪', { timeout: 15000 });
    expect(await (await page.request.get(origin)).text()).toContain(annotation);
    const cached = await page.evaluate(async () => {
      const names = (await caches.keys()).filter(name => /^jianlibao-[a-f0-9]{16}$/.test(name));
      if (names.length !== 1) throw Error('Expected one shell');
      const cache = await caches.open(names[0]);
      return Promise.all(['/', '/index.html'].map(async path => (await cache.match(path, { ignoreVary: true }))!.text()));
    });
    expect(cached).toEqual([original, original]);
    const before = await storedWorkspace(page);
    await context.setOffline(true); await page.reload();
    await expect(page.locator('.pwa-readiness')).toContainText('离线启动已就绪', { timeout: 15000 });
    expect(await storedWorkspace(page)).toEqual(before);
  } finally {
    await context.setOffline(false);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
