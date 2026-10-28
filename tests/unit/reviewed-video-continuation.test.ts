import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import decisions from "../fixtures/reviewed-video-continuation.json" with { type: "json" };
import {
  allReferenceMedia,
  referenceMediaFor,
} from "../../src/content/reference-media";

for (const reviewed of decisions.filter((row) => row.decision === "ADOPT")) {
  it(`video ${reviewed.id} uses the reviewed exact movement and complete credited lightweight files`, () => {
    const entry = referenceMediaFor(reviewed.exerciseId!)!;
    expect(entry).toBeDefined();
    const video = entry.assets.find((a) => a.kind === "video")!;
    const poster = entry.assets.find((a) => a.kind === "poster")!;
    expect(video?.id).toBe(reviewed.id);
    expect(poster?.id).toBe(reviewed.id);
    for (const asset of [video, poster]) {
      expect(asset.author).toBe("Goulart");
      expect(asset.license).toBe("CC BY-SA 4.0");
      expect(asset.licenseUrl).toBe(
        "https://creativecommons.org/licenses/by-sa/4.0/",
      );
      expect(asset.sourceUrl).toBe(reviewed.sourceUrl);
      expect(asset).toHaveProperty("sourceBytes", reviewed.sourceBytes);
      expect(asset).toHaveProperty("sourceSha256", reviewed.sourceSha256);
      expect(asset.sourceExerciseId).toBe(reviewed.sourceExerciseId);
      expect(asset.recordUrl).toBe(
        `https://wger.de/api/v2/video/${reviewed.id}/?format=json`,
      );
      expect(asset).toHaveProperty("objectUrl", "");
      expect(asset).toHaveProperty("derivativeSourceUrl", "");
      const bytes = readFileSync(`public${asset.url}`);
      expect(bytes.length).toBe(asset.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        asset.sha256,
      );
    }
    expect(video.mime).toBe("video/mp4");
    expect(video.bytes).toBeLessThanOrEqual(2_000_000);
    expect(video.width).toBeLessThanOrEqual(640);
    expect(video.duration).toBeGreaterThan(6);
    expect(poster.mime).toBe("image/jpeg");
  });
}

it("retains all 70 earlier entry fields and assets, permitting only the exact hack video and poster addition", () => {
  const library = JSON.parse(
    readFileSync("src/content/reference-library.json", "utf8"),
  );
  const previous = library.entries
    .slice(0, 70)
    .map(
      (entry: {
        exerciseId: string;
        assets: { kind: string; id: number }[];
      }) =>
        entry.exerciseId === "catalog-hack-squat"
          ? {
              ...entry,
              assets: entry.assets.filter(
                (a) =>
                  !(a.id === 41 && (a.kind === "video" || a.kind === "poster")),
              ),
            }
          : entry,
    );
  expect(
    createHash("sha256").update(JSON.stringify(previous)).digest("hex"),
  ).toBe("fd9c82fc96c2ffaa22216d1bd312e80c26e538472171cee3344c26e1b3532f0e");
});

it("only appends video41 and poster41 after the two original hack images", () => {
  const hack = referenceMediaFor("catalog-hack-squat")!;
  expect(hack.assets.map((a) => [a.kind, a.id])).toEqual([
    ["image", 125],
    ["image", 126],
    ["video", 41],
    ["poster", 41],
  ]);
});

it("keeps every excluded candidate out, including ambiguous seated/chest-support and wrong equipment variants", () => {
  expect(decisions.map((a) => a.id).sort((a, b) => a - b)).toEqual([
    3, 4, 8, 9, 10, 14, 21, 23, 25, 26, 28, 29, 30, 32, 34, 36, 38, 39, 41, 43,
    45, 46, 49, 52, 53, 68, 73, 78,
  ]);
  expect(
    decisions.filter((a) => a.decision === "ADOPT").map((a) => a.id),
  ).toEqual([4, 21, 32, 41]);
  const videos = allReferenceMedia.flatMap((e) =>
    e.assets.filter((a) => a.kind === "video").map((a) => a.id),
  );
  for (const rejected of decisions.filter((a) => a.decision === "REJECT"))
    expect(videos).not.toContain(rejected.id);
});
