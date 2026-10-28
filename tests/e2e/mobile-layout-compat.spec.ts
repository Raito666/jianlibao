import { expect, test } from '@playwright/test';

const phones = [
  { name: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Mobile/15E148 Safari/604.1' },
  { name: 'Android', userAgent: 'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.210 Mobile Safari/537.36' },
];

for (const phone of phones) {
  for (const width of [320, 390, 430]) {
    test.describe(`${phone.name} ${width}px 兼容媒体查询`, () => {
      test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, userAgent: phone.userAgent });

      test('旧媒体查询能力下仍是手机版，五导航和身体表单可用', async ({ page }) => {
        // Model the specified behavior of engines without MQ4 range support:
        // unsupported queries never match. Current production CSS must therefore
        // keep its responsive rules usable without those queries.
        await page.route('**/*.css', async route => {
          const response = await route.fetch();
          const css = await response.text();
          await route.fulfill({ response, body: css.replace(/@media[^{}]*[<>][^{}]*\{/g, '@media not all{') });
        });
        await page.goto('/');
        await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
        await expect(page.locator('.sidebar')).toBeHidden();
        const navigation = page.getByRole('navigation', { name: '移动端导航', exact: true });
        await expect(navigation).toBeVisible();
        await expect(navigation.getByRole('button')).toHaveCount(5);
        for (let index = 0; index < 5; index++) {
          const button = navigation.getByRole('button').nth(index);
          const size = await button.boundingBox();
          expect(size).not.toBeNull();
          expect(size!.width).toBeGreaterThanOrEqual(44);
          expect(size!.height).toBeGreaterThanOrEqual(44);
          await button.click();
          await expect(button).toHaveClass(/(?:^| )active(?: |$)/);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
        await page.getByRole('button', { name: '记录身体数据', exact: true }).click();
        const weight = page.getByLabel('体重 (kg)', { exact: true });
        expect(await weight.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
        await weight.fill('70');
        await page.getByRole('button', { name: '保存身体记录', exact: true }).click();
        await expect(page.getByRole('button', { name: /编辑.*身体记录/ })).toBeVisible();
      });
    });
  }
}
