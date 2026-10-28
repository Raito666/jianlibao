import { expect, type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import type { AppData } from '../../src/domain/types';

/** Explicit private ports avoid OS-assigned ports browsers reject (e.g. X11/6000). */
export async function listenForBrowser(server: Server): Promise<string> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const port = randomInt(49152, 65536);
    try {
      await new Promise<void>((resolve, reject) => {
        const ready = () => { server.off('error', failed); resolve(); };
        const failed = (error: Error) => { server.off('listening', ready); reject(error); };
        server.once('listening', ready); server.once('error', failed);
        server.listen(port, '127.0.0.1');
      });
      return `http://127.0.0.1:${port}`;
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('Unable to allocate a private browser test port');
}

/** Reads only this test context's application database, never the user's browser. */
export async function storedWorkspace(page: Page): Promise<AppData> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('jianlibao', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('workspace', 'readonly');
      const read = transaction.objectStore('workspace').get('main');
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => db.close();
    };
  })) as Promise<AppData>;
}

export async function expectPersisted(page: Page, check: (data: AppData) => boolean): Promise<void> {
  await expect.poll(async () => check(await storedWorkspace(page))).toBe(true);
}

export function backupFile(data: AppData, name = 'test-backup.json') {
  return {
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      app: 'jianlibao', formatVersion: data.schemaVersion,
      exportedAt: '2026-10-15T06:00:00.000Z', data,
    })),
  };
}
