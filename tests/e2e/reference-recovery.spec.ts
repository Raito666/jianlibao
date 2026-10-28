import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  benchReference,
  REFERENCE_CACHE,
} from "../../src/content/reference-media";
import { MEDIA_CACHE } from "../../src/content/catalog";
import { storedWorkspace } from "./helpers";
import { overflowFindings } from "./overflow-helpers";

const movie = benchReference.assets.find((asset) => asset.kind === "video")!;
const ready = "示范已完整保存，可离线查看";
const save = "保存示范供离线使用";

async function open(page: Page) {
  await page.goto("/#/exercises");
  await page.getByLabel("搜索动作", { exact: true }).fill("杠铃卧推");
  await page
    .getByRole("button", { name: "查看杠铃卧推讲解", exact: true })
    .click();
  await page.getByRole("tab", { name: "详细讲解", exact: true }).click();
  await page.locator(".reference-media > summary").click();
}

async function prepare(page: Page) {
  await page.goto("/#/settings");
  await page.getByLabel("选择健力宝备份文件", { exact: true }).setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: await readFile("tests/fixtures/legacy-v1-ui-backup.json"),
  });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await open(page);
  await page.getByRole("button", { name: save, exact: true }).click();
  await expect(
    page.getByRole("button", { name: ready, exact: true }),
  ).toBeVisible();
}

async function evict(page: Page) {
  expect(
    await page.evaluate(
      async ({ name, url }) => (await caches.open(name)).delete(url),
      { name: REFERENCE_CACHE, url: movie.url },
    ),
  ).toBe(true);
}

async function play(page: Page) {
  await page
    .getByRole("button", { name: "加载卧推视频 · 1.4 MB", exact: true })
    .click();
  const video = page.getByLabel("杠铃卧推实拍示范", { exact: true });
  await Promise.all([
    video.evaluate((v: HTMLVideoElement) => v.play()),
    (async () => {
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
        .toBeGreaterThanOrEqual(2);
    })(),
  ]); // Explicit playback shares the original readiness deadline.
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.15);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
}

for (const width of [320, 390, 768, 1440])
  for (const theme of ["dark", "light"]) {
    test(`${width}px ${theme}：焦点恢复事件发现已保存视频被移除，可重存且不丢训练`, async ({
      page,
      context,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await prepare(page);
      await page.getByRole("button", { name: "关闭弹窗", exact: true }).click();
      await page.goto("/#/settings");
      await page.getByLabel("界面主题", { exact: true }).selectOption(theme);
      await open(page);
      await expect(
        page.getByRole("button", { name: ready, exact: true }),
      ).toBeVisible();
      const before = await storedWorkspace(page);
      const svg = await page.evaluate(
        async (name) =>
          (await (await caches.open(name)).keys()).map((r) => r.url),
        MEDIA_CACHE,
      );
      await evict(page);
      // Headless Chromium does not reliably mark background tabs hidden.
      // Exercise the real focus listener with an explicit DOM event instead;
      // CacheStorage, Worker, UI, playback and persistence stay real.
      await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
      await expect(
        page.getByRole("button", { name: save, exact: true }),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: ready, exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".reference-offline")).toContainText(
        "已校验 2 / 3",
      );
      await page.locator(".reference-offline").scrollIntoViewIfNeeded();
      expect(await overflowFindings(page)).toEqual([]);
      await page.screenshot({
        path: info.outputPath("evicted-not-ready.png"),
        animations: "disabled",
      });
      await page.getByRole("button", { name: save, exact: true }).click();
      await expect(
        page.getByRole("button", { name: ready, exact: true }),
      ).toBeVisible();
      await context.setOffline(true);
      await play(page);
      await expect(
        page.getByAltText("杠铃卧推第1幅动作图解", { exact: true }),
      ).toHaveJSProperty("naturalWidth", 512);
      expect(await storedWorkspace(page)).toEqual(before);
      const after = await page.evaluate(
        async (name) =>
          (await (await caches.open(name)).keys()).map((r) => r.url),
        MEDIA_CACHE,
      );
      expect(svg.every((url) => after.includes(url))).toBe(true);
      await page.locator(".reference-offline").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath("restored-offline-ready.png"),
        animations: "disabled",
      });
    });
  }

