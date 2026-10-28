import { expect, test, type Page } from '@playwright/test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { collectIosViewportDiagnostics } from '../../src/platform/ios-viewport-diagnostics';

/** Production application + simulated iOS bridge. This cannot prove device/OS delivery. */
async function bridge(page: Page, initialPermission = 'granted') {
  const db = new DatabaseSync(':memory:');
  const calls: { plugin: string; method: string; options: any }[] = [];
  const pending = new Map<number, any>();
  let registered = false, opened = false, permission = initialPermission, cancelShare = false;
  let permissionResponse: string | undefined, failShareOnce = false;
  const files = new Map<string, string>();
  const exports: string[] = [];
  await page.exposeFunction('__nativeCall', async (plugin: string, method: string, options: any = {}) => {
    calls.push({ plugin, method, options });
    if (plugin === 'CapacitorSQLite') {
      const done = () => ({ changes: { changes: 0 } });
      switch (method) {
        case 'isDBOpen': if (!registered) throw new Error('connection unavailable'); return { result: opened };
        case 'isTransactionActive': return { result: db.isTransaction };
        case 'createConnection': registered = true; return;
        case 'open': opened = true; return;
        case 'closeConnection': if (db.isTransaction) db.exec('ROLLBACK'); registered = false; opened = false; return;
        case 'execute': db.exec(options.statements); return done();
        case 'beginTransaction': db.exec('BEGIN'); return done();
        case 'commitTransaction': db.exec('COMMIT'); return done();
        case 'rollbackTransaction': db.exec('ROLLBACK'); return done();
        case 'query': return { values: db.prepare(options.statement).all(...(options.values ?? []) as SQLInputValue[]) };
        case 'run': return { changes: { changes: Number(db.prepare(options.statement).run(...(options.values ?? []) as SQLInputValue[]).changes) } };
      }
    }
    if (plugin === 'LocalNotifications') {
      if (method === 'checkPermissions' || method === 'requestPermissions') {
        if (method === 'requestPermissions' && permissionResponse !== undefined) permission = permissionResponse;
        return { display: permission };
      }
      if (method === 'schedule') { for (const note of options.notifications) pending.set(note.id, note); return { notifications: options.notifications.map((n: any) => ({ id: n.id })) }; }
      if (method === 'cancel') { for (const n of options.notifications) pending.delete(n.id); return; }
      if (method === 'removeDeliveredNotificationsById') return;
    }
    if (plugin === 'App') {
      if (method === 'getState') return { isActive: true };
      if (method === 'removeListener') return;
    }
    if (plugin === 'Haptics') return;
    if (plugin === 'Filesystem') {
      if (method === 'writeFile') { expect(options.directory).toBe('CACHE'); expect(options.encoding).toBe('utf8'); files.set(options.path, options.data); exports.push(options.data); return { uri: `file:///cache/${options.path}` }; }
      if (method === 'deleteFile') { files.delete(options.path); return; }
    }
    if (plugin === 'Share' && method === 'share') {
      expect(files.size).toBe(1);
      expect(options.files[0]).toMatch(/^file:\/\/\/cache\/exports\//);
      if (cancelShare) throw new Error('Share canceled');
      if (failShareOnce) { failShareOnce = false; throw new Error('系统分享暂时失败，请重试'); }
      return { activityType: 'com.apple.CloudDocsUI.AddToiCloudDrive' };
    }
    throw new Error(`Unexpected native call ${plugin}.${method}`);
  });
  await page.addInitScript(() => {
    const listeners: Record<string, (state: { isActive: boolean }) => void> = {};
    let id = 0;
    const methods: Record<string, string[]> = {
      CapacitorSQLite: ['isDBOpen', 'isTransactionActive', 'createConnection', 'open', 'closeConnection', 'execute', 'beginTransaction', 'commitTransaction', 'rollbackTransaction', 'query', 'run'],
      LocalNotifications: ['checkPermissions', 'requestPermissions', 'schedule', 'cancel', 'removeDeliveredNotificationsById'],
      Haptics: ['impact', 'notification', 'selectionStart', 'selectionChanged', 'selectionEnd'],
      App: ['getState', 'removeListener'], Filesystem: ['writeFile', 'deleteFile'], Share: ['share'],
    };
    Object.assign(window, {
      __activity: (active: boolean) => Object.values(listeners).forEach(fn => fn({ isActive: active })),
      __wake: { requests: 0, releases: 0 },
      webkit: { messageHandlers: { bridge: { postMessage() {} } } },
      Capacitor: {
        PluginHeaders: Object.entries(methods).map(([name, entries]) => ({ name, methods: [...entries.map(name => ({ name, rtype: 'promise' })), ...(name === 'App' ? [{ name: 'addListener', rtype: 'callback' }] : [])] })),
        nativePromise(plugin: string, method: string, options: any) {
          if (plugin === 'App' && method === 'removeListener') delete listeners[options.callbackId];
          return Reflect.get(window, '__nativeCall')(plugin, method, options);
        },
        nativeCallback(_plugin: string, _method: string, _options: unknown, callback: (state: { isActive: boolean }) => void) {
          const key = String(++id); listeners[key] = callback; return key;
        },
      },
    });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      async request() { Reflect.get(window, '__wake').requests++; return { async release() { Reflect.get(window, '__wake').releases++; }, addEventListener() {} }; },
    } });
  });
  return { calls, pending, files, exports, permission: (value: string) => { permission = value; }, cancelShare: (value: boolean) => { cancelShare = value; }, close: () => db.close(), grantOnRequest: (value: string) => { permissionResponse = value; }, failNextShare: () => { failShareOnce = true; } };
}
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
  await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
}
async function options(page: Page) {
  const expand = page.getByRole('button', { name: '展开休息面板', exact: true });
  if (await expand.isVisible()) await expand.click();
  const summary = page.getByText('休息提醒设置', { exact: true });
  await summary.click();
}
test('native rest schedules/cancels and set completion/undo provide haptic feedback', async ({ page }) => {
  const native = await bridge(page);
  try {
    await start(page);
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(1);
    const note = [...native.pending.values()][0];
    expect(note.foreground).toBe(false);
    expect(Date.parse(note.schedule.at)).toBeGreaterThan(Date.now());
    expect(native.calls.some(x => x.method === 'requestPermissions')).toBe(false);
    await expect.poll(() => native.calls.filter(x => x.plugin === 'Haptics' && x.method === 'impact').length).toBe(1);
    await page.getByRole('button', { name: '撤销杠铃深蹲第1组', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(0);
    await expect.poll(() => native.calls.filter(x => x.plugin === 'Haptics' && x.method === 'impact').length).toBe(2);
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(1);
    await page.getByRole('button', { name: '跳过休息', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(0);
  } finally { await page.close(); native.close(); }
});
test('permission denial does not interrupt training or trigger automatic prompts', async ({ page }) => {
  const native = await bridge(page, 'prompt');
  try {
    await start(page);
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await options(page);
    expect(native.calls.some(x => x.method === 'requestPermissions')).toBe(false);
    native.permission('denied');
    await page.getByRole('button', { name: '启用后台提醒', exact: true }).click();
    await expect(page.getByText('通知未授权，返回前台仍可查看剩余休息。', { exact: true })).toBeVisible();
    expect(native.pending.size).toBe(0);
    await expect(page.locator('.save-indicator')).toContainText('已保存到本机');
  } finally { await page.close(); native.close(); }
});
test('native JSON share preserves format, cancellation is not reported as successful export', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.goto('/#/settings');
    await page.getByRole('button', { name: '导出备份', exact: true }).click();
    await expect(page.getByText('备份已交给系统分享，请确认保存到所选位置', { exact: true })).toBeVisible();
    await expect.poll(() => native.files.size).toBe(0);
    const backup = JSON.parse(native.exports[0]);
    expect(backup.app).toBe('jianlibao'); expect(backup.formatVersion).toBe(2); expect(backup.data.schemaVersion).toBe(2);
    native.cancelShare(true);
    await page.getByRole('button', { name: '导出备份', exact: true }).click();
    await expect(page.getByText('已取消分享，记录仍保存在本机', { exact: true })).toBeVisible();
    await expect.poll(() => native.files.size).toBe(0);
    expect(native.calls.filter(x => x.plugin === 'Share')).toHaveLength(2);
  } finally { await page.close(); native.close(); }
});
test('native lifecycle releases/reacquires opted-in wake lock and suppresses duplicate overdue haptics', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.clock.install();
    await start(page); await options(page);
    await page.getByRole('button', { name: '训练时保持亮屏', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__wake').requests)).toBe(1);
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(1);
    await page.evaluate(() => Reflect.get(window, '__activity')(false));
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__wake').releases)).toBe(1);
    await page.clock.fastForward(120_000);
    await page.evaluate(() => Reflect.get(window, '__activity')(true));
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__wake').requests)).toBe(2);
    await expect(page.locator('.rest-time')).toHaveText('0:00');
    expect(native.calls.filter(x => x.plugin === 'Haptics' && x.method === 'notification' && x.options.type === 'SUCCESS')).toHaveLength(0);
    await page.getByRole('button', { name: '提前回顾', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, '__wake').releases)).toBe(2);
  } finally { await page.close(); native.close(); }
});
test('native CSV uses the existing records and UTF-8 system-file sharing', async ({ page }) => {
  const native = await bridge(page);
  try {
    await start(page);
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('67.5');
    await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('8');
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await page.getByRole('button', { name: '提前回顾', exact: true }).click();
    await page.getByRole('button', { name: '保存训练', exact: true }).click();
    await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('button', { name: '进步', exact: true }).click();
    await page.getByRole('button', { name: '导出明细 CSV', exact: true }).click();
    await expect(page.getByText('训练明细已交给系统分享，请确认保存到所选位置', { exact: true })).toBeVisible();
    expect(native.exports[0]).toContain('67.5'); expect(native.exports[0]).toContain('杠铃深蹲');
    await page.getByRole('button', { name: '统计总览', exact: true }).click();
    await page.getByRole('button', { name: '导出本期 CSV', exact: true }).click();
    await expect.poll(() => native.exports.length).toBe(2);
    expect(native.exports[1]).toBe(native.exports[0]);
    await expect.poll(() => native.files.size).toBe(0);
  } finally { await page.close(); native.close(); }
});
test('foreground native deadline alerts once and muted reminders do not re-schedule', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.clock.install(); await start(page);
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(1);
    await page.clock.fastForward(120_000);
    await expect.poll(() => native.calls.filter(x => x.plugin === 'Haptics' && x.method === 'notification' && x.options.type === 'SUCCESS').length).toBe(1);
    await page.evaluate(() => Reflect.get(window, '__activity')(true));
    await page.clock.fastForward(1000);
    expect(native.calls.filter(x => x.plugin === 'Haptics' && x.method === 'notification' && x.options.type === 'SUCCESS')).toHaveLength(1);
    await options(page);
    await page.getByRole('button', { name: '声音提醒', exact: true }).click();
    await page.getByRole('button', { name: '震动提醒', exact: true }).click();
    await page.getByRole('button', { name: '完成杠铃深蹲第2组', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(0);
    await page.clock.fastForward(120_000);
    expect(native.calls.filter(x => x.plugin === 'Haptics' && x.method === 'notification' && x.options.type === 'SUCCESS')).toHaveLength(1);
  } finally { await page.close(); native.close(); }
});
for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light']) {
  test(`native reminder controls remain accessible at ${width} ${theme}`, async ({ browser }, info) => {
    const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 980 }, locale: 'zh-CN' });
    const page = await context.newPage(); const native = await bridge(page);
    try {
      await start(page);
      if (theme === 'light') await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
      await options(page);
      for (const name of ['声音提醒', '震动提醒', '训练时保持亮屏', '关闭后台提醒']) {
        const control = page.getByRole('button', { name, exact: true });
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
        expect(await control.evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width >= 44 && r.height >= 44 && !!hit && el.contains(hit); })).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${width}-${theme}-native-options.png`) });
      await page.getByRole('button', { name: '训练时保持亮屏', exact: true }).click();
      await expect(page.getByRole('button', { name: '训练时保持亮屏', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.screenshot({ path: info.outputPath(`${width}-${theme}-native-awake.png`) });
    } finally { await context.close(); native.close(); }
  });
}

test('explicit native permission grant and disabling reminders preserve cancellation through pause', async ({ page }) => {
  const native = await bridge(page, 'prompt');
  try {
    await start(page);
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await options(page);
    expect(native.pending.size).toBe(0);
    expect(native.calls.some(call => call.method === 'requestPermissions')).toBe(false);
    native.grantOnRequest('granted');
    await page.getByRole('button', { name: '启用后台提醒', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(1);
    expect(native.calls.filter(call => call.method === 'requestPermissions')).toHaveLength(1);
    await page.getByRole('button', { name: '关闭后台提醒', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(0);
    await expect(page.getByText('后台提醒已关闭，前台提醒仍按开关执行。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+30 秒', exact: true }).click();
    expect(native.pending.size).toBe(0);
    await page.getByRole('button', { name: '启用后台提醒', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(1);
    expect(native.calls.filter(call => call.method === 'requestPermissions')).toHaveLength(1);
    await page.getByRole('button', { name: '暂停训练', exact: true }).click();
    await expect.poll(() => native.pending.size).toBe(0);
  } finally { await page.close(); native.close(); }
});

test('native export failure cleans its cache and a successful retry clears the old error', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.clock.setFixedTime(new Date('2026-10-18T06:00:00Z'));
    await page.goto('/#/settings');
    native.failNextShare();
    await page.getByRole('button', { name: '导出备份', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('系统分享暂时失败，请重试');
    await expect.poll(() => native.files.size).toBe(0);
    await expect(page.getByText('尚未导出备份', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '导出备份', exact: true }).click();
    await expect(page.getByText('备份已交给系统分享，请确认保存到所选位置', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => native.files.size).toBe(0);
    expect(JSON.parse(native.exports[0]).data.sessions).toEqual(JSON.parse(native.exports[1]).data.sessions);
    expect(JSON.parse(native.exports[1]).formatVersion).toBe(2);
    expect(JSON.parse(native.exports[1]).data.schemaVersion).toBe(2);
  } finally { await page.close(); native.close(); }
});

test('native input accessory stays inside the modal and skips folded measurements', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/settings');
    await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await page.locator('html').evaluate(root => root.style.setProperty('--safe-top', '62px'));
    const weight = page.getByLabel('体重 (kg)', { exact: true });
    const fat = page.getByLabel('体脂率 (%)', { exact: true });
    const note = page.getByLabel('备注（可选）', { exact: true });
    await weight.fill('72.4');
    await expect(dialog.getByRole('group', { name: '输入辅助', exact: true })).toBeVisible();
    expect(await dialog.locator('.modal-header').evaluate(header => header.getBoundingClientRect().top)).toBeGreaterThanOrEqual(62);
    await expect(dialog.getByRole('button', { name: '上一项', exact: true })).toBeDisabled();
    await expect(weight).toHaveAttribute('inputmode', 'decimal');
    await dialog.getByRole('button', { name: '下一项', exact: true }).click();
    await expect(fat).toBeFocused();
    await fat.fill('18.5');
    await fat.evaluate(field => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
    await expect(fat).toBeFocused();
    await fat.press('Enter');
    await expect(note).toBeFocused();
    await expect(dialog.getByRole('button', { name: '下一项', exact: true })).toBeDisabled();
    await note.fill('第一行');
    await note.press('End');
    await note.press('Enter');
    await note.pressSequentially('第二行');
    await expect(note).toHaveValue('第一行\n第二行');
    await dialog.getByRole('button', { name: '上一项', exact: true }).click();
    await expect(fat).toBeFocused();
    await expect(weight).toHaveValue('72.4');
    await expect(fat).toHaveValue('18.5');
    await dialog.getByRole('button', { name: '收起键盘', exact: true }).click();
    await expect(page.getByRole('group', { name: '输入辅助', exact: true })).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '导出备份', exact: true }).click();
    await expect.poll(() => native.exports.length).toBe(1);
    expect(JSON.parse(native.exports[0]).data.bodyMetrics).toEqual([]);
  } finally { await page.close(); native.close(); }
});

test('native numeric next/previous and dismiss preserve training values without completing a set', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await start(page);
    const weight = page.getByLabel('杠铃深蹲第1组总重量', { exact: true });
    const reps = page.getByLabel('杠铃深蹲第1组次数', { exact: true });
    await weight.fill('37.5');
    await page.getByRole('button', { name: '下一项', exact: true }).click();
    await expect(reps).toBeFocused();
    await expect(reps).toHaveAttribute('inputmode', 'numeric');
    await reps.fill('9');
    await page.getByRole('button', { name: '上一项', exact: true }).click();
    await expect(weight).toBeFocused();
    await expect(weight).toHaveValue('37.5');
    await page.getByRole('button', { name: '收起键盘', exact: true }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-ios-input-active', 'true');
    await expect(page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '撤销杠铃深蹲第1组', exact: true })).toHaveCount(0);
    await expect(weight).toHaveValue('37.5');
    await expect(reps).toHaveValue('9');
    await expect(page.locator('.workout-footer')).toBeVisible();
  } finally { await page.close(); native.close(); }
});

test('native input cleanup restores temporary attributes when a focused form closes', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.goto('/#/settings');
    await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
    await page.getByLabel('体重 (kg)', { exact: true }).fill('72.4');
    await expect(page.locator('html')).toHaveAttribute('data-ios-input-active', 'true');
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-ios-editing]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-ios-input-active', 'true');
    expect(await page.locator('html').evaluate(root => ['--ios-visible-height', '--ios-visible-top', '--ios-input-bottom'].map(name => root.style.getPropertyValue(name)))).toEqual(['', '', '']);
    await expect(page.getByRole('group', { name: '输入辅助', exact: true })).toHaveCount(0);
  } finally { await page.close(); native.close(); }
});

test('native compact viewport keeps the complete note above its input accessory', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.setViewportSize({ width: 390, height: 449 });
    await page.goto('/#/settings');
    await page.locator('html').evaluate(root => root.style.setProperty('--safe-top', '62px'));
    await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
    const note = page.getByLabel('备注（可选）', { exact: true });
    await note.fill('短视口备注\n第二行');
    await expect(page.getByRole('group', { name: '输入辅助', exact: true })).toBeVisible();
    const geometry = (pan = false) => note.evaluate((field, pan) => {
      if (pan) {
        const body = field.closest('.modal-body')!;
        body.scrollTop = Math.max(0, body.scrollTop - 32);
      }
      const rect = field.getBoundingClientRect();
      const body = field.closest('.modal-body')!.getBoundingClientRect();
      const bar = document.querySelector('[data-ios-input-accessory]')!.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, bodyTop: body.top, bodyBottom: body.bottom, barTop: bar.top,
        contained: rect.top >= body.top - 1 && rect.bottom <= Math.min(body.bottom, bar.top) + 1 };
    }, pan);
    console.log('COMPACT_INPUT_GEOMETRY', await geometry());
    await expect.poll(async () => (await geometry()).contained).toBe(true);
    // WKWebView can pan after typing without a viewport resize. Typing again
    // must reveal the field; manual scrolling alone must not be pulled back.
    // Sample the injected occlusion in the same DOM task: a pending native
    // layout observer is allowed to repair it before another protocol roundtrip.
    expect((await geometry(true)).contained).toBe(false);
    await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event('scroll')));
    await expect.poll(async () => (await geometry()).contained).toBe(true);
    await page.evaluate(() => document.dispatchEvent(new Event('touchmove', { bubbles: true })));
    expect((await geometry(true)).contained).toBe(false);
    await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event('scroll')));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect((await geometry()).contained).toBe(false);
    await note.dispatchEvent('input', { bubbles: true, inputType: 'insertText' });
    await expect.poll(async () => (await geometry()).contained).toBe(true);
    expect((await geometry(true)).contained).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await expect.poll(async () => (await geometry()).contained).toBe(true);
    // The portal can commit after the focus frame, shrinking its sibling scroller.
    await page.locator('[data-ios-input-accessory-slot]').evaluate(slot => { (slot as HTMLElement).style.paddingTop = '16px'; });
    await expect.poll(async () => (await geometry()).contained).toBe(true);
    await page.getByRole('button', { name: '收起键盘', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存身体记录', exact: true })).toBeVisible();
    await expect(note).toHaveValue('短视口备注\n第二行');
  } finally { await page.close(); native.close(); }
});

test('native panned modal reveals the complete note in its visible coordinate space', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.setViewportSize({ width: 390, height: 852 });
    await page.goto('/#/settings');
    await page.locator('html').evaluate(root => root.style.setProperty('--safe-top', '62px'));
    await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
    const note = page.getByLabel('备注（可选）', { exact: true });
    await note.fill('平移后的完整备注\n第二行');
    await expect(page.getByRole('group', { name: '输入辅助', exact: true })).toBeVisible();
    await page.evaluate(() => {
      // Native iOS 26 evidence: innerHeight=852, visual height=449,
      // offsetTop=403, while the dialog/scroller rects remain in visible space.
      Object.defineProperties(window.visualViewport!, {
        height: { configurable: true, value: 449 },
        offsetTop: { configurable: true, value: 403 },
      });
      const style = document.createElement('style');
      style.textContent = 'dialog.modal { transform: translateY(-403px) !important; animation: none !important; transition: none !important; }';
      document.head.append(style);
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect(page.locator('html')).toHaveCSS('--ios-visible-top', '403px');
    await note.evaluate(field => {
      field.closest('.modal-body')!.scrollTop = 0;
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await expect.poll(() => note.evaluate(field => {
      const rect = field.getBoundingClientRect();
      const body = field.closest('.modal-body')!.getBoundingClientRect();
      const bar = document.querySelector('[data-ios-input-accessory]')!.getBoundingClientRect();
      return rect.top >= body.top - 1 && rect.bottom <= Math.min(body.bottom, bar.top) + 1;
    })).toBe(true);
    await expect(note).toHaveValue('平移后的完整备注\n第二行');
    await page.getByRole('button', { name: '收起键盘', exact: true }).click();
    await expect(page.getByRole('group', { name: '输入辅助', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存身体记录', exact: true })).toBeVisible();
  } finally { await page.close(); native.close(); }
});

test('native panned training keeps the accessory and whole field above the keyboard', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.setViewportSize({ width: 390, height: 628 });
    await start(page);
    await page.locator('html').evaluate(root => root.style.setProperty('--safe-top', '62px'));
    const weight = page.getByLabel('杠铃深蹲第1组总重量', { exact: true });
    await weight.fill('37.5');
    await expect(page.getByRole('group', { name: '输入辅助', exact: true })).toBeVisible();
    await page.evaluate(() => {
      // Actual native training geometry: innerHeight=628, visual height=476,
      // offsetTop=224. Fixed accessory coordinates already use the visible origin.
      Object.defineProperties(window.visualViewport!, {
        height: { configurable: true, value: 476 },
        offsetTop: { configurable: true, value: 224 },
      });
      (document.querySelector('.app-shell') as HTMLElement).style.minHeight = '1000px';
      window.scrollTo(0, 224);
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    await expect.poll(() => page.locator('[data-ios-input-accessory]').evaluate(bar => bar.getBoundingClientRect().bottom)).toBeLessThanOrEqual(477);
    await weight.evaluate(field => {
      // The native previous-field trace also placed a field at y55 under the
      // status bar; inject that position and require the safe area as well.
      const scroller = field.closest('.workout-view')!;
      scroller.scrollTop += field.getBoundingClientRect().top - 55;
      field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    });
    await expect.poll(() => weight.evaluate(field => {
      const rect = field.getBoundingClientRect();
      const scroller = field.closest('.workout-view')!.getBoundingClientRect();
      const bar = document.querySelector('[data-ios-input-accessory]')!.getBoundingClientRect();
      return rect.top >= Math.max(62, scroller.top) - 1 && rect.bottom <= Math.min(scroller.bottom, bar.top) + 1;
    })).toBe(true);
    await expect(weight).toHaveValue('37.5');
    await page.getByRole('button', { name: '收起键盘', exact: true }).click();
    await expect(page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '撤销杠铃深蹲第1组', exact: true })).toHaveCount(0);
  } finally { await page.close(); native.close(); }
});

test('native panned history keeps fixed navigation and the entire last card visible', async ({ page }, testInfo) => {
  const native = await bridge(page);
  try {
    await page.setViewportSize({ width: 390, height: 852 });
    await start(page);
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('40');
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await page.getByRole('button', { name: '提前回顾', exact: true }).click();
    await page.getByLabel('训练感受 / 备注', { exact: true }).fill('关闭键盘后历史卡片应完整可见');
    await page.getByRole('button', { name: '收起键盘', exact: true }).click();
    await page.getByRole('button', { name: '保存训练', exact: true }).click();
    await page.getByRole('button', { name: '进步', exact: true }).click();
    await page.getByRole('button', { name: '训练历史', exact: true }).click();
    await page.locator('html').evaluate(root => {
      root.style.setProperty('--safe-top', '62px');
      root.style.setProperty('--safe-bottom', '34px');
    });
    await page.evaluate(() => {
      // Observed native failure: a keyboard-dismiss pan moves fixed controls
      // up68pt, leaving the nav at675..784 and clipping the last history card.
      // Simulate the OS displacement independently of application positioning.
      Object.defineProperties(window.visualViewport!, {
        height: { configurable: true, value: 784 },
        offsetTop: { configurable: true, value: 68 },
      });
      const style = document.createElement('style');
      style.textContent = '.mobile-nav, dialog.modal { transform: translateY(-68px) !important; animation: none !important; transition: none !important; }';
      document.head.append(style);
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    for (const width of [320, 390]) for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 852 });
      if (await page.locator('html').getAttribute('data-theme') !== theme)
        await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const nav = page.getByRole('navigation', { name: '移动端导航', exact: true });
      await expect.poll(() => nav.evaluate(node => node.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(851);
      await expect.poll(() => nav.evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(853);
      const card = page.getByRole('button', { name: /查看全身基础.*训练明细/ });
      const bounds = await card.boundingBox(), navBounds = await nav.boundingBox();
      expect(bounds).not.toBeNull(); expect(navBounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(62);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(navBounds!.y - 16);
      await page.screenshot({ path: testInfo.outputPath(`native-pan-history-${width}-${theme}.png`), fullPage: false });
      await card.click();
      await expect(page.getByRole('dialog').getByText('关闭键盘后历史卡片应完整可见', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  } finally { await page.close(); native.close(); }
});

test('native viewport diagnostics reconcile focusout before the final snapshot', async ({ page }, testInfo) => {
  const diagnostics: ReturnType<typeof collectIosViewportDiagnostics>[] = [];
  page.on('console', message => {
    const text = message.text();
    if (text.startsWith('JLB_IOS_VIEWPORT ')) diagnostics.push(JSON.parse(text.slice('JLB_IOS_VIEWPORT '.length)));
  });
  const native = await bridge(page);
  try {
    await page.setViewportSize({ width: 390, height: 852 });
    await page.goto('/#/settings');
    await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
    const note = page.getByLabel('备注（可选）', { exact: true });
    await note.focus();
    await note.fill('PRIVATE-NOTE-FOR-FOCUSOUT-REGRESSION');
    await expect(page.locator('html')).toHaveAttribute('data-ios-input-active', 'true');
    const enabled = testInfo.config.metadata.inputDiagnostics === true;
    if (enabled) await expect.poll(() => diagnostics.at(-1)?.inputActive).toBe(true);
    await note.evaluate(field => field.blur());
    await expect(page.locator('html')).not.toHaveAttribute('data-ios-input-active', 'true');
    if (enabled) await expect.poll(() => diagnostics.at(-1)?.inputActive).toBe(false);
    else expect(diagnostics).toEqual([]);
    expect(JSON.stringify(diagnostics)).not.toContain('PRIVATE-NOTE');
    expect(JSON.stringify(diagnostics)).not.toContain('备注');
  } finally { await page.close(); native.close(); }
});

test('native long history dialog keeps its close control inside the safe area', async ({ page }) => {
  const native = await bridge(page);
  try {
    await page.setViewportSize({ width: 390, height: 852 });
    await start(page);
    await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('40');
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    await page.getByRole('button', { name: '提前回顾', exact: true }).click();
    await page.getByLabel('训练感受 / 备注', { exact: true }).fill('辅助条不应重复这段训练备注');
    await expect(page.locator('[data-ios-input-accessory] .ios-input-label')).toHaveText('训练感受 / 备注');
    await page.getByRole('button', { name: '收起键盘', exact: true }).click();
    await page.getByRole('button', { name: '保存训练', exact: true }).click();
    await page.getByRole('button', { name: '进步', exact: true }).click();
    await page.getByRole('button', { name: '训练历史', exact: true }).click();
    await page.locator('html').evaluate(root => {
      root.style.setProperty('--safe-top', '62px');
      root.style.setProperty('--safe-bottom', '34px');
    });
    await page.evaluate(() => {
      // The native close moved y20->y88 after the OS consumed the status-bar
      // tap: reproduce the 68px top-layer pan, even with the keyboard hidden.
      Object.defineProperties(window.visualViewport!, {
        height: { configurable: true, value: 784 },
        offsetTop: { configurable: true, value: 68 },
      });
      const style = document.createElement('style');
      style.textContent = 'dialog.modal { transform: translateY(-68px) !important; animation: none !important; transition: none !important; }';
      document.head.append(style);
      window.visualViewport!.dispatchEvent(new Event('resize'));
    });
    for (const width of [320, 390]) for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: 852 });
      if (await page.locator('html').getAttribute('data-theme') !== theme)
        await page.getByRole('button', { name: '切换主题', exact: true }).click();
      await page.getByRole('button', { name: /查看全身基础.*训练明细/ }).click();
      const dialog = page.getByRole('dialog');
      const close = page.getByRole('button', { name: '关闭弹窗', exact: true });
      // Reproduce the long native detail layout independently of the browser's
      // more compact table rendering; only stress the transient scroll content.
      await dialog.locator('.modal-body').evaluate(body => {
        const continuation = document.createElement('div');
        continuation.style.height = '1800px';
        continuation.textContent = '长训练详情滚动区域回归';
        body.append(continuation);
      });
      await close.focus();
      await expect(page.locator('html')).not.toHaveAttribute('data-ios-input-active', 'true');
      await expect.poll(() => close.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(62);
      await expect.poll(() => dialog.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(73);
      await expect.poll(() => dialog.evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(739);
      await close.click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: '今天', exact: true })).toBeEnabled();
    }
  } finally { await page.close(); native.close(); }
});
