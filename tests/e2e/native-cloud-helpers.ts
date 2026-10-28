import { expect, type Page, type BrowserContext } from '@playwright/test';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createSyncHandler } from '../../netlify/functions/lib/sync-handler.mjs';
import type { AppData } from '../../src/domain/types';
import { NATIVE_CLOUD_URL } from '../../src/sync/network';

export function cloudBackend() {
  let version = 0;
  const values = new Map<string, { data: unknown; etag: string }>();
  return createSyncHandler(() => ({
    async getWithMetadata(key: string) { return values.get(key) ?? null; },
    async setJSON(key: string, data: unknown, conditions: { onlyIfNew?: boolean; onlyIfMatch?: string }) {
      const old = values.get(key);
      if (conditions.onlyIfNew ? !!old : conditions.onlyIfMatch !== old?.etag) return { modified: false };
      const etag = `"native-test-${++version}"`; values.set(key, { data, etag }); return { modified: true, etag };
    },
  }));
}
export async function webCloud(context: BrowserContext, backend: ReturnType<typeof cloudBackend>) {
  await context.route('**/.netlify/functions/sync', async route => {
    const q = route.request(), r = await backend(new Request(q.url(), { method: q.method(), headers: q.headers(), ...(q.postData() ? { body: q.postData()! } : {}) }));
    await route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() });
  });
}
interface Options { statement?: string; statements?: string; values?: SQLInputValue[]; slot?: string; value?: string; url?: string; method?: string; headers?: Record<string, string>; data?: string; files?: string[]; path?: string; directory?: string; encoding?: string }
/** Real SQLite, simulated OS Keychain/HTTP/App bridges. No native runtime or real cloud calls. */
export async function nativeCloudBridge(page: Page, filename: string, secrets: Map<string, string>, backend: ReturnType<typeof cloudBackend>) {
  await mkdir(dirname(filename), { recursive: true }); const db = new DatabaseSync(filename);
  let registered = false, opened = false, failKeyWrite = false, failCommit = false, offline = false;
  let gate: Promise<void> | null = null, release: (() => void) | null = null, held = 0;
  const files = new Map<string, string>(), exports: string[] = [];
  const httpCalls: Array<{ method: string; url: string; body: string | undefined }> = [];
  await page.exposeFunction('__iosCloud', async (plugin: string, method: string, options: Options = {}) => {
    if (plugin === 'JianlibaoSyncKeychain') {
      const slot = options.slot!; expect(slot).toMatch(/^[a-f0-9]{64}$/);
      if (method === 'read') return { value: secrets.get(slot) ?? null };
      if (method === 'write') { if (failKeyWrite) { failKeyWrite = false; throw Error('模拟 Keychain 锁定，密钥未保存'); } secrets.set(slot, options.value!); return; }
      if (method === 'remove') { secrets.delete(slot); return; }
    }
    if (plugin === 'CapacitorHttp' && method === 'request') {
      expect(options.url).toBe(NATIVE_CLOUD_URL); const raw = options as Options & { disableRedirects: boolean };
      expect(raw.disableRedirects).toBe(true); httpCalls.push({ method: options.method!, url: options.url!, body: options.data });
      if (offline) throw Error('模拟原生网络断开');
      if (gate) { held++; await gate; }
      const response = await backend(new Request(options.url!, { method: options.method, headers: options.headers, ...(options.data ? { body: options.data } : {}) }));
      return { status: response.status, url: options.url, headers: Object.fromEntries(response.headers), data: await response.text() };
    }
    if (plugin === 'App') return method === 'getState' ? { isActive: true } : undefined;
    if (plugin === 'Haptics') return;
    if (plugin === 'LocalNotifications') return { display: 'denied' };
    if (plugin === 'Filesystem') {
      expect(options.directory).toBe('CACHE');
      if (method === 'writeFile') { files.set(options.path!, options.data!); return { uri: `file:///cache/${options.path}` }; }
      if (method === 'deleteFile') { files.delete(options.path!); return; }
    }
    if (plugin === 'Share' && method === 'share') { const data = files.get(options.files![0].slice('file:///cache/'.length)); if (!data) throw Error('Missing exported file'); exports.push(data); return { activityType: 'test.saved' }; }
    if (plugin !== 'CapacitorSQLite') throw Error(`Unexpected plugin ${plugin}.${method}`);
    const done = () => ({ changes: { changes: 0 } });
    switch (method) {
      case 'isDBOpen': if (!registered) throw Error('not registered'); return { result: opened };
      case 'isTransactionActive': return { result: db.isTransaction };
      case 'createConnection': registered = true; return;
      case 'open': opened = true; return;
      case 'closeConnection': if (db.isTransaction) db.exec('ROLLBACK'); registered = false; opened = false; return;
      case 'execute': db.exec(options.statements!); return done();
      case 'beginTransaction': db.exec('BEGIN TRANSACTION'); return done();
      case 'commitTransaction': if (failCommit) { failCommit = false; throw Error('模拟 SQLite 提交失败'); } db.exec('COMMIT'); return done();
      case 'rollbackTransaction': db.exec('ROLLBACK'); return done();
      case 'query': return { values: [{ ios_columns: db.prepare(options.statement!).columns().map(c => c.name) }, ...db.prepare(options.statement!).all(...(options.values ?? []))] };
      case 'run': return { changes: { changes: Number(db.prepare(options.statement!).run(...(options.values ?? [])).changes) } };
      default: throw Error(`Unexpected SQL method ${method}`);
    }
  });
  await page.addInitScript(() => {
    const databases: string[] = [], open = indexedDB.open.bind(indexedDB);
    indexedDB.open = (name, version) => { databases.push(name); return version === undefined ? open(name) : open(name, version); };
    const listeners: Record<string, (state: { isActive: boolean }) => void> = {}; let id = 0;
    const methods: Record<string, string[]> = {
      CapacitorSQLite: ['isDBOpen', 'isTransactionActive', 'createConnection', 'open', 'closeConnection', 'execute', 'beginTransaction', 'commitTransaction', 'rollbackTransaction', 'query', 'run'],
      JianlibaoSyncKeychain: ['read', 'write', 'remove'], CapacitorHttp: ['request'], App: ['getState', 'removeListener'],
      Filesystem: ['writeFile', 'deleteFile'], Share: ['share'], Haptics: ['impact', 'notification', 'selectionStart', 'selectionChanged', 'selectionEnd'],
      LocalNotifications: ['checkPermissions', 'requestPermissions', 'schedule', 'cancel', 'removeDeliveredNotificationsById'],
    };
    Object.assign(window, {
      __nativeIdbOpened: databases,
      __nativeActivity: (active: boolean) => Object.values(listeners).forEach(fn => fn({ isActive: active })),
      webkit: { messageHandlers: { bridge: { postMessage() {} } } },
      Capacitor: {
        PluginHeaders: Object.entries(methods).map(([name, entries]) => ({ name, methods: [...entries.map(name => ({ name, rtype: 'promise' })), ...(name === 'App' ? [{ name: 'addListener', rtype: 'callback' }] : [])] })),
        nativePromise(plugin: string, method: string, options: Record<string, unknown>) {
          if (plugin === 'App' && method === 'removeListener') delete listeners[String(options.callbackId)];
          return Reflect.get(window, '__iosCloud')(plugin, method, options);
        },
        nativeCallback(_plugin: string, _method: string, _options: unknown, callback: (state: { isActive: boolean }) => void) { const key = String(++id); listeners[key] = callback; return key; },
      },
    });
  });
  return {
    data: () => JSON.parse(String(db.prepare("SELECT payload FROM workspace WHERE id='main'").get()?.payload)) as AppData,
    rawMetadata: () => String(db.prepare("SELECT value FROM storage_meta WHERE key='cloud-sync-native-v1'").get()?.value),
    failNextKeyWrite: () => { failKeyWrite = true; }, failNextCommit: () => { failCommit = true; },
    offline: (value: boolean) => { offline = value; },
    hold: () => { held = 0; gate = new Promise<void>(r => { release = r; }); }, held: () => held,
    release: () => { gate = null; release?.(); release = null; },
    httpCalls, exports,
    close: () => { release?.(); db.close(); },
  };
}
export async function nativeActivity(page: Page, active: boolean) {
  await page.evaluate(value => Reflect.get(window, '__nativeActivity')(value), active);
}
