import { expect, test } from '@playwright/test';
import { storedWorkspace } from './helpers';

async function ready(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
}

test('训练进度通过scaleX变化，完成和撤销的数据仍即时保存', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
  await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
  expect(await page.locator('.progress-fill').evaluate((element) => (element as HTMLElement).style.width)).toBe('');
  await page.getByLabel('杠铃深蹲第1组总重量', { exact: true }).fill('60');
  await expect.poll(async () => (await storedWorkspace(page)).sessions[0]?.exercises[0].sets[0].weightKg).toBe(60);
  await page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await expect
    .poll(() =>
      page.locator('.progress-fill').evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '撤销杠铃深蹲第1组', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
});

test('弹窗关闭保留短退出，控件inert并在所有关闭入口恢复焦点', async ({ page }) => {
  await ready(page);
  const before = await storedWorkspace(page);
  const trigger = page.getByRole('button', { name: '开始今天的训练', exact: true });
  await trigger.click();
  const closing = await page.getByRole('button', { name: '关闭弹窗', exact: true }).evaluate(async (button) => {
    const dialog = button.closest('dialog')!;
    (button as HTMLButtonElement).click();
    await Promise.resolve();
    return {
      state: dialog.dataset.motionState,
      inert: [...dialog.querySelectorAll('.modal-header,.modal-body,.modal-footer')].every(
        (element) => (element as HTMLElement).inert,
      ),
    };
  });
  expect(closing).toEqual({ state: 'exiting', inert: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('button', { name: '暂不开始', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await trigger.click();
  await page.mouse.click(2, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await storedWorkspace(page)).toEqual(before);
});

test('讲解退出交接开始训练弹窗，不丢失新弹窗焦点或重复开练', async ({ page }) => {
  await page.goto('/#/exercises');
  await page.getByLabel('搜索动作', { exact: true }).fill('杠铃深蹲');
  await page.getByRole('button', { name: '查看杠铃深蹲讲解', exact: true }).click();
  await page.getByRole('button', { name: '从这个动作开练', exact: true }).click();
  const confirm = page.getByRole('button', { name: '确认开始训练', exact: true });
  await expect(confirm).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('dialog')?.textContent?.includes('确认开始训练')))
    .toBe(true);
  await confirm.click();
  await expect(page).toHaveURL(/#\/workout$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await storedWorkspace(page)).sessions.filter((session) => session.status === 'active')).toHaveLength(1);
});

test('弹窗退出立即释放底层输入，销毁时不抢搜索框焦点', async ({ page }) => {
  await page.goto('/#/exercises');
  const search = page.getByLabel('搜索动作', { exact: true });
  await search.fill('杠铃深蹲');
  const before = await storedWorkspace(page);
  await page.getByRole('button', { name: '查看杠铃深蹲讲解', exact: true }).click();
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await search.fill('哑铃');
  await expect(search).toHaveValue('哑铃');
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(search).toBeFocused();
  expect(await storedWorkspace(page)).toEqual(before);
});

test('退出期间重新打开编辑器建立新模态并清空取消的草稿', async ({ page }) => {
  await page.goto('/#/plans');
  const trigger = page.getByRole('button', { name: '新建模板', exact: true });
  await trigger.click();
  await page.getByLabel('模板名称', { exact: true }).fill('取消的草稿');
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await trigger.click();
  await expect(page.getByLabel('模板名称', { exact: true })).toHaveValue('');
  expect(await page.getByRole('dialog').evaluate((element) => element.matches(':modal'))).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
});

test('View Transitions缺失时有淡入降级，快速导航最终页面和hash一致', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true });
  });
  await ready(page);
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('button', { name: '计划', exact: true })
    .click();
  const hasFade = await page
    .locator('.topbar h1')
    .evaluate((element) =>
      element
        .getAnimations()
        .some((animation) =>
          animation.effect instanceof KeyframeEffect &&
          animation.effect.getKeyframes().some((frame) => frame.opacity !== undefined),
        ),
    );
  expect(hasFade).toBe(true);
  await page.locator('.sidebar-nav').evaluate((nav) => {
    const buttons = [...nav.querySelectorAll('button')];
    buttons[2].click();
    buttons[4].click();
    buttons[3].click();
  });
  await expect(page).toHaveURL(/#\/progress$/);
  await expect(page.getByRole('heading', { name: '训练档案', exact: true })).toBeVisible();
  await expect(page.locator('main')).toBeFocused();
});

test('View Transitions创建抛错时仍淡入降级', async ({ page }) => {
  await page.addInitScript(() => {
    document.startViewTransition = () => {
      throw new Error('native transition unavailable');
    };
  });
  await ready(page);
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('button', { name: '计划', exact: true })
    .click();
  expect(
    await page
      .locator('.topbar h1')
      .evaluate((element) =>
        element
          .getAnimations()
          .some((animation) =>
            animation.effect instanceof KeyframeEffect &&
            animation.effect.getKeyframes().some((frame) => frame.opacity !== undefined),
          ),
      ),
  ).toBe(true);
});

