import { isIos } from '../platform/native';
import * as web from './web-store';
import type { SyncConnection, SyncState } from './state';
import { normalizeSecret } from './crypto';
export * from './state';

export async function readSyncState(): Promise<SyncState> {
  return isIos() ? (await import('./native-store')).nativeSyncStore.read() : web.readSyncState();
}
export async function writeSyncState(state: SyncState): Promise<void> {
  if (isIos()) await (await import('./native-store')).nativeSyncStore.write(state);
  else await web.writeSyncState(state);
}
export async function connectSyncState(secret: string): Promise<SyncConnection> {
  if (isIos()) return (await import('./native-store')).nativeSyncStore.connect(secret);
  const connection: SyncConnection = { secret: normalizeSecret(secret), base: null, lastSuccess: null };
  await web.writeSyncState({ version: 1, connection });
  return connection;
}
