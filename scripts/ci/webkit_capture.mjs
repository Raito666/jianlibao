import { webkit, expect } from '../../node_modules/@playwright/test/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { auditPage } from './web_ui_audit.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const phase = 'screenshots';
const port = 5440;
const out = root + 'artifacts/webkit-macos/';
await mkdir(out + phase, { recursive: true });
const browser = await webkit.launch({ headless: true });
const context = await browser.newContext({ locale: 'zh-CN', timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.clock.setFixedTime(new Date('2026-10-18T14:50:20.000Z'));
const errors = [], results = [], savedScreenshots = [];
page.on('pageerror', error => errors.push(error.message));
async function go(route) { await page.goto(`http://127.0.0.1:${port}/#/` + route, { waitUntil: 'domcontentloaded' }); }
async function clean(state) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter(img => img.getClientRects().length).map(async img => { img.loading = 'eager'; await img.decode(); if (!img.naturalWidth) throw new Error('Screenshot contains an undecoded image: ' + img.src); })); });
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' && !animation.pending));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, theme: document.documentElement.dataset.theme }));
  expect(metrics.scrollWidth, state).toBeLessThanOrEqual(metrics.width + 1);
  results.push({ state, ...metrics, audit: await auditPage(page) });
}
async function shot(state, width, theme, fullPage = true) { await clean(state); await page.screenshot({ path: out + `${phase}/${state}-${width}-${theme}.png`, fullPage, animations: 'disabled' }); savedScreenshots.push(`${state}-${width}-${theme}.png`); }
try {
  await go('settings');
  await expect(page.getByRole('button', { name: '记录身体数据', exact: true })).toBeEnabled();
  await page.getByLabel('选择健力宝备份文件', { exact: true }).setInputFiles({ name: 'legacy-v1.json', mimeType: 'application/json', buffer: await readFile(root + 'tests/fixtures/legacy-v1-ui-backup.json') });
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('显示主观用力 RPE', { exact: true }).check();
  for (const [date, weight, waist] of [['2026-10-17', '72.4', '81'], ['2026-10-18', '72.1', '80.5']]) {
    await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
    await page.getByLabel('记录日期', { exact: true }).fill(date);
    await page.getByLabel('体重 (kg)', { exact: true }).fill(weight);
    await page.getByLabel('体脂率 (%)', { exact: true }).fill('18.5');
    await page.getByText('补充围度 · cm', { exact: true }).click();
    for (const [label, value] of [['胸围','98'],['腰围',waist],['臀围','96'],['臂围','34'],['腿围','55']]) await page.getByLabel(`${label} (cm)`, { exact: true }).fill(value);
    await page.getByLabel('备注（可选）', { exact: true }).fill('晨起测量，同一台体重秤。');
    await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await go('workout');
  await page.getByRole('button', { name: '继续训练', exact: true }).click();
  await page.getByLabel('杠铃深蹲第1组类型', { exact: true }).selectOption('drop');
  await page.getByLabel('杠铃深蹲第1组RPE', { exact: true }).selectOption('8.5');
  await expect(page.locator('.toast')).not.toBeVisible();
  for (const width of [320,390,768,1440]) for (const theme of ['dark','light']) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await go('settings'); await page.getByLabel('界面主题', { exact: true }).selectOption(theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await shot('settings', width, theme);
    await page.getByRole('button', { name: '编辑2026-10-18身体记录', exact: true }).click();
    await page.getByText('补充围度 · cm', { exact: true }).click();
    await shot('body-editor', width, theme, false);
    await page.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
    for (const state of ['today','plans','exercises','workout','history','statistics']) {
      await go(['history','statistics'].includes(state) ? 'progress' : state);
      if (state === 'history') await page.getByRole('button', { name: '训练历史', exact: true }).click();
      if (state === 'statistics') await page.getByRole('button', { name: '统计总览', exact: true }).click();
      await shot(state, width, theme, state !== 'workout');
    }
    await go('exercises');
    await page.getByLabel('搜索动作',{exact:true}).fill('死虫式');
    await page.getByRole('button',{name:'查看死虫式讲解',exact:true}).click();
    await shot('guide-brief',width,theme,false);
    await page.getByRole('tab',{name:'详细讲解',exact:true}).click();
    await shot('guide-detailed',width,theme,false);
    await page.getByRole('button',{name:'关闭弹窗',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ screenshots: savedScreenshots.length, pageErrors: errors }));
} finally {
  await writeFile(out + 'capture-result.json', JSON.stringify({ screenshots: savedScreenshots.length, savedScreenshots, checks: results, pageErrors: errors }, null, 2));
  await context.close(); await browser.close();
}
