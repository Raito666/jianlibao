/** Reviewed text adaptations only. MIT notice and upstream media exclusion: ATTRIBUTION.md. */
import mapping from './external-map.json' with { type: 'json' };

export const textSource = mapping.source;
const supplements = new Map(mapping.entries.map((entry) => [entry.exerciseId, { ...entry, license: 'MIT' as const }]));
export const supplementFor = (exerciseId: string) => supplements.get(exerciseId);
