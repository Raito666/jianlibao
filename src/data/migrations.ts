import type { AppData, LegacyAppData } from '../domain/types';

/** Pure payload migration, called only after the strict v1 validator succeeds. */
export function migrateAppDataV1(data: LegacyAppData): AppData {
  return { ...data, schemaVersion: 2, bodyMetrics: [], settings: { ...data.settings, showRpe: false } };
}
