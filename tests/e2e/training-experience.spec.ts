import { expect, test, type Page } from '@playwright/test';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise } from '../../src/domain/training';
import { storedWorkspace, expectPersisted } from './helpers';
import type { AppData } from '../../src/domain/types';

function fixture(exerciseId = 'ex-squat') {
  const data = createInitialData();
  const exercise = data.exercises.find((exercise) => exercise.id === exerciseId)!;
  data.templates[0].items = [{ id: 'test-item', exerciseId, sets: 3, weightKg: 0, reps: 10, durationSeconds: 30 }];
  data.templates[0].restSeconds = 10;
  const history = createSession(null, data.exercises, Date.parse('2026-10-16T02:00:00Z'));
  history.status = 'completed';
  history.finishedAt = '2026-10-16T02:40:00.000Z';
  history.updatedAt = history.finishedAt;
  history.exercises = [createSessionExercise(exercise, 2, 60, 8, 50)];
  history.exercises[0].sets[0].status = 'completed';
  history.exercises[0].sets[1] = {
    ...history.exercises[0].sets[1],
    type: 'warmup',
    status: 'completed',
    weightKg: 200,
    reps: 20,
    durationSeconds: 120,
  };
  data.sessions = [history];
  data.onboarded = true;
  return data;
}
async function install(page: Page, data: AppData) {
  await page.clock.install({ time: new Date('2026-10-17T06:00:00Z') });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
  await page.evaluate(
    (data) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('jianlibao', 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('workspace', 'readwrite');
          tx.objectStore('workspace').put(data, 'main');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    data,
  );
  await page.reload();
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
}
async function start(page: Page) {
  await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
  await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
}

async function observeAlerts(page: Page) {
  await page.addInitScript(() => {
    const observed = { audio: 0, vibration: 0 };
    (window as unknown as { observedAlerts: typeof observed }).observedAlerts = observed;
    class AudioStub {
      state = 'running';
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
      addEventListener() {}
      removeEventListener() {}
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            linearRampToValueAtTime(value: number) {
              if (value > 0) observed.audio++;
            },
          },
          connect() {},
          disconnect() {},
        };
      }
      createOscillator() {
        return {
          frequency: { setValueAtTime() {} },
          connect() {},
          disconnect() {},
          start() {},
          stop() {},
          onended: null,
        };
      }
    }
    Object.defineProperty(window, 'AudioContext', { value: AudioStub, configurable: true });
    Object.defineProperty(navigator, 'vibrate', {
      value: (pattern: number | number[]) => {
        if (Array.isArray(pattern) && pattern.some((value) => value > 0)) observed.vibration++;
        return true;
      },
      configurable: true,
    });
  });
}
async function alertCounts(page: Page) {
  return page.evaluate(
    () => (window as unknown as { observedAlerts: { audio: number; vibration: number } }).observedAlerts,
  );
}

test('休息结束声音震动仅一次，延长取消旧截止', async ({ page }) => {
  await observeAlerts(page);
  await install(page, fixture());
  await start(page);
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await page.getByRole('button', { name: '+30 秒', exact: true }).click();
  await page.clock.fastForward(11_000);
  expect(await alertCounts(page)).toEqual({ audio: 0, vibration: 0 });
  await page.clock.fastForward(30_000);
  await expect.poll(() => alertCounts(page)).toEqual({ audio: 1, vibration: 1 });
  await expect(page.locator('.toast')).toContainText('休息结束');
  await page.clock.fastForward(10_000);
  expect(await alertCounts(page)).toEqual({ audio: 1, vibration: 1 });
});

test('提醒开关可关闭，跳过和暂停不会误提醒', async ({ page }) => {
  await observeAlerts(page);
  await install(page, fixture());
  await start(page);
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await page.getByRole('button', { name: '跳过休息', exact: true }).click();
  await page.clock.fastForward(11_000);
  expect(await alertCounts(page)).toEqual({ audio: 0, vibration: 0 });
  await page.getByRole('button', { name: '完成杠铃深蹲第2组', exact: true }).click();
  await page.getByRole('button', { name: '暂停训练', exact: true }).click();
  await page.clock.fastForward(11_000);
  expect(await alertCounts(page)).toEqual({ audio: 0, vibration: 0 });
  await page.getByRole('button', { name: '继续训练', exact: true }).click();
  await page.getByText('休息提醒设置', { exact: true }).click();
  await page.getByRole('button', { name: '声音提醒', exact: true }).click();
  await page.getByRole('button', { name: '震动提醒', exact: true }).click();
  await page.getByRole('button', { name: '完成杠铃深蹲第3组', exact: true }).click();
  await page.clock.fastForward(11_000);
  await expect(page.locator('.toast')).toContainText('休息结束');
  expect(await alertCounts(page)).toEqual({ audio: 0, vibration: 0 });
});

