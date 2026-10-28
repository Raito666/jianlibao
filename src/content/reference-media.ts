import manifest from "./reference-media.json" with { type: "json" };
import library from "./reference-library.json" with { type: "json" };

export const benchReference = manifest;
export type ReferenceEntry = Omit<typeof manifest, "assets"> & {
  name?: string;
  note?: string;
  assets: ((typeof manifest.assets)[number] & {
    sourceExerciseId?: number;
    sourceExerciseUrl?: string;
  })[];
};
export const allReferenceMedia: readonly ReferenceEntry[] = [
  benchReference,
  ...library.entries,
];
export const REFERENCE_CACHE = `jianlibao-reference-${manifest.version}`;
export const referenceMediaFor = (exerciseId: string) =>
  allReferenceMedia.find((entry) => entry.exerciseId === exerciseId);
