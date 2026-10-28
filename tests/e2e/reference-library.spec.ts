import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import decisions from "../fixtures/reviewed-media-decisions.json" with { type: "json" };
import {
  referenceMediaFor,
  REFERENCE_CACHE,
  type ReferenceEntry,
} from "../../src/content/reference-media";
import { storedWorkspace } from "./helpers";
import { overflowFindings } from "./overflow-helpers";

async function open(page: Page, entry: ReferenceEntry) {
  await page.goto("/#/exercises");
  await page.getByLabel("搜索动作", { exact: true }).fill(entry.name!);
  await page
    .getByRole("button", { name: `查看${entry.name}讲解`, exact: true })
    .click();
  await expect
    .poll(() =>
      page
        .locator(".technique-art img")
        .first()
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole("tab", { name: "详细讲解", exact: true }).click();
  await page.locator(".reference-media > summary").click();
}
async function images(page: Page, entry: ReferenceEntry) {
  for (const asset of entry.assets.filter((a) => a.kind === "image")) {
    const image = page.getByAltText(`${entry.name}${asset.label}参考图`, {
      exact: true,
    });
    await image.evaluate(async (element: HTMLImageElement) => {
      element.loading = "eager";
      await element.decode();
    });
    await expect(image).toHaveJSProperty("naturalWidth", asset.width);
    await expect(image).toHaveJSProperty("naturalHeight", asset.height);
  }
}
// Normal viewing can finish caching an image-only entry before the explicit
// save button is reached. Verify the first cached image, then remove only that
// key in this isolated test context, preserving the original save/offline path.
async function prepareExplicitImageSave(page: Page, entry: ReferenceEntry) {
  if (entry.assets.some((asset) => asset.kind === "video")) return;
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const firstImage = entry.assets.find((asset) => asset.kind === "image");
  if (!firstImage) throw new Error("Image-only entry needs a reference image");
  const cached = await page.evaluate(async ({ cacheName, url }) => {
    const cache = await caches.open(cacheName);
    const response = await cache.match(url);
    if (!response) return { sha: null, deleted: false };
    const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
    return {
      sha: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""),
      deleted: await cache.delete(url),
    };
  }, { cacheName: REFERENCE_CACHE, url: firstImage.url });
  expect(cached.sha).toBe(firstImage.sha256);
  expect(cached.deleted).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "保存示范供离线使用", exact: true })).toBeEnabled();
}

async function play(page: Page, entry: ReferenceEntry) {
  const asset = entry.assets.find((a) => a.kind === "video")!;
  await page
    .getByRole("button", {
      name: `加载${entry.name}视频 · ${(asset.bytes / 1_000_000).toFixed(1)} MB`,
      exact: true,
    })
    .click();
  const video = page.getByLabel(`${entry.name}实拍示范`, { exact: true });
  await Promise.all([
    video.evaluate((v: HTMLVideoElement) => v.play()),
    (async () => {
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
        .toBeGreaterThanOrEqual(2);
    })(),
  ]); // Explicit playback shares the original readiness deadline.
  await expect(video).toHaveJSProperty("videoWidth", asset.width);
  await expect(video).toHaveJSProperty("videoHeight", asset.height);
  await expect(video).toHaveJSProperty("autoplay", false);
  await expect(video).toHaveJSProperty("loop", false);
  await expect(video).toHaveJSProperty("muted", true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeCloseTo(
    asset.duration!,
    0,
  );
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.15);
  await video.evaluate((v: HTMLVideoElement) => v.pause());
  return video;
}