test('无声音震动API仍显示休息结束且不破坏记录', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await install(page, fixture());
  await start(page);
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await page.clock.fastForward(11_000);
  await expect(page.locator('.toast')).toContainText('休息结束');
  await expectPersisted(page, (data) => data.sessions.at(-1)!.exercises[0].sets[0].status === 'completed');
  expect(errors).toEqual([]);
});

test('历史最后正式组预填待确认，刷新不覆盖已编辑草稿或历史', async ({ page }) => {
  const data = fixture();
  await install(page, data);
  await start(page);
  const weight = page.getByLabel('杠铃深蹲第1组总重量', { exact: true });
  await expect(weight).toHaveValue('60');
  await expect(page.getByLabel('杠铃深蹲第1组次数', { exact: true })).toHaveValue('8');
  await expect(page.getByText('待完成组为建议值，确认后才计入记录。', { exact: true })).toBeVisible();
  await weight.fill('67.5');
  await expectPersisted(page, (d) => d.sessions.at(-1)!.exercises[0].sets[0].weightKg === 67.5);
  await page.reload();
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('67.5');
  const saved = await storedWorkspace(page);
  expect(saved.sessions[0]).toEqual(data.sessions[0]);
  expect(saved.sessions.at(-1)!.exercises[0].sets.every((set) => set.status === 'pending')).toBe(true);
});

test('增加一组优先本次实际成绩，复制上一组只填数值不完成', async ({ page }) => {
  await install(page, fixture());
  await start(page);
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('70');
  await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('6');
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await page.getByRole('button', { name: '增加一组', exact: true }).click();
  await expect(page.getByLabel('杠铃深蹲第4组总重量', { exact: true })).toHaveValue('70');
  await expect(page.getByLabel('杠铃深蹲第4组次数', { exact: true })).toHaveValue('6');
  await page.getByRole('button', { name: '复制杠铃深蹲第1组到第2组', exact: true }).click();
  await expect(page.getByLabel('杠铃深蹲第2组总重量', { exact: true })).toHaveValue('70');
  const saved = await storedWorkspace(page);
  expect(saved.sessions.at(-1)!.exercises[0].sets[1].status).toBe('pending');
  expect(saved.sessions.at(-1)!.exercises[0].sets[3].status).toBe('pending');
});

