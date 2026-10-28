import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import decisions from "../fixtures/reviewed-media-decisions.json" with { type: "json" };
import { referenceWorkerSource } from "../../scripts/reference-worker.mjs";
import { isArtResponse } from "../../src/content/art-cache";
import { allReferenceMedia } from "../../src/content/reference-media";
import { referenceMediaFor } from "../../src/content/reference-media";
import { referenceOfflineAvailable } from "../../src/content/reference-cache";
import { REFERENCE_CACHE } from "../../src/content/reference-media";

function earlierReviewedEntries(
  entries: { exerciseId: string; assets: { kind: string; id: number }[] }[],
) {
  return entries.map((entry) =>
    entry.exerciseId === "catalog-hack-squat"
      ? {
          ...entry,
          assets: entry.assets.filter(
            (asset) =>
              !(
                asset.id === 41 &&
                (asset.kind === "video" || asset.kind === "poster")
              ),
          ),
        }
      : entry,
  );
}

describe("reviewed media library uses exact identities and variants", () => {
  it("maps flat dumbbell bench without borrowing barbell or incline assets", () => {
    expect(
      referenceMediaFor("catalog-dumbbell-bench-press")?.wgerExerciseId,
    ).toBe(75);
    expect(
      referenceMediaFor("catalog-incline-bench-press")?.wgerExerciseId,
    ).toBe(538);
    expect(
      referenceMediaFor("catalog-incline-dumbbell-press")?.wgerExerciseId,
    ).toBe(537);
  });
  it("supports image-only references without requiring a video", () => {
    expect(referenceMediaFor("ex-plank")?.assets.map((a) => a.kind)).toEqual([
      "image",
    ]);
  });
  it("does not accept an old worker acknowledgement for newly added asset routes", async () => {
    const controller = {
      postMessage: (_: unknown, ports: Transferable[]) =>
        (ports[0] as MessagePort).postMessage({
          type: "jianlibao-reference-ready",
          cache: REFERENCE_CACHE,
          version: 1,
        }),
    };
    const asset = {
      url: "/exercise-media/new/image.png",
      mime: "image/png",
      bytes: 4,
      sha256: "new-sha",
    };
    expect(await referenceOfflineAvailable(controller, 100, [asset])).toBe(
      false,
    );
  });
});

it("accepts the reviewed JPEG assets in the common art guard, but rejects a disguised HTML response", async () => {
  const jpeg = allReferenceMedia
    .flatMap((e) => e.assets)
    .find((a) => a.mime === "image/jpeg")!;
  expect(jpeg).toBeDefined();
  expect(
    await isArtResponse(
      new Response(readFileSync(`public${jpeg.url}`), {
        headers: { "Content-Type": "image/jpeg" },
      }),
    ),
  ).toBe(true);
  expect(
    await isArtResponse(
      new Response("<html>not a photo</html>", {
        headers: { "Content-Type": "image/jpeg" },
      }),
    ),
  ).toBe(false);
});