test("缓存移除后的离线读取失败会撤销就绪状态，恢复网络可重试并完整保存", async ({
  page,
  context,
}) => {
  await prepare(page);
  const before = await storedWorkspace(page);
  await page.evaluate(() => {
    window.addEventListener(
      "offline",
      () =>
        document.documentElement.setAttribute("data-recovery-offline", "seen"),
      { once: true },
    );
  });
  await context.setOffline(true);
  // Let the network event finish while the cache is still intact. Only the
  // subsequent real media error can discover this eviction.
  await expect(page.locator("html")).toHaveAttribute(
    "data-recovery-offline",
    "seen",
  );
  await expect(page.locator(".reference-offline")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(
    page.getByRole("button", { name: ready, exact: true }),
  ).toBeVisible();
  await evict(page);
  await page
    .getByRole("button", { name: "加载卧推视频 · 1.4 MB", exact: true })
    .click();
  await expect(
    page.getByText("视频暂不可用，仍可查看上方三帧图解和中文讲解。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: save, exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: ready, exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: save, exact: true }).click();
  await expect(page.locator(".reference-offline [role=alert]")).toContainText(
    "未完整保存",
  );
  await expect(
    page.getByRole("button", { name: save, exact: true }),
  ).toBeEnabled();
  await context.setOffline(false);
  await page
    .getByRole("button", { name: "重新加载示范视频", exact: true })
    .click();
  const video = page.getByLabel("杠铃卧推实拍示范", { exact: true });
  await Promise.all([
    video.evaluate((v: HTMLVideoElement) => v.play()),
    (async () => {
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
        .toBeGreaterThanOrEqual(2);
    })(),
  ]); // Explicit playback shares the original readiness deadline.
  await page.getByRole("button", { name: save, exact: true }).click();
  await expect(
    page.getByRole("button", { name: ready, exact: true }),
  ).toBeVisible();
  expect(await storedWorkspace(page)).toEqual(before);
});

test("视频被同MIME同长度坏字节替换时，网络恢复会重新校验SHA并允许修复", async ({
  page,
  context,
}) => {
  await prepare(page);
  await context.setOffline(true);
  await page.evaluate(
    async ({ name, url }) => {
      const cache = await caches.open(name),
        response = await cache.match(url);
      const bytes = new Uint8Array(await response!.arrayBuffer());
      bytes[1024] ^= 1;
      await cache.put(
        url,
        new Response(bytes, { headers: { "Content-Type": "video/mp4" } }),
      );
    },
    { name: REFERENCE_CACHE, url: movie.url },
  );
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: save, exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".reference-offline")).toContainText(
    "已校验 2 / 3",
  );
  await page.getByRole("button", { name: save, exact: true }).click();
  await expect(
    page.getByRole("button", { name: ready, exact: true }),
  ).toBeVisible();
});

test("整个媒体缓存桶丢失后可重新保存，已有SVG和训练仍保留", async ({
  page,
}) => {
  await prepare(page);
  const before = await storedWorkspace(page);
  expect(
    await page.evaluate(async (name) => caches.delete(name), REFERENCE_CACHE),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
  await expect(
    page.getByRole("button", { name: save, exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".reference-offline")).toContainText(
    "已校验 0 / 3",
  );
  await expect(
    page.getByAltText("杠铃卧推第1幅动作图解", { exact: true }),
  ).toHaveJSProperty("naturalWidth", 512);
  await page.getByRole("button", { name: save, exact: true }).click();
  await expect(
    page.getByRole("button", { name: ready, exact: true }),
  ).toBeVisible();
  expect(await storedWorkspace(page)).toEqual(before);
});

test.describe("保存中状态保护", () => {
  test.use({ serviceWorkers: "block" });
  test("保存期间已校验图片被移除，结束时必须重新核对而非误报完整", async ({
    page,
  }) => {
    let unblock!: () => void;
    const held = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let videoRequests = 0;
    await page.route(`**${movie.url}`, async (route) => {
      if (++videoRequests === 1) await held;
      await route.continue().catch(() => {});
    });
    try {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "开始今天的训练", exact: true })).toBeEnabled();
      const before = await storedWorkspace(page);
      await open(page);
      await page.getByRole("button", { name: save, exact: true }).click();
      const progress = page.getByRole("button", {
        name: "正在保存示范 2 / 3",
        exact: true,
      });
      await expect(progress).toBeVisible();
      await expect.poll(() => videoRequests).toBe(1);
      expect(
        await page.evaluate(
          async ({ name, url }) => (await caches.open(name)).delete(url),
          { name: REFERENCE_CACHE, url: benchReference.assets[0].url },
        ),
      ).toBe(true);
      await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
      await expect(progress).toBeVisible();
      unblock();
      await expect(
        page.getByRole("button", { name: save, exact: true }),
      ).toBeEnabled();
      await expect(page.locator(".reference-offline")).toContainText(
        "已校验 2 / 3",
      );
      await expect(
        page.getByRole("button", {
          name: "示范文件已校验，离线服务未就绪",
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: save, exact: true }).click();
      await expect(
        page.getByRole("button", {
          name: "示范文件已校验，离线服务未就绪",
          exact: true,
        }),
      ).toBeVisible();
      expect(await storedWorkspace(page)).toEqual(before);
    } finally {
      unblock?.();
    }
  });
  test("焦点和网络事件不打断保存，关闭重开也不会被旧请求覆盖", async ({
    page,
  }) => {
    let unblock!: () => void;
    const held = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let videoRequests = 0;
    await page.route(`**${movie.url}`, async (route) => {
      videoRequests++;
      if (videoRequests === 1) await held;
      await route.continue().catch(() => {});
    });
    try {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "开始今天的训练", exact: true })).toBeEnabled();
      const before = await storedWorkspace(page);
      await open(page);
      await page.getByRole("button", { name: save, exact: true }).click();
      await expect(
        page.getByRole("button", { name: "正在保存示范 2 / 3", exact: true }),
      ).toBeVisible();
      await expect.poll(() => videoRequests).toBe(1);
      await page.evaluate(() => {
        window.dispatchEvent(new FocusEvent("focus"));
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new Event("offline"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect(
        page.getByRole("button", { name: "正在保存示范 2 / 3", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "暂停保存示范", exact: true }),
      ).toBeEnabled();
      await page.locator(".reference-media > summary").click();
      await page.locator(".reference-media > summary").click();
      await expect(
        page.getByRole("button", { name: save, exact: true }),
      ).toBeEnabled();
      await expect(page.locator(".reference-offline")).toContainText(
        "已校验 2 / 3",
      );
      unblock();
      await page.getByRole("button", { name: save, exact: true }).click();
      await expect(
        page.getByRole("button", {
          name: "示范文件已校验，离线服务未就绪",
          exact: true,
        }),
      ).toBeVisible();
      expect(await storedWorkspace(page)).toEqual(before);
      await expect(
        page.getByRole("button", { name: ready, exact: true }),
      ).toHaveCount(0);
    } finally {
      unblock?.();
    }
  });
});
