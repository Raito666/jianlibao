import { expect, test, type Page } from '@playwright/test';

async function keyboardViewport(page: Page) {
  await page.addInitScript(() => {
    const viewport = window.visualViewport!;
    const original = { height: viewport.height, top: viewport.offsetTop };
    let current: { height: number; top: number } | null = null;
    Object.defineProperties(viewport, {
      height: { configurable: true, get: () => current?.height ?? window.innerHeight },
      offsetTop: { configurable: true, get: () => current?.top ?? original.top },
    });
    Object.assign(window, { setKeyboardViewport: (height: number, top = 0) => {
      current = { height, top };
      viewport.dispatchEvent(new Event('resize'));
      viewport.dispatchEvent(new Event('scroll'));
    } });
  });
}
async function resizeKeyboard(page: Page, height: number, top = 0) {
  await page.evaluate(({ height, top }) => {
    (window as unknown as { setKeyboardViewport: (height: number, top: number) => void }).setKeyboardViewport(height, top);
  }, { height, top });
}
async function visibleField(page: Page, label: string, top: number, bottom: number) {
  const field = page.getByLabel(label, { exact: true });
  await expect.poll(async () => field.evaluate((element, limits) => {
    const box = element.getBoundingClientRect();
    const body = element.closest('.modal-body')?.getBoundingClientRect();
    return box.top >= Math.max(limits.top, body?.top ?? limits.top) - 1
      && box.bottom <= Math.min(limits.bottom, body?.bottom ?? limits.bottom) + 1;
  }, { top, bottom })).toBe(true);
}

for (const width of [320, 390]) for (const theme of ['dark', 'light'] as const) {
  test.describe(`${width}px ${theme} 手机网页键盘`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, colorScheme: theme });
    test.beforeEach(async ({ page }) => {
      await keyboardViewport(page);
      await page.goto('/');
      await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: '切换主题', exact: true }).click();
    });

    test('身体备注及保存按钮完整避开键盘，恢复后记录与导航可用', async ({ page }) => {
      await page.goto('/#/settings');
      await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
      await page.getByLabel('体重 (kg)', { exact: true }).fill('70');
      const note = page.getByLabel('备注（可选）', { exact: true });
      await note.fill('手机键盘避让回归：保留完整备注和训练记录。');
      await resizeKeyboard(page, 340, 16);
      const modal = page.getByRole('dialog');
      await expect.poll(async () => {
        const box = await modal.boundingBox();
        return Boolean(box && box.y >= 16 && box.y + box.height <= 357);
      }).toBe(true);
      await visibleField(page, '备注（可选）', 16, 356);
      await resizeKeyboard(page, 260, 16);
      await visibleField(page, '备注（可选）', 16, 276);
      const save = page.getByRole('button', { name: '保存身体记录', exact: true });
      expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await save.tap();
      await resizeKeyboard(page, 844);
      await expect(page.locator('dialog')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /编辑.*身体记录/ })).toBeVisible();
      await expect(page.locator('.body-records .body-note')).toHaveText('手机键盘避让回归：保留完整备注和训练记录。');
      await expect(page.locator('.body-records .body-note')).toBeVisible();
      await expect(page.getByRole('navigation', { name: '移动端导航', exact: true })).toBeVisible();
      const actions = page.locator('.body-record-actions button');
      const first = (await actions.nth(0).boundingBox())!, second = (await actions.nth(1).boundingBox())!;
      expect(second.x - (first.x + first.width)).toBeGreaterThanOrEqual(8);
    });

    test('训练数值输入避开键盘与固定操作，切换字段保持输入且不自动完成', async ({ page }) => {
      await page.getByRole('button', { name: '开始今天的训练', exact: true }).click();
      await page.getByRole('button', { name: '确认开始训练', exact: true }).click();
      const weight = page.getByLabel('杠铃深蹲第1组总重量', { exact: true });
      await weight.fill('65');
      await resizeKeyboard(page, 340);
      await visibleField(page, '杠铃深蹲第1组总重量', 0, 340);
      const reps = page.getByLabel('杠铃深蹲第1组次数', { exact: true });
      await reps.focus();
      await reps.fill('12');
      await visibleField(page, '杠铃深蹲第1组次数', 0, 340);
      await resizeKeyboard(page, 844);
      await expect(reps).toBeFocused();
      await expect(page.getByRole('button', { name: '下一动作', exact: true })).toBeVisible();
      await reps.blur();
      await expect(weight).toHaveValue('65');
      await expect(reps).toHaveValue('12');
      await expect(page.getByRole('button', { name: '完成杠铃深蹲第1组', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: '撤销完成杠铃深蹲第1组', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '下一动作', exact: true })).toBeVisible();
    });

    test('动作与历史检索可见，收起键盘后讲解、日历与统计仍可触控', async ({ page }) => {
      await page.goto('/#/exercises');
      const search = page.getByLabel('搜索动作', { exact: true });
      await search.fill('杠铃卧推');
      await resizeKeyboard(page, 340, 12);
      await visibleField(page, '搜索动作', 12, 352);
      await search.blur();
      await resizeKeyboard(page, 844);
      await page.getByRole('button', { name: '查看杠铃卧推讲解', exact: true }).tap();
      for (const name of ['简洁讲解', '详细讲解', '我的表现']) {
        const tab = page.getByRole('tab', { name, exact: true });
        await tab.tap();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
      }
      await page.getByRole('button', { name: '关闭弹窗', exact: true }).tap();
      await page.goto('/#/progress');
      const historySearch = page.getByLabel('搜索训练历史', { exact: true });
      await historySearch.fill('不存在的训练键盘筛选');
      await resizeKeyboard(page, 340, 12);
      await visibleField(page, '搜索训练历史', 12, 352);
      await expect(historySearch).toHaveValue('不存在的训练键盘筛选');
      await historySearch.fill('');
      await historySearch.blur();
      await resizeKeyboard(page, 844);
      await page.locator('summary[aria-label="按日期筛选训练"]').tap();
      await page.getByRole('button', { name: '下个月', exact: true }).tap();
      await page.getByRole('button', { name: '上个月', exact: true }).tap();
      await page.getByRole('button', { name: '统计总览', exact: true }).tap();
      await expect(page.getByRole('button', { name: '统计总览', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    });
  });
}
