import { catalogEntries, exerciseArt } from './catalog';

export const artworkSource = {
  author: 'Bryl Lim / Workout Guide',
  sourceUrl: 'https://github.com/bryllim/workout-guide',
  license: 'CC-BY-SA-4.0' as const,
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  attributionUrl: '/exercise-art/ATTRIBUTION.md',
};
export interface MediaAsset {
  kind: 'svg-frames';
  urls: string[];
  license: 'CC-BY-SA-4.0';
  attribution: string;
  sourceUrl: string;
  changes: string;
}
export function mediaAssetFor(exerciseId: string): MediaAsset | undefined {
  const entry = catalogEntries.find((item) => item.id === exerciseId);
  if (!entry) return undefined;
  return {
    kind: 'svg-frames' as const,
    urls: [1, 2, 3].map((frame) => exerciseArt(exerciseId, frame)!),
    license: artworkSource.license,
    attribution: entry.slug === 'pallof-press' ? '健力宝原创姿势示意' : artworkSource.author,
    sourceUrl: entry.slug === 'pallof-press' ? artworkSource.attributionUrl : artworkSource.sourceUrl,
    changes:
      entry.slug === 'pallof-press'
        ? '三帧原创示意；CSS反相适配浅底。'
        : '原SVG文件不变；CSS反相适配浅底，100ms帧切换。',
  };
}
