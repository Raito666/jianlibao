import { expect, test, type Page } from '@playwright/test';
import { createInitialData } from '../../src/domain/seed';
import { createSession, createSessionExercise } from '../../src/domain/training';
import { validateAppData } from '../../src/data/backup';
import { storedWorkspace } from './helpers';

async function openHistory(page: Page, theme: 'dark' | 'light') {
  const data = createInitialData();
  data.onboarded = true;
  data.settings.theme = theme;
  data.sessions = [2, 3, 4].map(day => {
    const date = `2026-10-0${day}`;
    const session = createSession(null, data.exercises, Date.parse(`${date}T06:00:00Z`));
    session.name = `日历回归${day}`;
    session.status = 'completed';
    session.finishedAt = `${date}T06:10:00.000Z`;
    session.updatedAt = session.finishedAt;
    session.exercises = [createSessionExercise(data.exercises.find(ex => ex.id === 'ex-squat')!, 1, 60, 10, 30)];
    session.exercises[0].sets[0].status = 'completed';
    return session;
  });
  validateAppData(data);
  await page.clock.setFixedTime(new Date('2026-10-16T06:00:00Z'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '开始今天的训练', exact: true })).toBeEnabled();
  await page.evaluate(data => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('jianlibao', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(data, 'main');
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), data);
  await page.reload();
  await page.getByRole('navigation', { name: page.viewportSize()!.width <= 760 ? '移动端导航' : '主导航', exact: true }).getByRole('button', { name: '进步', exact: true }).click();
  await expect(page.locator('main')).toHaveAttribute('data-page', 'progress');
  return data.sessions;
}

async function expandCalendar(page: Page) {
  const card = page.locator('.calendar-card');
  await expect(card).toBeVisible();
  if (!(await card.evaluate(el => (el as HTMLDetailsElement).open))) {
    await page.getByLabel('按日期筛选训练', { exact: true }).click();
  }
  await expect(card).toHaveAttribute('open', '');
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' && !a.pending));
}

async function inspectCalendar(page: Page, expectedDays: number) {
  await expandCalendar(page);
  await expect(page.locator('.calendar-day')).toHaveCount(expectedDays);
  const geometry = await page.locator('.calendar-grid').evaluate(grid => {
    grid.scrollLeft = 0;
    const bounds = grid.getBoundingClientRect(), card = grid.closest('.calendar-card')!.getBoundingClientRect();
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, height: r.height };
    };
    return { screenWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
      clientWidth: grid.clientWidth, scrollWidth: grid.scrollWidth,
      left: bounds.left, right: bounds.right, cardLeft: card.left, cardRight: card.right,
      labels: [...grid.querySelectorAll('.calendar-label')].map(rect),
      days: [...grid.querySelectorAll('.calendar-day')].map(rect) };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.screenWidth + 1);
  expect(geometry.labels).toHaveLength(7);
  for (const day of geometry.days) {
    expect(day.width).toBeGreaterThanOrEqual(44);
    expect(day.height).toBeGreaterThanOrEqual(44);
  }
  if (geometry.screenWidth > 760) {
    // Seven complete columns must fit together on tablet/desktop, without scrolling.
    expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.clientWidth + 1);
    for (const rect of [...geometry.labels, ...geometry.days]) {
      expect(rect.left).toBeGreaterThanOrEqual(geometry.left - 1);
      expect(rect.right).toBeLessThanOrEqual(geometry.right + 1);
      expect(rect.left).toBeGreaterThanOrEqual(geometry.cardLeft - 1);
      expect(rect.right).toBeLessThanOrEqual(geometry.cardRight + 1);
    }
  } else {
    // Phones retain the existing controlled horizontal scroll and 44px targets.
    await expect(page.locator('.calendar-grid')).toHaveCSS('overflow-x', 'auto');
  }
  // Check every date, including columns 5–7, through the actual clipping ancestors.
  const issues = await page.locator('.calendar-grid').evaluate(async grid => {
    const issues: string[] = [];
    for (const button of grid.querySelectorAll<HTMLButtonElement>('.calendar-day')) {
      button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      await new Promise(requestAnimationFrame);
      const r = button.getBoundingClientRect(), area = grid.getBoundingClientRect();
      if (r.left < area.left - 1 || r.right > area.right + 1 || r.left < -1 || r.right > innerWidth + 1) issues.push(`clipped:${button.ariaLabel}`);
      // A rounded button's transparent bounding-box corners are not hit targets.
      const inset = Math.max(2, Math.min(parseFloat(getComputedStyle(button).borderRadius) + 1, r.width / 2, r.height / 2));
      for (const [x, y] of [[r.left + inset, r.top + inset], [r.right - inset, r.bottom - inset], [r.left + r.width / 2, r.top + r.height / 2]]) {
        const hit = document.elementFromPoint(x, y);
        if (!button.contains(hit)) issues.push(`covered:${button.ariaLabel}:${x},${y}:${hit?.tagName}.${hit?.className}:radius=${getComputedStyle(button).borderRadius}`);
      }
      for (const text of button.children) {
        const t = text.getBoundingClientRect();
        if (t.left < r.left - 1 || t.right > r.right + 1) issues.push(`text:${button.ariaLabel}`);
      }
    }
    grid.scrollLeft = 0;
    return issues;
  });
  expect(issues).toEqual([]);
  return geometry;
}

for (const width of [320, 390, 768, 1440]) for (const theme of ['dark', 'light'] as const) {
  test(`日历七列完整可见及右侧日期筛选 ${width} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width <= 390 ? 844 : 980 });
    const sessions = await openHistory(page, theme);
    const geometry = await inspectCalendar(page, 31);
    await info.attach('calendar-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
    await page.locator('.calendar-card').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('calendar-october.png'), animations: 'disabled' });
    for (const day of [2, 3, 4]) {
      await expandCalendar(page);
      const button = page.getByRole('button', { name: `2026-10-0${day}，1场训练`, exact: true });
      await button.click();
      if (width <= 760) {
        await expect(page.locator('.calendar-card')).not.toHaveAttribute('open', '');
        await expandCalendar(page);
      }
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.session-card')).toHaveCount(1);
      await expect(page.locator('.session-card')).toContainText(`日历回归${day}`);
    }
    await expandCalendar(page);
    await page.getByRole('button', { name: '下个月', exact: true }).click();
    await expect(page.locator('.calendar-card h3')).toHaveText('2026 年 11 月');
    await inspectCalendar(page, 30); // Sunday-start month needs six complete rows.
    await page.getByRole('button', { name: '上个月', exact: true }).click();
    await page.getByRole('button', { name: '上个月', exact: true }).click();
    await expect(page.locator('.calendar-card h3')).toHaveText('2026 年 09 月');
    await inspectCalendar(page, 30);
    await page.getByRole('button', { name: '回到本月', exact: true }).click();
    await expect(page.locator('.calendar-card h3')).toHaveText('2026 年 10 月');
    expect((await storedWorkspace(page)).sessions).toEqual(sessions);
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`日历断点切换仍保留七列与可操作日期 ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 980 });
    const sessions = await openHistory(page, theme);
    for (const width of [760, 761, 767, 768, 1000, 1001, 1200, 1201, 1440]) {
      await page.setViewportSize({ width, height: 980 });
      await inspectCalendar(page, 31);
    }
    expect((await storedWorkspace(page)).sessions).toEqual(sessions);
  });
}
