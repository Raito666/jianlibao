import { expect, test, type Page } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import legacy from "../fixtures/legacy-reference-registry.json" with { type: "json" };
import {
  allReferenceMedia,
  REFERENCE_CACHE,
  referenceMediaFor,
  type ReferenceEntry,
} from "../../src/content/reference-media";
import { expectPersisted, storedWorkspace } from "./helpers";

// The original activation Promise is returned unchanged to event.waitUntil.
// Reporting is an independent best-effort branch; missing proof still fails.
function reportActivation(source: string) {
  const prefix = "  event.waitUntil(";
  const start = source.indexOf(prefix + "caches.keys().then(");
  const end = source.indexOf("\n", start);
  const line = source.slice(start, end);
  if (
    start < 0 ||
    !line.endsWith(");") ||
    !line.includes(".then(() => self.clients.claim())")
  ) {
    throw new Error("Activation anchor changed");
  }
  const original = line.slice(prefix.length, -2);
  const observed = prefix + "__qaObserve(" + original + "));";
  return source.slice(0, start) + observed + source.slice(end) + `
function __qaObserve(original) {
  original.then(() => {
    void caches.keys().then(keys => fetch('/__qa/activation-proof', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cache: CACHE, keys })
    })).catch(() => {});
  }, () => {});
  return original;
}
`;
}

async function listenForBrowser(server: ReturnType<typeof createServer>) {
  // OS-selected ephemeral ports can include browser-blocked IRC ports (6668
  // was observed). Bind an available port in this project's local QA range.
  for (let port = 5480; port < 5500; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      return;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EADDRINUSE")
      )
        throw error;
    }
  }
  throw new Error("No available local QA port in 5480-5499");
}

async function buildFiles(
  directory: string,
  prefix = "",
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [name, content] of await buildFiles(
        path.join(directory, entry.name),
        url,
      ))
        files.set(name, content);
    } else files.set(url, await readFile(path.join(directory, entry.name)));
  }
  return files;
}

async function open(page: Page, entry: ReferenceEntry) {
  await page.goto("/#/exercises");
  await page
    .getByLabel("搜索动作", { exact: true })
    .fill(entry.name ?? "杠铃卧推");
  await page
    .getByRole("button", {
      name: `查看${entry.name ?? "杠铃卧推"}讲解`,
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "详细讲解", exact: true }).click();
  await page.locator(".reference-media > summary").click();
}

