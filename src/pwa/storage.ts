type StorageAPI = { persisted?: () => Promise<boolean>; estimate?: () => Promise<StorageEstimate>; persist?: () => Promise<boolean> };
export type StorageInfo = { persisted: boolean | null; usage: number | null; quota: number | null };
export async function readStorageInfo(storage: StorageAPI | undefined): Promise<StorageInfo> {
  const result: StorageInfo = { persisted: null, usage: null, quota: null };
  await Promise.all([
    (async () => { try { const value = await storage?.persisted?.(); if (typeof value === 'boolean') result.persisted = value; } catch { /* Optional browser capability. */ } })(),
    (async () => { try { const value = await storage?.estimate?.(); if (Number.isFinite(value?.usage) && value!.usage! >= 0) result.usage = value!.usage!; if (Number.isFinite(value?.quota) && value!.quota! > 0) result.quota = value!.quota!; } catch { /* Estimation is not required for recording. */ } })(),
  ]);
  return result;
}
export async function requestStorageProtection(storage: StorageAPI | undefined) {
  if (!storage?.persist) return 'unsupported' as const;
  try {
    const request = storage.persist();
    return await new Promise<'granted' | 'denied' | 'failed'>(resolve => {
      const timer = setTimeout(() => resolve('failed'), 15000);
      Promise.resolve(request).then(value => { clearTimeout(timer); resolve(value ? 'granted' : 'denied'); }, () => { clearTimeout(timer); resolve('failed'); });
    });
  }
  catch { return 'failed' as const; }
}
