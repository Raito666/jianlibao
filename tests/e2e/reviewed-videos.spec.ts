import { expect, test } from "@playwright/test";
import decisions from "../fixtures/reviewed-video-continuation.json" with { type: "json" };
import { referenceMediaFor } from "../../src/content/reference-media";
import { storedWorkspace } from "./helpers";

for (const reviewed of decisions.filter((row) => row.decision === "ADOPT")) {
  test(`video ${reviewed.id}: online and saved-offline playback reaches the end without a decode error`, async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    const entry = referenceMediaFor(reviewed.exerciseId!)!;
    const movie = entry.assets.find((a) => a.kind === "video")!;
    await page.goto("/");
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    const before = await storedWorkspace(page);
    for (const offline of [false, true]) {
      if (offline) {
        await context.setOffline(true);
        await page.reload();
      }
      await page.goto("/#/exercises");
      await page.getByLabel("搜索动作", { exact: true }).fill(entry.name!);
      await page
        .getByRole("button", { name: `查看${entry.name}讲解`, exact: true })
        .click();
      await page.getByRole("tab", { name: "详细讲解", exact: true }).click();
      await page.locator(".reference-media > summary").click();
      if (offline)
        await expect(
          page.getByRole("button", {
            name: "示范已完整保存，可离线查看",
            exact: true,
          }),
        ).toBeVisible();
      await page
        .getByRole("button", {
          name: `加载${entry.name}视频 · ${(movie.bytes / 1_000_000).toFixed(1)} MB`,
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
      await video.scrollIntoViewIfNeeded();
      await video.evaluate(async (v: HTMLVideoElement) => {
        v.currentTime = 0;
        v.playbackRate = 4;
        await v.play();
      });
      await expect
        .poll(
          () =>
            video.evaluate((v: HTMLVideoElement) => ({
              ended: v.ended,
              error: v.error?.code ?? null,
            })),
          { timeout: 15000 },
        )
        .toEqual({ ended: true, error: null });
      expect(
        await video.evaluate((v: HTMLVideoElement) => v.currentTime),
      ).toBeCloseTo(movie.duration!, 1);
      if (!offline) {
        await page
          .getByRole("button", { name: "保存示范供离线使用", exact: true })
          .click();
        await expect(
          page.getByRole("button", {
            name: "示范已完整保存，可离线查看",
            exact: true,
          }),
        ).toBeVisible();
      }
      expect(await storedWorkspace(page)).toEqual(before);
    }
  });
}