for (const width of [320, 390, 768, 1440])
  for (const theme of ["dark", "light"] as const) {
    test(`${width}px ${theme}：旧媒体服务等待更新不误报，新服务接管保留全部缓存和训练`, async ({
      browser,
    }, info) => {
      test.setTimeout(120000);
      const assets = allReferenceMedia.flatMap((entry) => entry.assets);
      const legacyAssets = new Map(
        legacy.assets.map((asset) => [asset.url, asset]),
      );
      expect(legacyAssets.size).toBe(156);
      expect(assets).toHaveLength(164);
      for (const old of legacy.assets)
        expect(assets.find((asset) => asset.url === old.url)).toMatchObject(
          old,
        );
      const added = assets.filter((asset) => !legacyAssets.has(asset.url));
      expect(added.map((asset) => [asset.kind, asset.id]).sort()).toEqual(
        [
          ["poster", 4],
          ["poster", 21],
          ["poster", 32],
          ["poster", 41],
          ["video", 4],
          ["video", 21],
          ["video", 32],
          ["video", 41],
        ].sort(),
      );

      const files = await buildFiles(path.resolve("dist"));
      const currentWorker = files.get("/sw.js")!.toString("utf8");
      const cache = currentWorker.match(/const CACHE = "([^"]+)";/)![1];
      const oldCache = `${cache}-legacy-media-registry`;
      const registry = currentWorker.match(
        /const REFERENCE_ASSETS = new Map\(([^\n]+)\);/,
      )![0];
      // Deliberately mix current UI with an older registry: this is the unsafe
      // capability window, not a claim to run an entire historical binary.
      let oldWorker = currentWorker
        .replace(`const CACHE = "${cache}";`, `const CACHE = "${oldCache}";`)
        .replace(
          registry,
          `const REFERENCE_ASSETS = new Map(${JSON.stringify(legacy.assets.map(({ url, ...spec }) => [url, spec]))});`,
        );
      // Test-only mutation probes. They affect this loopback server, never dist.
      const fault = process.env.JIANLIBAO_QA_WORKER_FAULT;
      if (fault === "proof")
        oldWorker = oldWorker.replace(
          "proof: verified ? proof : null",
          "proof",
        );
      const currentUpdatedWorker =
        fault === "retention"
          ? currentWorker.replace(
              " && key !== MEDIA && key !== REFERENCE_CACHE",
              "",
            )
          : currentWorker;
      const updatedWorker = reportActivation(currentUpdatedWorker);
      const activationProofs: { cache: string; keys: string[] }[] = [];
      let updated = false;
      const networkMedia: string[] = [];
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
          ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".webmanifest": "application/manifest+json",
      };
      const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1")
          .pathname;
        if (pathname === "/__qa/activation-proof") {
          if (request.method !== "POST") {
            response.writeHead(405);
            response.end();
            return;
          }
          let body = "";
          request.setEncoding("utf8");
          request.on("data", (chunk) => {
            body += chunk;
          });
          request.on("end", () => {
            try {
              const value: unknown = JSON.parse(body);
              if (
                typeof value !== "object" ||
                value === null ||
                !("cache" in value) ||
                value.cache !== cache ||
                !("keys" in value) ||
                !Array.isArray(value.keys) ||
                !value.keys.every((key: unknown) => typeof key === "string")
              ) {
                throw new Error("Invalid activation proof");
              }
              activationProofs.push({ cache: value.cache, keys: value.keys });
              response.writeHead(204);
              response.end();
            } catch {
              response.writeHead(400);
              response.end();
            }
          });
          return;
        }
        if (pathname.startsWith("/exercise-media/"))
          networkMedia.push(pathname);
        const body =
          pathname === "/sw.js"
            ? Buffer.from(updated ? updatedWorker : oldWorker)
            : files.get(pathname === "/" ? "/index.html" : pathname);
        if (!body) {
          response.writeHead(404);
          response.end();
          return;
        }
        response.writeHead(200, {
          "Content-Type":
            types[path.extname(pathname)] ??
            (pathname === "/" ? types[".html"] : "application/octet-stream"),
          "Cache-Control": "no-store",
        });
        response.end(body);
      });
      await listenForBrowser(server);
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const context = await browser.newContext({
        baseURL: origin,
        viewport: { width, height: 844 },
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        await context.addInitScript(() => {
          Object.defineProperty(window, "__upgradeToken", {
            value: crypto.randomUUID(),
          });
        });
        await page.goto("/#/settings");
        await page.evaluate(async () => {
          await navigator.serviceWorker.ready;
        });
        await expect
          .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
          .toBe(true);
        await page.getByLabel("界面主题", { exact: true }).selectOption(theme);
        await page
          .getByRole("button", { name: "记录身体数据", exact: true })
          .click();
        await page.getByLabel("体重 (kg)", { exact: true }).fill("72.5");
        await page
          .getByLabel("备注（可选）", { exact: true })
          .fill("离线升级前的身体记录，不得丢失");
        await page
          .getByRole("button", { name: "保存身体记录", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.goto("/");
        await page
          .getByRole("button", { name: "开始今天的训练", exact: true })
          .click();
        await page
          .getByRole("button", { name: "确认开始训练", exact: true })
          .click();
        await page
          .getByLabel("杠铃深蹲第1组总重量", { exact: true })
          .fill("52.5");
        await expectPersisted(
          page,
          (data) => data.sessions[0].exercises[0].sets[0].weightKg === 52.5,
        );
        const before = await storedWorkspace(page);
        // Real full GETs through the old production routing logic prime all 156
        // accepted old assets; no direct fabricated cache contents.
        await page.evaluate(async (oldAssets) => {
          for (const asset of oldAssets) {
            const response = await fetch(asset.url);
            if (response.status !== 200) throw new Error(asset.url);
            await response.arrayBuffer();
          }
        }, legacy.assets);
        await expect
          .poll(() =>
            page.evaluate(
              async (name) => (await (await caches.open(name)).keys()).length,
              REFERENCE_CACHE,
            ),
          )
          .toBe(156);
        const hack = referenceMediaFor("catalog-hack-squat")!;
        const rdl = referenceMediaFor("ex-rdl")!;
        for (const entry of [
          hack,
          rdl,
          referenceMediaFor("catalog-smith-machine-bench-press")!,
          referenceMediaFor("catalog-split-squat")!,
        ]) {
          await open(page, entry);
          await page
            .getByRole("button", { name: "保存示范供离线使用", exact: true })
            .click();
          await expect(
            page.getByRole("button", {
              name: "示范文件已校验，离线服务未就绪",
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", {
              name: "示范已完整保存，可离线查看",
              exact: true,
            }),
          ).toHaveCount(0);
          await expect(page.locator(".reference-offline")).toContainText(
            "确认训练已保存后关闭旧页面再打开，无需清除数据",
          );
          await page
            .getByRole("button", { name: "关闭弹窗", exact: true })
            .click();
        }
        expect(await storedWorkspace(page)).toEqual(before);
        await open(page, hack);
        await page.locator(".reference-offline").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: info.outputPath("old-worker-not-ready.png"),
          animations: "disabled",
        });
        await context.setOffline(true);
        const oldVideo = referenceMediaFor("ex-bench")!.assets.find(
          (a) => a.kind === "video",
        )!;
        expect(
          await page.evaluate(
            async (url) => (await fetch(url)).status,
            oldVideo.url,
          ),
        ).toBe(200);
        expect(
          await page.evaluate(
            async (url) => {
              try {
                await fetch(url);
                return true;
              } catch {
                return false;
              }
            },
            rdl.assets.find((a) => a.kind === "video")!.url,
          ),
        ).toBe(false);
        await context.setOffline(false);

        const second = await context.newPage();
        await second.goto("/");
        await expect
          .poll(() =>
            second.evaluate(() => !!navigator.serviceWorker.controller),
          )
          .toBe(true);
        const token = await page.evaluate(
          () =>
            (window as unknown as { __upgradeToken: string }).__upgradeToken,
        );
        let reloads = 0;
        page.on("load", () => reloads++);
        updated = true;
        await page.evaluate(async () => {
          await (await navigator.serviceWorker.getRegistration())!.update();
        });
        await expect
          .poll(() =>
            page.evaluate(
              async () =>
                (await navigator.serviceWorker.getRegistration())?.waiting
                  ?.state,
            ),
          )
          .toBe("installed");
        expect(
          await page.evaluate(
            () =>
              (window as unknown as { __upgradeToken: string }).__upgradeToken,
          ),
        ).toBe(token);
        expect(reloads).toBe(0);
        expect(await storedWorkspace(page)).toEqual(before);
        await page.close();
        // Closing only one tab is insufficient. The second client still owns the
        // old worker; activation must not interrupt its active training either.
        expect(
          await second.evaluate(
            async () =>
              (await navigator.serviceWorker.getRegistration())?.waiting?.state,
          ),
        ).toBe("installed");
        expect(
          await second.evaluate(
            () => navigator.serviceWorker.controller?.state,
          ),
        ).toBe("activated");
        expect(await storedWorkspace(second)).toEqual(before);
        await second.close();
        // Workers can disappear from context.serviceWorkers() between polls.
        // Observe the same cache condition via a proof emitted only after the
        // new worker's original cleanup and claim complete; keep the 15s limit.
        await expect
          .poll(
            () =>
              activationProofs.some(
                (proof) =>
                  proof.cache === cache &&
                  proof.keys.includes(cache) &&
                  !proof.keys.includes(oldCache),
              ),
            { timeout: 15000 },
          )
          .toBe(true);
        await info.attach("activation-proof", {
          body: JSON.stringify(activationProofs),
          contentType: "application/json",
        });
        await context.setOffline(true);
        const reopened = await context.newPage();
        const requestsBeforeOffline = networkMedia.length;
        await reopened.goto("/");
        await expect
          .poll(() =>
            reopened.evaluate(() => !!navigator.serviceWorker.controller),
          )
          .toBe(true);
        expect(await storedWorkspace(reopened)).toEqual(before);
        await expect(reopened.locator("html")).toHaveAttribute(
          "data-theme",
          theme,
        );
        const checked = await reopened.evaluate(
          async ({ items, name }) => {
            const storage = await caches.open(name),
              result = [];
            for (const item of items) {
              const cached = await storage.match(item.url);
              if (!cached) throw new Error(`Missing cache: ${item.url}`);
              const response = await fetch(item.url),
                body = await response.arrayBuffer();
              const sha = [
                ...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
              ]
                .map((n) => n.toString(16).padStart(2, "0"))
                .join("");
              result.push({
                url: item.url,
                status: response.status,
                mime: response.headers.get("Content-Type")?.split(";")[0],
                bytes: body.byteLength,
                sha256: sha,
              });
            }
            return result;
          },
          { items: assets, name: REFERENCE_CACHE },
        );
        expect(checked).toEqual(
          assets.map(({ url, mime, bytes, sha256 }) => ({
            url,
            status: 200,
            mime,
            bytes,
            sha256,
          })),
        );
        for (const entry of [
          referenceMediaFor("ex-bench")!,
          hack,
          rdl,
          referenceMediaFor("catalog-smith-machine-bench-press")!,
          referenceMediaFor("catalog-split-squat")!,
        ]) {
          await open(reopened, entry);
          await expect(
            reopened.getByRole("button", {
              name: "示范已完整保存，可离线查看",
              exact: true,
            }),
          ).toBeVisible();
          await expect
            .poll(() =>
              reopened
                .locator(".technique-art img")
                .first()
                .evaluate((img: HTMLImageElement) => img.naturalWidth),
            )
            .toBeGreaterThan(0);
          const name = entry.name ?? "杠铃卧推",
            movie = entry.assets.find((a) => a.kind === "video")!;
          await reopened
            .getByRole("button", {
              name:
                entry.exerciseId === "ex-bench"
                  ? "加载卧推视频 · 1.4 MB"
                  : `加载${name}视频 · ${(movie.bytes / 1000000).toFixed(1)} MB`,
              exact: true,
            })
            .click();
          const video = reopened.getByLabel(`${name}实拍示范`, { exact: true });
          await Promise.all([
            video.evaluate((v: HTMLVideoElement) => v.play()),
            (async () => {
              await expect
                .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
                .toBeGreaterThanOrEqual(2);
            })(),
          ]); // Explicit playback shares the original readiness deadline.
          await video.evaluate(async (v: HTMLVideoElement, t) => {
            await new Promise<void>((resolve) => {
              v.addEventListener("seeked", () => resolve(), { once: true });
              v.currentTime = t;
            });
            await v.play();
          }, movie.duration! * 0.6);
          await expect
            .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
            .toBeGreaterThan(movie.duration! * 0.6 + 0.15);
          expect(
            await video.evaluate(
              (v: HTMLVideoElement) => v.error?.code ?? null,
            ),
          ).toBeNull();
          await video.evaluate((v: HTMLVideoElement) => v.pause());
          const range = await reopened.evaluate(async (url) => {
            const response = await fetch(url, {
              headers: { Range: "bytes=0-31" },
            });
            return {
              status: response.status,
              header: response.headers.get("Content-Range"),
              bytes: [...new Uint8Array(await response.arrayBuffer())],
            };
          }, movie.url);
          expect(range).toEqual({
            status: 206,
            header: `bytes 0-31/${movie.bytes}`,
            bytes: [...files.get(movie.url)!.subarray(0, 32)],
          });
          if (entry === hack) {
            await reopened
              .locator(".reference-offline")
              .scrollIntoViewIfNeeded();
            await reopened.screenshot({
              path: info.outputPath("upgraded-worker-offline-ready.png"),
              animations: "disabled",
            });
          }
          await reopened
            .getByRole("button", { name: "关闭弹窗", exact: true })
            .click();
        }
        expect(networkMedia.length).toBe(requestsBeforeOffline);
        expect(await storedWorkspace(reopened)).toEqual(before);
        await info.attach("upgrade-evidence", {
          body: JSON.stringify({
            width,
            theme,
            legacyAssets: 156,
            currentAssets: checked.length,
            cache,
            oldCache,
            reloads,
            offlineNetworkMediaRequests:
              networkMedia.length - requestsBeforeOffline,
            assets: checked,
            dataUnchanged: true,
            oldTabWaited: true,
          }),
          contentType: "application/json",
        });
      } finally {
        await context.close();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    });
  }