for (const decision of decisions) {
  const entry = referenceMediaFor(decision.exerciseId)!;
  test(`${decision.name}：逐资产解码与署名、在线播放、完整保存、离线重开与寻址`, async ({
    page,
    context,
  }, info) => {
    test.setTimeout(60000);
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    const before = await storedWorkspace(page),
      external: string[] = [];
    page.on("request", (r) => {
      if (new URL(r.url()).hostname === "wger.de") external.push(r.url());
    });
    await open(page, entry);
    await images(page, entry);
    const movie = entry.assets.find((a) => a.kind === "video");
    if (movie) {
      const video = await play(page, entry);
      await expect(video).toHaveAttribute(
        "poster",
        entry.assets.find((a) => a.kind === "poster")!.url,
      );
    } else await expect(page.locator(".reference-video")).toHaveCount(0);
    if (!entry.assets.some((a) => a.kind === "image"))
      await expect(page.locator(".reference-images")).toHaveCount(0);
    for (const a of entry.assets.filter((a) => a.kind !== "poster")) {
      await expect(
        page
          .locator(".reference-credit")
          .filter({ hasText: `${a.author} · ${a.license}` })
          .first(),
      ).toBeAttached();
      await expect(
        page
          .locator(".reference-credit a")

          .locator(`xpath=self::*[@href="${a.sourceUrl}"]`)
          .first(),
      ).toBeAttached();
    }
    await prepareExplicitImageSave(page, entry);
    await page
      .getByRole("button", { name: "保存示范供离线使用", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "示范已完整保存，可离线查看",
        exact: true,
      }),
    ).toBeVisible();
    expect(await overflowFindings(page)).toEqual([]);
    await context.setOffline(true);
    await page.reload();
    await open(page, entry);
    await images(page, entry);
    await expect(
      page.getByRole("button", {
        name: "示范已完整保存，可离线查看",
        exact: true,
      }),
    ).toBeVisible();
    for (const a of entry.assets) {
      const saved = await page.evaluate(async (url) => {
        const r = await fetch(url);
        const body = await r.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", body);
        return {
          status: r.status,
          mime: r.headers.get("Content-Type")?.split(";")[0],
          bytes: body.byteLength,
          sha: [...new Uint8Array(digest)]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join(""),
        };
      }, a.url);
      expect(saved).toEqual({
        status: 200,
        mime: a.mime,
        bytes: a.bytes,
        sha: a.sha256,
      });
    }
    if (movie) {
      const video = await play(page, entry),
        target = movie.duration! * 0.6;
      await video.evaluate(
        (v: HTMLVideoElement, time) =>
          new Promise<void>((resolve) => {
            v.addEventListener("seeked", () => resolve(), { once: true });
            v.currentTime = time;
          }),
        target,
      );
      await video.evaluate((v: HTMLVideoElement) => v.play());
      await expect
        .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(target + 0.15);
      await video.evaluate((v: HTMLVideoElement) => v.pause());
      const bytes = await readFile(`public${movie.url}`);
      const range = await page.evaluate(async (url) => {
        const r = await fetch(url, { headers: { Range: "bytes=0-31" } });
        return {
          status: r.status,
          range: r.headers.get("Content-Range"),
          bytes: [...new Uint8Array(await r.arrayBuffer())],
        };
      }, movie.url);
      expect(range).toEqual({
        status: 206,
        range: `bytes 0-31/${movie.bytes}`,
        bytes: [...bytes.subarray(0, 32)],
      });
      await page.locator(".reference-video").scrollIntoViewIfNeeded();
    } else await page.locator(".reference-images").scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((a) => a.playState !== "running" && !a.pending),
    );
    await page.screenshot({
      path: info.outputPath("offline-reviewed-media.png"),
      animations: "disabled",
    });
    expect(await storedWorkspace(page)).toEqual(before);
    expect(external).toEqual([]);
    await info.attach("asset-validation", {
      body: JSON.stringify({
        id: entry.exerciseId,
        assets: entry.assets.length,
        offline: true,
        played: !!movie,
      }),
      contentType: "application/json",
    });
  });
}

for (const width of [320, 390, 768, 1440])
  for (const theme of ["dark", "light"]) {
    test(`${width}px ${theme}：仅图片、仅视频、混合及多图示范完整可用`, async ({
      page,
    }, info) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/#/settings");
      await page.getByLabel("界面主题", { exact: true }).selectOption(theme);
      for (const id of [
        "ex-rdl",
        "catalog-smith-machine-bench-press",
        "catalog-split-squat",
        "catalog-hack-squat",
        "catalog-wall-sit",
        "catalog-single-leg-romanian-deadlift",
        "catalog-bench-dip",
        "catalog-heel-elevated-goblet-squat",
        "catalog-bird-dog",
        "catalog-decline-bench-press",
        "ex-lunge",
        "catalog-single-dumbbell-skullcrusher",
        "catalog-dumbbell-bench-press",
      ]) {
        const entry = referenceMediaFor(id)!;
        await open(page, entry);
        await images(page, entry);
        if (entry.assets.some((a) => a.kind === "video")) {
          const video = await play(page, entry);
          await video.evaluate((v: HTMLVideoElement) => v.pause());
          await page.locator(".reference-video").scrollIntoViewIfNeeded();
        } else await page.locator(".reference-images").scrollIntoViewIfNeeded();
        expect(await overflowFindings(page)).toEqual([]);
        await page.waitForFunction(() =>
          document
            .getAnimations()
            .every((a) => a.playState !== "running" && !a.pending),
        );
        await page.screenshot({
          path: info.outputPath(`${id}-media.png`),
          animations: "disabled",
        });
        await prepareExplicitImageSave(page, entry);
        await page
          .getByRole("button", { name: "保存示范供离线使用", exact: true })
          .click();
        const ready = page.getByRole("button", {
          name: "示范已完整保存，可离线查看",
          exact: true,
        });
        await expect(ready).toBeVisible();
        await ready.scrollIntoViewIfNeeded();
        const box = await ready.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(await overflowFindings(page)).toEqual([]);
        await page.screenshot({
          path: info.outputPath(`${id}-ready.png`),
          animations: "disabled",
        });
        await page
          .getByRole("button", { name: "关闭弹窗", exact: true })
          .click();
      }
    });
  }