describe("curated adoption and attribution regression", () => {
  it("retains the reviewed scope and rejects unknown or merely similar identities", () => {
    expect(allReferenceMedia).toHaveLength(74);
    expect(new Set(allReferenceMedia.map((e) => e.exerciseId)).size).toBe(74);
    for (const id of [
      "personal-bench",
      "catalog-machine-lateral-raise",
      "catalog-dumbbell-hip-thrust",
      "catalog-pallof-press",
      "catalog-hip-adduction-machine",
      "catalog-rack-pull",
      "catalog-rowing",
    ])
      expect(referenceMediaFor(id)).toBeUndefined();
    expect(
      referenceMediaFor("ex-rdl")?.assets.find((a) => a.kind === "video")?.id,
    ).toBe(4);
  });
  for (const decision of decisions)
    it(`${decision.exerciseId} pins the independently reviewed variants, credits and complete files`, () => {
      const entry = referenceMediaFor(decision.exerciseId)!;
      expect(entry?.wgerExerciseId).toBe(decision.wgerExerciseId);
      expect(
        entry.assets.filter((a) => a.kind === "image").map((a) => a.id),
      ).toEqual(decision.images);
      expect(entry.assets.find((a) => a.kind === "video")?.id ?? null).toBe(
        decision.video,
      );
      for (const asset of entry.assets) {
        const bytes = readFileSync(`public${asset.url}`);
        expect(bytes.length).toBe(asset.bytes);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          asset.sha256,
        );
        expect(asset.author.trim()).not.toBe("");
        expect(asset.sourceUrl).toMatch(/^https:\/\/wger.de\/media\//);
        expect(asset.licenseUrl).toMatch(
          /^https:\/\/creativecommons.org\/licenses\/by-sa\/[34]\.0\//,
        );
        expect(asset.changes.trim()).not.toBe("");
        const sourceId =
          asset.kind === "image"
            ? decision.wgerExerciseId
            : (decision.videoWgerExerciseId ?? decision.wgerExerciseId);
        expect(asset.sourceExerciseId).toBe(sourceId);
        expect(asset.sourceExerciseUrl).toBe(
          `https://wger.de/api/v2/exerciseinfo/${sourceId}/?format=json`,
        );
        if (asset.kind === "video") {
          expect(asset.bytes).toBeLessThanOrEqual(2_000_000);
          expect(asset.mime).toBe("video/mp4");
          expect(entry.assets.filter((a) => a.kind === "poster")).toHaveLength(
            1,
          );
        }
      }
    });
  it("never adopts the reviewed wrong, uncredited or conflicting source assets", () => {
    const keys = allReferenceMedia.flatMap((e) =>
      e.assets.map((a) => `${a.kind}-${a.id}`),
    );
    for (const id of [
      352, 353, 592, 513, 582, 590, 588, 427, 332, 437, 438, 439, 412, 415, 522,
      709, 457, 3, 715, 573, 667, 609, 571, 548, 669, 717, 716, 676, 694, 695,
      684, 370, 374, 66, 67,
    ])
      expect(keys).not.toContain(`image-${id}`);
  });
  it("pins visually reviewed corrections without confusing parent titles or equipment", () => {
    expect(
      referenceMediaFor("catalog-hip-abduction-machine")?.assets.find(
        (a) => a.kind === "video",
      )?.id,
    ).toBe(74);
    expect(
      referenceMediaFor("catalog-dumbbell-romanian-deadlift")?.assets.find(
        (a) => a.kind === "video",
      )?.id,
    ).toBe(2);
    expect(
      referenceMediaFor("catalog-calf-raise")?.assets.find(
        (a) => a.kind === "video",
      )?.id,
    ).toBe(15);
    expect(
      referenceMediaFor("catalog-bent-over-rear-delt-raise")?.note,
    ).toContain("坐姿俯身");
    expect(
      referenceMediaFor("ex-pullup")?.assets.some((a) => a.kind === "video"),
    ).toBe(false);
    const videos = allReferenceMedia.flatMap((e) =>
      e.assets.filter((a) => a.kind === "video").map((a) => a.id),
    );
    for (const rejected of [27, 31, 40, 71])
      expect(videos).not.toContain(rejected);
  });
});

