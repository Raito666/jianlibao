export type ExerciseKind = 'weight-reps' | 'reps' | 'duration';
export interface Exercise {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  kind: ExerciseKind;
  description: string;
}
export interface TemplateItem {
  id: string;
  exerciseId: string;
  sets: number;
  weightKg: number;
  reps: number;
  durationSeconds: number;
}
export interface WorkoutTemplate {
  id: string;
  name: string;
  description: string;
  restSeconds: number;
  items: TemplateItem[];
  updatedAt: string;
  archived?: boolean;
}
export type SetType = 'warmup' | 'work' | 'drop' | 'failure';
export interface SetRecord {
  id: string;
  type: SetType;
  rpe?: number;
  weightKg: number;
  reps: number;
  durationSeconds: number;
  status: 'pending' | 'completed' | 'skipped';
}
export interface SessionExercise {
  id: string;
  exercise: Exercise;
  sets: SetRecord[];
  note: string;
}
export interface Session {
  id: string;
  name: string;
  templateId?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  date: string;
  timeZone: string;
  status: 'active' | 'paused' | 'review' | 'completed' | 'cancelled';
  pausedAt?: number;
  pausedMs: number;
  restUntil: number | null;
  restDuration: number;
  recordedManually?: boolean;
  exercises: SessionExercise[];
  note: string;
}
export interface AppSettings {
  unit: 'kg' | 'lb';
  theme: 'dark' | 'light';
  defaultRest: number;
  autoRest: boolean;
  showRpe: boolean;
  lastExportAt: string | null;
  favoriteExerciseIds?: string[];
}
export type MeasurementKey = 'chest' | 'waist' | 'hip' | 'arm' | 'thigh';
export interface BodyMetric {
  id: string;
  date: string;
  weightKg?: number;
  bodyFatPct?: number;
  measurements?: Partial<Record<MeasurementKey, number>>;
  note?: string;
}
export interface AppData {
  schemaVersion: 2;
  revision: number;
  exercises: Exercise[];
  templates: WorkoutTemplate[];
  sessions: Session[];
  bodyMetrics: BodyMetric[];
  settings: AppSettings;
  onboarded: boolean;
}
/** Strictly validated v1 input only; persistence writes the current AppData. */
export type LegacyAppData = Omit<AppData, 'schemaVersion' | 'bodyMetrics' | 'settings'> & {
  schemaVersion: 1;
  settings: Omit<AppSettings, 'showRpe'>;
};
export interface SessionStats {
  completedSets: number;
  workSets: number;
  volumeKg: number;
  reps: number;
  durationSeconds: number;
  activeSeconds: number;
  exerciseCount: number;
}
