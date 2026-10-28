/** Isolated WebKit diagnostics. Results are observations, never full acceptance. */
import { webkit, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { playwrightMetadata } from './webkit_environment.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = resolve(root, process.env.JLB_WEBKIT_PROBE_OUT || 'artifacts/webkit-probe');
if (relative(root, out).split(sep)[0] !== 'artifacts') throw Error('Probe output must remain within project artifacts');
await mkdir(out, { recursive: true });
const resultPath = resolve(out, 'probe-result.json');
try { await readFile(resultPath); throw Error('Refusing to overwrite previous probe result'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
for (const key of ['NO_PROXY', 'no_proxy']) process.env[key] = [...new Set((process.env[key] || '').split(',').concat('127.0.0.1', 'localhost'))].join(',');
const port = 5502, base = `http://127.0.0.1:${port}`;
const log = createWriteStream(resolve(out, 'preview.log'), { flags: 'wx' });
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
preview.stdout.pipe(log); preview.stderr.pipe(log, { end: false });
let browser, deadline;
const results = { diagnosticOnly: true, compatibilityAccepted: false, actualHost: process.platform, actualArch: process.arch, node: process.version, actualIOS: false, officialSafariTested: false, media: [], controls: [], calendars: [], screenshots: [], pageErrors: [] };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function shot(page, name) {
  await page.screenshot({ path: resolve(out, name + '.png'), animations: 'disabled' }); results.screenshots.push(name + '.png');
}
async function stable(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter(img => img.getClientRects().length).map(img => img.decode()));
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  });
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' && !a.pending));
}
async function mediaCase(asset, controlled, bad = false) {
  const context = await browser.newContext({ viewport: { width: 768, height: 980 }, serviceWorkers: controlled ? 'allow' : 'block' });
  try {
    const page = await context.newPage(); const http = [];
    page.on('response', response => {
      if (new URL(response.url()).pathname === asset.url) { const h = response.headers(); http.push({ status: response.status(), range: response.request().headers().range || null, contentRange: h['content-range'] || null, type: h['content-type'], length: h['content-length'] || null }); }
    });
    if (bad) await page.route('**/probe-invalid.mp4', route => route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('Deliberate invalid media bytes') }));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
    if (controlled) {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    }
    await page.setContent('<main><video id="sample" width="640" height="360" controls playsinline muted preload="metadata"></video></main>');
    await page.evaluate(url => {
      const v = document.querySelector('video'); const start = performance.now(); window.__mediaProbe = { events: [], frames: [], frameCallbackSupported: typeof v.requestVideoFrameCallback === 'function' };
      for (const event of ['loadstart','loadedmetadata','loadeddata','canplay','play','playing','waiting','seeking','seeked','pause','error']) v.addEventListener(event, () => window.__mediaProbe.events.push({ event, ms: performance.now() - start, readyState: v.readyState, error: v.error?.code ?? null, time: v.currentTime }));
      v.muted = true;
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback((_, meta) => window.__mediaProbe.frames.push({ mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames }));
      v.src = url;
    }, base + asset.url);
    await sleep(5100);
    const before = await page.evaluate(() => { const v = document.querySelector('video'); return { readyState: v.readyState, time: v.currentTime, width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : null, error: v.error?.code ?? null }; });
    const play = await page.evaluate(() => Promise.race([document.querySelector('video').play().then(() => ({ outcome: 'resolved' }), e => ({ outcome: 'rejected', name: e.name, message: e.message })), new Promise(resolve => setTimeout(() => resolve({ outcome: 'timeout' }), 5000))]));
    await sleep(350);
    const after = await page.evaluate(() => { const v = document.querySelector('video'); return { readyState: v.readyState, time: v.currentTime, width: v.videoWidth, height: v.videoHeight, paused: v.paused, error: v.error?.code ?? null, controlled: !!navigator.serviceWorker.controller, totalVideoFrames: v.getVideoPlaybackQuality?.().totalVideoFrames ?? null, webkitDecodedFrameCount: v.webkitDecodedFrameCount ?? null, ...window.__mediaProbe }; });
    let seek = null;
    if (play.outcome === 'resolved') seek = await page.evaluate(() => { const v = document.querySelector('video'); return new Promise(resolve => { const timer = setTimeout(() => resolve({ outcome: 'timeout', time: v.currentTime }), 5000); v.addEventListener('seeked', () => { clearTimeout(timer); resolve({ outcome: 'seeked', time: v.currentTime, error: v.error?.code ?? null }); }, { once: true }); v.currentTime = Math.min(3, v.duration / 2); }); });
    await shot(page, `media-${results.media.length}`);
    results.media.push({ url: asset.url, controlledRequested: controlled, bad, declared: asset, before, play, after, seek, http });
  } finally { await context.close(); }
}
async function selectVariants(page, state, width, theme) {
  const measure = () => page.locator('select').evaluateAll(nodes => nodes.filter(el => el.getClientRects().length).map(el => { const r = el.getBoundingClientRect(), c = getComputedStyle(el); return { label: el.ariaLabel || el.id || el.closest('label')?.textContent?.trim() || el.name, value: el.value, className: el.className, width: r.width, height: r.height, minHeight: c.minHeight, cssHeight: c.height, appearance: c.appearance, color: c.color, background: c.backgroundColor }; }));
  const initial = await page.locator('select').evaluateAll(nodes => nodes.map(el => el.getAttribute('style')));
  const variants = [];
  for (const variant of ['original','explicit-height','appearance-none']) {
    await page.locator('select').evaluateAll((nodes, { variant, initial }) => nodes.forEach((el, i) => { if (initial[i] === null) el.removeAttribute('style'); else el.setAttribute('style', initial[i]); if (variant === 'explicit-height') el.style.height = Math.max(44, parseFloat(getComputedStyle(el).minHeight) || 0) + 'px'; if (variant === 'appearance-none') el.style.appearance = 'none'; }), { variant, initial });
    await stable(page); variants.push({ variant, selects: await measure() }); await shot(page, `select-${state}-${width}-${theme}-${variant}`);
  }
  await page.locator('select').evaluateAll((nodes, initial) => nodes.forEach((el, i) => { if (initial[i] === null) el.removeAttribute('style'); else el.setAttribute('style', initial[i]); }), initial);
  results.controls.push({ state, width, theme, variants });
}
async function calendarPoints(page) {
  return page.locator('.calendar-grid').evaluate(async grid => {
    const failures = [];
    for (const button of grid.querySelectorAll('.calendar-day')) {
      button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); await new Promise(requestAnimationFrame);
      const r = button.getBoundingClientRect(); const radius = getComputedStyle(button).borderRadius; const inset = Math.max(2, Math.min(parseFloat(radius) + 1, r.width / 2, r.height / 2));
      for (const [x,y] of [[r.left+inset,r.top+inset],[r.right-inset,r.bottom-inset],[r.left+r.width/2,r.top+r.height/2]]) { const hit = document.elementFromPoint(x,y); if (!button.contains(hit)) failures.push({ label: button.ariaLabel, x, y, hit: hit?.tagName+'.'+hit?.className, radius, button: { top:r.top,bottom:r.bottom,left:r.left,right:r.right } }); }
    }
    const r = grid.getBoundingClientRect(), c = getComputedStyle(grid); grid.scrollLeft = 0;
    return { failures, dateCount: grid.querySelectorAll('.calendar-day').length, clientHeight: grid.clientHeight, offsetHeight: grid.offsetHeight, clientWidth: grid.clientWidth, offsetWidth: grid.offsetWidth, scrollHeight: grid.scrollHeight, scrollWidth: grid.scrollWidth, paddingBottom: c.paddingBottom, overflowX: c.overflowX, overflowY: c.overflowY, box: { top:r.top,bottom:r.bottom,left:r.left,right:r.right }, documentOverflow: document.documentElement.scrollWidth-innerWidth };
  });
}
async function uiCases() {
  const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce', viewport: { width: 1440, height: 980 } });
  try {
    const page = await context.newPage(); page.on('pageerror', error => results.pageErrors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-10-16T06:00:00Z'));
    const go = route => page.goto(base + '/#/' + route, { waitUntil: 'domcontentloaded' });
    await go('settings'); await expect(page.getByRole('button', { name: '记录身体数据', exact: true })).toBeEnabled();
    await page.getByLabel('选择健力宝备份文件', { exact: true }).setInputFiles({ name: 'probe-legacy-v1.json', mimeType: 'application/json', buffer: await readFile(resolve(root, 'tests/fixtures/legacy-v1-ui-backup.json')) });
    await page.getByRole('button', { name: '确认导入', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByLabel('显示主观用力 RPE', { exact: true }).check();
    await go('workout'); await page.getByRole('button', { name: '继续训练', exact: true }).click();
    for (const width of [320,390,768,1440]) for (const theme of ['dark','light']) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 980 });
      await go('settings'); await page.getByLabel('界面主题', { exact: true }).selectOption(theme); await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await selectVariants(page, 'settings', width, theme);
      await go('workout'); await selectVariants(page, 'workout', width, theme);
      await go('exercises'); await page.getByLabel('搜索动作', { exact: true }).fill('死虫式'); await page.getByRole('button', { name: '查看死虫式讲解', exact: true }).click(); await selectVariants(page, 'guide', width, theme); await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await go('progress'); await page.getByRole('button', { name: '训练历史', exact: true }).click();
      const card = page.locator('.calendar-card'); if (!(await card.evaluate(el => el.open))) await page.getByLabel('按日期筛选训练', { exact: true }).click(); await stable(page);
      const original = await calendarPoints(page); await shot(page, `calendar-${width}-${theme}-original`);
      await page.locator('.calendar-grid').evaluate(grid => { grid.style.paddingBottom = '16px'; });
      const padded = await calendarPoints(page); await shot(page, `calendar-${width}-${theme}-padded`);
      results.calendars.push({ width, theme, original, padded });
    }
  } finally { await context.close(); }
}
async function run() {
  for (let attempt=0; ; attempt++) { if (preview.exitCode !== null) throw Error('Owned preview exited'); try { if ((await fetch(base)).ok) break; } catch {} if (attempt > 100) throw Error('Owned preview did not start'); await sleep(100); }
  browser = await webkit.launch(); results.environment = { ...(await playwrightMetadata()), browserVersion: browser.version(), executable: webkit.executablePath() };
  const probePage = await browser.newPage(); results.environment.userAgent = await probePage.evaluate(() => navigator.userAgent); await probePage.close();
  const bench = JSON.parse(await readFile(resolve(root, 'src/content/reference-media.json'), 'utf8')); const library = JSON.parse(await readFile(resolve(root, 'src/content/reference-library.json'), 'utf8'));
  function movies(value) { if (Array.isArray(value)) return value.flatMap(movies); if (value && typeof value === 'object') return value.kind === 'video' ? [value] : Object.values(value).flatMap(movies); return []; }
  const assets = [bench.assets.find(a => a.kind === 'video'), movies(library)[0]];
  for (const asset of assets) { const bytes = await readFile(resolve(root, 'public' + asset.url)); if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw Error('Probe original asset checksum mismatch'); for (const controlled of [false,true]) await mediaCase(asset, controlled); }
  await mediaCase({ url: '/probe-invalid.mp4' }, false, true);
  await uiCases(); results.completed = true;
  results.regressions = {
    nativeTargets: results.controls.every(c => c.variants.find(v => v.variant === 'original').selects.every(s => s.width >= 44 && s.height >= 44)),
    calendarTargets: results.calendars.every(c => c.original.dateCount === 31 && c.original.failures.length === 0),
    validPlayback: results.media.filter(m => !m.bad).every(m => m.play.outcome === 'resolved' && m.after.readyState >= 2 && m.after.time > .15 && m.after.width === m.declared.width && m.after.height === m.declared.height && m.after.error === null && m.seek?.outcome === 'seeked' && m.after.controlled === m.controlledRequested),
    invalidPlaybackRejected: results.media.filter(m => m.bad).every(m => m.play.outcome === 'rejected' && m.after.error !== null && m.after.readyState < 2)
  };
  if (Object.values(results.regressions).some(passed => !passed)) throw Error('Observed regression failures: ' + JSON.stringify(results.regressions));
}
try { await Promise.race([run(),new Promise((_,reject) => { deadline=setTimeout(() => reject(Error('Probe exceeded 5 minutes')),300000); })]); }
catch (error) { results.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { clearTimeout(deadline); await writeFile(resultPath, JSON.stringify(results,null,2)); if (browser) await browser.close(); preview.kill(); log.end(); }
console.log(JSON.stringify({ diagnosticOnly: true, completed: results.completed || false, actualHost: results.actualHost, media: results.media.length, controlCases: results.controls.length, calendarCases: results.calendars.length, screenshots: results.screenshots.length, error: results.error?.message || null }));
