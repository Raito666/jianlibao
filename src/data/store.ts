import type { AppData } from '../domain/types';
import { createRepository } from './index';

/** Compatibility facade for existing storage callers; new application code uses Repository. */
const repository = createRepository();

export { StoreConflictError } from './repository';
export function loadData(): Promise<AppData> {
  return repository.load();
}
export function saveData(next: AppData, expectedRevision: number): Promise<AppData> {
  return repository.save(next, expectedRevision);
}
export function closeStore(): Promise<void> {
  return repository.close();
}
