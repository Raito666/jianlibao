import type { Session } from '../../domain/types';
export type Update = (fn: (s: Session) => Session) => Promise<boolean>;