test('kg重量次数快调有界，完成与暂停时不可改', async ({ page }) => {
  await install(page, fixture());
  await start(page);
  const plus = page.getByRole('button', { name: '增加杠铃深蹲第1组总重量', exact: true });
  const minus = page.getByRole('button', { name: '减少杠铃深蹲第1组总重量', exact: true });
  await plus.click();
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('62.5');
  await minus.click();
  await expect(page.getByLabel('杠铃深蹲第1组总重量', { exact: true })).toHaveValue('60');
  await page.getByRole('button', { name: '增加杠铃深蹲第1组次数', exact: true }).click();
  await expect(page.getByLabel('杠铃深蹲第1组次数', { exact: true })).toHaveValue('9');
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('0');
  await expect(minus).toBeDisabled();
  await page.getByLabel('杠铃深蹲第1组次数', { exact: true }).fill('1');
  await expect(page.getByRole('button', { name: '减少杠铃深蹲第1组次数', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await expect(plus).toBeDisabled();
  await page.getByRole('button', { name: '暂停训练', exact: true }).click();
  await expect(page.getByRole('button', { name: '增加杠铃深蹲第2组总重量', exact: true })).toBeDisabled();
});

test('lb快调5lb，原始kg与历史不因单位转换重写', async ({ page }) => {
  const data = fixture();
  data.settings.unit = 'lb';
  await install(page, data);
  await start(page);
  const weight = page.getByLabel('杠铃深蹲第1组总重量', { exact: true });
  await expect(weight).toHaveValue('132.28');
  await page.getByRole('button', { name: '增加杠铃深蹲第1组总重量', exact: true }).click();
  await expect(weight).toHaveValue('137.28');
  await page.getByRole('button', { name: '减少杠铃深蹲第1组总重量', exact: true }).click();
  await expect(weight).toHaveValue('132.28');
  const saved = await storedWorkspace(page);
  expect(saved.sessions[0]).toEqual(data.sessions[0]);
  expect(saved.sessions.at(-1)!.exercises[0].sets[0].weightKg).toBeCloseTo(60, 5);
});

for (const [id, name, field, value] of [
  ['ex-pushup', '俯卧撑', '次数', '8'],
  ['ex-plank', '平板支撑', '时长', '50'],
])
  test(`${field}类沿用实际成绩并支持快调`, async ({ page }) => {
    await install(page, fixture(id));
    await start(page);
    const input = page.getByLabel(`${name}第1组${field}`, { exact: true });
    await expect(input).toHaveValue(value);
    await page.getByRole('button', { name: `增加${name}第1组${field}`, exact: true }).click();
    await expect(input).toHaveValue(String(Number(value) + 1));
  });

for (const width of [320, 390, 768, 1440])
  test(`${width}px训练控件深浅主题均无导航和休息浮层遮挡`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await install(page, fixture());
    await start(page);
    if (width <= 760) await expect(page.getByRole('navigation', { name: '移动端导航', exact: true })).toHaveCount(0);
    if (width <= 760) {
      const firstComplete = (await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).boundingBox())!;
      const scrollArea = (await page.locator('.workout-view').boundingBox())!;
      expect(firstComplete.y + firstComplete.height).toBeLessThanOrEqual(scrollArea.y + scrollArea.height);
    }
    await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: '切换主题', exact: true }).click();
      for (const element of await page
        .locator(
          '.workout-view button:not(:disabled),.workout-view input:not(:disabled),.workout-view select:not(:disabled)',
        )
        .all()) {
        if (!(await element.isVisible())) continue;
        await element.scrollIntoViewIfNeeded();
        expect(
          await element.evaluate((element) => {
            const r = element.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            return element === hit || element.contains(hit);
          }),
        ).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      if (width <= 760) {
        const content = (await page.locator('.workout-view').boundingBox())!;
        const panel = (await page.locator('.rest-panel').boundingBox())!;
        expect(content.y + content.height).toBeLessThanOrEqual(panel.y);
      }
      await page.screenshot({ path: info.outputPath(`training-${width}-${theme}.png`) });
    }
  });

test('短视口与非零安全区自动收起休息，输入和固定操作可达', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, fixture());
  await start(page);
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await expect(page.getByRole('button', { name: '收起休息面板', exact: true })).toBeVisible();
  await page.addStyleTag({
    content: ':root { --safe-top:24px; --safe-bottom:20px; --safe-left:12px; --safe-right:16px; }',
  });
  await page.setViewportSize({ width: 390, height: 480 });
  await expect(page.getByRole('button', { name: '展开休息面板', exact: true })).toBeVisible();
  const input = page.getByLabel('杠铃深蹲第2组总重量', { exact: true });
  await input.fill('65');
  await input.scrollIntoViewIfNeeded();
  expect(
    await input.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === element || element.contains(hit);
    }),
  ).toBe(true);
  const footer = await page.locator('.workout-footer').boundingBox();
  expect(footer!.x).toBe(0);
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(480);
});

test('空自由训练的休息面板避开底部安全区', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await install(page, fixture());
  await page
    .getByRole('navigation', { name: '移动端导航', exact: true })
    .getByRole('button', { name: '计划', exact: true })
    .click();
  await page.getByRole('button', { name: '直接开始自由训练', exact: true }).click();
  await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
  await page.addStyleTag({
    content: ':root { --safe-top:24px; --safe-bottom:34px; --safe-left:12px; --safe-right:16px; }',
  });
  const bounds = (await page.locator('.rest-panel').boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844 - 34);
  await page.getByRole('button', { name: '添加动作', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('离开训练页后仍收到一次休息提醒，记录保持活动', async ({ page }) => {
  await observeAlerts(page);
  await install(page, fixture());
  await start(page);
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await page.getByRole('button', { name: '返回今天', exact: true }).click();
  await page.clock.fastForward(11_000);
  await expect(page.locator('.toast')).toContainText('休息结束');
  expect(await alertCounts(page)).toEqual({ audio: 1, vibration: 1 });
  expect((await storedWorkspace(page)).sessions.at(-1)!.status).toBe('active');
});
