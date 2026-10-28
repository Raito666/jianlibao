import { getStore } from '@netlify/blobs';
import { createSyncHandler } from './lib/sync-handler.mjs';
export default createSyncHandler(() => getStore({ name: 'jianlibao-encrypted-sync-v1', consistency: 'strong' }));
export const config = { rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip'] } };