describe("second reviewed batch preserves originals and exact variants", () => {
  it("keeps the original 56 reviewed entries byte-equivalent in canonical JSON", () => {
    const library = JSON.parse(
      readFileSync("src/content/reference-library.json", "utf8"),
    );
    expect(
      createHash("sha256")
        .update(
          JSON.stringify(earlierReviewedEntries(library.entries.slice(0, 56))),
        )
        .digest("hex"),
    ).toBe("81143aa678d9bb2f45f02e132b79a2133358ee46c394789bd2daba3cab0c11d0");
  });
  it("labels elevated and supported variants instead of borrowing a nearby identity", () => {
    expect(referenceMediaFor("catalog-bench-dip")?.note).toContain("脚垫高");
    expect(referenceMediaFor("catalog-rear-delt-fly")?.note).toContain(
      "凳面支撑",
    );
    expect(
      referenceMediaFor("catalog-heel-elevated-goblet-squat")?.note,
    ).toContain("垫高脚跟");
    expect(
      referenceMediaFor("catalog-close-grip-lat-pulldown")?.note,
    ).toContain("对握窄把");
    expect(referenceMediaFor("catalog-goblet-squat")).toBeUndefined();
    expect(
      referenceMediaFor("catalog-worlds-greatest-stretch"),
    ).toBeUndefined();
    expect(
      referenceMediaFor("catalog-overhead-press")?.assets.map((a) => a.id),
    ).toEqual([371]);
  });
  it("pins complete credits and excludes rejected source images", () => {
    const expected = [
      [35, "Everkinetic", "CC BY-SA 3.0"],
      [36, "Everkinetic", "CC BY-SA 3.0"],
      [111, "Everkinetic", "CC BY-SA 3.0"],
      [112, "Everkinetic", "CC BY-SA 3.0"],
      [212, "cshep442", "CC BY-SA 4.0"],
      [213, "cshep442", "CC BY-SA 4.0"],
      [214, "cshep442", "CC BY-SA 4.0"],
      [215, "cshep442", "CC BY-SA 4.0"],
      [271, "utkb", "CC BY-SA 4.0"],
      [328, "philip", "CC BY-SA 4.0"],
      [397, "Franpol", "CC BY-SA 4.0"],
      [402, "Franpol", "CC BY-SA 4.0"],
      [410, "Franpol", "CC BY-SA 4.0"],
      [641, "Davidgj32", "CC BY-SA 4.0"],
      [357, "anon1337", "CC BY-SA 4.0"],
      [371, "Franpol", "CC BY-SA 4.0"],
    ] as const;
    const assets = allReferenceMedia.flatMap((e) =>
      e.assets.filter((a) => a.kind === "image"),
    );
    for (const [id, author, license] of expected) {
      const asset = assets.find((a) => a.id === id);
      expect(asset?.author).toBe(author);
      expect(asset?.license).toBe(license);
    }
    for (const id of [
      326, 329, 364, 376, 377, 379, 403, 419, 423, 429, 430, 431, 521, 617, 636,
      644, 647, 651,
    ])
      expect(assets.some((a) => a.id === id)).toBe(false);
  });
});

describe("a worker must prove the exact routes, not only a cache name", () => {
  const asset = {
    url: "/exercise-media/new/file.mp4",
    mime: "video/mp4",
    bytes: 4,
    sha256: "new-sha",
  };
  it("accepts an acknowledgement containing the exact requested path and SHA", async () => {
    const controller = {
      postMessage: (message: unknown, ports: Transferable[]) =>
        (ports[0] as MessagePort).postMessage({
          type: "jianlibao-reference-ready",
          cache: REFERENCE_CACHE,
          version: 1,
          proof: (message as { proof: unknown }).proof,
        }),
    };
    expect(await referenceOfflineAvailable(controller, 100, [asset])).toBe(
      true,
    );
  });
  it("rejects a right path but stale content hash", async () => {
    const controller = {
      postMessage: (_: unknown, ports: Transferable[]) =>
        (ports[0] as MessagePort).postMessage({
          type: "jianlibao-reference-ready",
          cache: REFERENCE_CACHE,
          version: 1,
          proof: [[asset.url, "old-sha"]],
        }),
    };
    expect(await referenceOfflineAvailable(controller, 100, [asset])).toBe(
      false,
    );
  });
  it("the actual generated worker acknowledges only registered routes and hashes", () => {
    let handler!: (event: {
      data: unknown;
      ports: { postMessage(value: unknown): void }[];
    }) => void;
    runInNewContext(
      referenceWorkerSource({ version: "test", assets: [asset] }),
      {
        self: {
          addEventListener: (_: string, fn: typeof handler) => {
            handler = fn;
          },
        },
      },
    );
    const replies: { proof: unknown }[] = [],
      send = (proof: unknown) =>
        handler({
          data: { type: "jianlibao-reference-capability", proof },
          ports: [
            {
              postMessage: (value) => replies.push(value as { proof: unknown }),
            },
          ],
        });
    send([[asset.url, asset.sha256]]);
    send([[asset.url, "old-sha"]]);
    send([["/not-registered.mp4", asset.sha256]]);
    expect(JSON.parse(JSON.stringify(replies.map((r) => r.proof)))).toEqual([
      [[asset.url, asset.sha256]],
      null,
      null,
    ]);
  });
});

it("keeps all 68 earlier reviewed media entries unchanged while extending coverage", () => {
  const library = JSON.parse(
    readFileSync("src/content/reference-library.json", "utf8"),
  );
  expect(
    createHash("sha256")
      .update(
        JSON.stringify(earlierReviewedEntries(library.entries.slice(0, 68))),
      )
      .digest("hex"),
  ).toBe("20aafca1222d60f2995105b82da84d2e3c53b46fb3cdedc2153be1bc54c1507a");
});