test('原生转场按标题、说明和真实主操作编排', async ({ page }) => {
  await page.addInitScript(() => {
    const native = document.startViewTransition.bind(document);
    document.startViewTransition = (callback) => {
      const transition = native(callback);
      void transition.ready
        .then(() => {
          (window as unknown as { parts: unknown }).parts = {
            title: getComputedStyle(document.documentElement, '::view-transition-new(page-title)').animationDelay,
            subtitle: getComputedStyle(document.documentElement, '::view-transition-new(page-subtitle)').animationDelay,
            action: getComputedStyle(document.documentElement, '::view-transition-new(page-action)').animationDelay,
            actionText: document.querySelector('[data-motion-part="action"]')?.textContent?.trim(),
          };
        })
        .catch(() => {});
      return transition;
    };
  });
  await ready(page);
  await page
    .getByRole('navigation', { name: '主导航', exact: true })
    .getByRole('button', { name: '计划', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { parts: unknown }).parts))
    .toEqual({
      title: '0s',
      subtitle: '0.02s',
      action: '0.06s',
      actionText: '新建模板',
    });
});

test('原生View Transitions快速连续导航不拦截操作，浏览器返回仍可用', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const nav = page.getByRole('navigation', { name: '主导航', exact: true });
  for (const name of ['计划', '动作', '我', '进步']) await nav.getByRole('button', { name, exact: true }).click();
  await expect(page).toHaveURL(/#\/progress$/);
  await expect(page.getByRole('heading', { name: '训练档案', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByLabel('重量单位', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('窄屏长页滚动后导航按新页面首屏选择说明和主操作', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const nav = page.getByRole('navigation', { name: '移动端导航', exact: true });
  for (const [destination, action] of [
    ['今天', '开始今天的训练'],
    ['计划', '新建模板'],
  ]) {
    await nav.getByRole('button', { name: '动作', exact: true }).click();
    await expect(page.locator('.movement-card').first()).toBeVisible();
    await page.evaluate(() => scrollTo(0, 1800));
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1000);
    await nav.getByRole('button', { name: destination, exact: true }).click();
    await expect(page.locator('[data-motion-part="action"]')).toHaveText(action);
    await expect(page.locator('[data-motion-part="subtitle"]')).toHaveCount(1);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  }
});

test('reduced-motion保留颜色反馈，运行中切换不残留缩放', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const button = page.getByRole('button', { name: '开始今天的训练', exact: true });
  const styles = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      property: style.transitionProperty,
      durations: style.transitionDuration.split(',').map((value) => Number.parseFloat(value) * 1000),
    };
  });
  expect(styles.property).toContain('background-color');
  expect(styles.property).not.toContain('transform');
  expect(styles.durations.every((duration) => duration > 0 && duration <= 140)).toBe(true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await button.hover();
  await page.mouse.down();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await button.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  await page.mouse.up();
});

test('筛选列表只错峰前六项，含自身时长不超过300ms且不首次编排', async ({ page }) => {
  await page.goto('/#/exercises');
  await expect(page.locator('.movement-card').first()).toBeVisible();
  expect(
    await page
      .locator('.movement-card')
      .evaluateAll((elements) => elements.some((element) => element.getAnimations().length > 0)),
  ).toBe(false);
  await page.getByLabel('搜索动作', { exact: true }).evaluate((input) => {
    input.addEventListener(
      'input',
      () =>
        requestAnimationFrame(() => {
          (window as unknown as { motionSample: unknown }).motionSample = [
            ...document.querySelectorAll('.movement-card'),
          ].map((element) =>
            element.getAnimations().map((animation) => ({
              duration: Number(animation.effect?.getTiming().duration),
              delay: animation.effect?.getTiming().delay ?? 0,
            })),
          );
        }),
      { once: true },
    );
  });
  await page.getByLabel('搜索动作', { exact: true }).fill('哑铃');
  const sample = await page.evaluate(
    () => (window as unknown as { motionSample: { duration: number; delay: number }[][] }).motionSample,
  );
  expect(sample.slice(0, 6).every((animations) => animations.length === 1)).toBe(true);
  expect(sample.slice(6).every((animations) => animations.length === 0)).toBe(true);
  expect(sample.flat().every((animation) => animation.duration + animation.delay <= 300)).toBe(true);
});

test('四边安全区覆盖主区、导航和弹窗，横屏不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const original = await page.locator('main').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(Number.parseFloat);
  });
  await page.addStyleTag({
    content: ':root { --safe-top:24px; --safe-bottom:20px; --safe-left:12px; --safe-right:16px; }',
  });
  const values = await page.locator('main').evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(Number.parseFloat);
  });
  expect(values).toEqual([original[0] + 24, original[1] + 16, original[2] + 20, original[3] + 12]);
  await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(12);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390 - 16);
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('安全区内跳过链接保持隐藏，横屏侧栏五个入口可滚动到达', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.addStyleTag({
    content: ':root { --safe-top:44px; --safe-bottom:20px; --safe-left:44px; --safe-right:44px; }',
  });
  expect(
    (await page.locator('.skip-link').boundingBox())!.y + (await page.locator('.skip-link').boundingBox())!.height,
  ).toBeLessThanOrEqual(0);
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.locator('.skip-link')).toBeInViewport();
  await page.keyboard.press('Tab');
  await page.setViewportSize({ width: 844, height: 390 });
  for (const button of await page.locator('.sidebar-nav button').all()) {
    await button.scrollIntoViewIfNeeded();
    const rect = (await button.boundingBox())!;
    expect(rect.y).toBeGreaterThanOrEqual(44);
    expect(rect.y + rect.height).toBeLessThanOrEqual(390 - 20);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
