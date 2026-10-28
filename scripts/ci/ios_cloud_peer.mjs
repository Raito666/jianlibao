/** Isolated Web peer for a future real iOS run. No routes, bridge mocks or user profiles. */
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const SITE = 'https://jianlibao-training-raitox.netlify.app';
const ENDPOINT = SITE + '/.netlify/functions/sync';
const digest = text => createHash('sha256').update(text).digest();
const token = secret => digest('jianlibao:auth:v1:' + secret).toString('base64url');
export async function createFixture(directory) {
  const value = { version: 1, createdForThisRun: true, runId: randomUUID(), secret: 'JLB1-' + randomBytes(32).toString('base64url') };
  value.space = digest(token(value.secret)).toString('base64url');
  await writeFile(join(directory, 'fixture.json'), JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  return value;
}
export async function loadFixture(directory) {
  const file = join(directory, 'fixture.json');
  if ((await lstat(file)).isSymbolicLink()) throw Error('Fixture links are forbidden');
  const value = JSON.parse(await readFile(file, 'utf8'));
  if (value.version !== 1 || value.createdForThisRun !== true || !/^[a-f0-9-]{36}$/.test(value.runId)
    || !/^JLB1-[A-Za-z0-9_-]{43}$/.test(value.secret) || value.space !== digest(token(value.secret)).toString('base64url')) throw Error('Not a newly owned cloud fixture');
  return value;
}
export function emptyEnvelope(secret) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', digest('jianlibao:encryption:v1:' + secret), iv);
  cipher.setAAD(Buffer.from('jianlibao-sync-v1'));
  const empty = { version: 1, tombstones: [], exercises: [], templates: [], sessions: [], bodyMetrics: [] };
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(empty)), cipher.final(), cipher.getAuthTag()]);
  return { version: 1, iv: iv.toString('base64url'), ciphertext: ciphertext.toString('base64url') };
}
export async function cleanupFixture(directory, request = fetch) {
  const fixture = await loadFixture(directory), headers = { Authorization: 'Bearer ' + token(fixture.secret) };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await request(ENDPOINT, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (current.status === 404) { await unlink(join(directory, 'fixture.json')); return { cleared: true, absent: true }; }
    const revision = current.headers.get('X-Jianlibao-Revision');
    if (!current.ok || !revision) throw Error('Owned fixture cleanup read failed');
    await current.body?.cancel();
    const envelope = emptyEnvelope(fixture.secret);
    const cleared = await request(ENDPOINT, { method: 'PUT', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Jianlibao-Revision': revision }, body: JSON.stringify(envelope) });
    if (cleared.status === 409) { await cleared.body?.cancel(); continue; }
    const clearedRevision = cleared.headers.get('X-Jianlibao-Revision');
    if (cleared.status !== 200 || !clearedRevision) throw Error('Owned fixture cleanup write failed');
    await cleared.body?.cancel();
    const verified = await request(ENDPOINT, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (verified.status !== 200 || verified.headers.get('X-Jianlibao-Revision') !== clearedRevision
      || !verified.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw Error('Owned fixture cleanup read-back failed');
    const stored = await verified.json();
    if (!stored || Object.keys(stored).sort().join(',') !== 'ciphertext,iv,version'
      || stored.version !== envelope.version || stored.iv !== envelope.iv || stored.ciphertext !== envelope.ciphertext) throw Error('Owned fixture cleanup envelope differs');
    await unlink(join(directory, 'fixture.json'));
    return { cleared: true, encryptedEmptyDocumentRetained: true, readBackVerified: true };
  }
  throw Error('Owned fixture cleanup conflicted; private key retained locally');
}
function shared(data) {
  return Object.fromEntries(['exercises', 'templates', 'sessions', 'bodyMetrics'].map(collection => [collection,
    data[collection].filter(row => collection !== 'sessions' || ['completed', 'cancelled'].includes(row.status))
      .toSorted((a, b) => String(collection === 'bodyMetrics' ? a.date : a.id).localeCompare(String(collection === 'bodyMetrics' ? b.date : b.id)))]));
}
export function assertShared(expected, actual) { assert.deepEqual(shared(actual), shared(expected), 'All shared records must match'); }

async function workspace(page) {
  return page.evaluate(() => new Promise((accept, reject) => {
    const request = indexedDB.open('jianlibao', 1);
    request.onupgradeneeded = () => { request.transaction.abort(); reject(Error('Existing peer workspace required')); };
    request.onerror = () => reject(Error('Peer database unavailable'));
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('workspace', 'readonly');
      const read = transaction.objectStore('workspace').get('main');
      read.onsuccess = () => accept(read.result); read.onerror = () => reject(Error('Peer workspace read failed'));
      transaction.oncomplete = () => db.close();
    };
  }));
}
async function main() {
  const [phase, directory, output] = process.argv.slice(2);
  const root = resolve(import.meta.dirname, '../..');
  const artifactPath = output ? relative(join(root, 'artifacts'), resolve(output)) : '..';
  if (!['setup', 'pull', 'edit', 'cleanup'].includes(phase) || !resolve(directory).startsWith(join(root, 'tools', 'ios-cloud-acceptance-'))
    || artifactPath === '..' || artifactPath.startsWith('../') || artifactPath.startsWith('..\\') || isAbsolute(artifactPath)) throw Error('Only this job private fixture and artifact directory are allowed');
  const save = (name, data) => writeFile(join(output, name), JSON.stringify(data, null, 2) + '\n');
  if (phase === 'cleanup') { await save('cleanup.json', await cleanupFixture(directory)); return; }
  const fixture = phase === 'setup' ? await createFixture(directory) : await loadFixture(directory);
  const { webkit, expect } = await import('@playwright/test');
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage();
    await page.goto(SITE + '/#/settings', { waitUntil: 'domcontentloaded' });
    const joinButton = page.getByRole('button', { name: '连接已有同步', exact: true });
    await expect(joinButton).toBeEnabled({ timeout: 20_000 }); await joinButton.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('同步密钥', { exact: true }).fill(fixture.secret);
    await dialog.getByRole('button', { name: '连接并合并', exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 30_000 });
    const sync = async () => {
      const button = page.getByRole('button', { name: '立即同步', exact: true });
      await expect(button).toBeEnabled({ timeout: 30_000 });
      const response = page.waitForResponse(result => result.url() === ENDPOINT && result.request().method() === 'GET', { timeout: 30_000 });
      await button.click();
      assert.ok([200, 304, 404].includes((await response).status()), 'Real sync request must complete');
      await expect(button).toBeEnabled({ timeout: 30_000 });
      await expect(page.locator('.cloud-status')).toContainText('最近同步', { timeout: 30_000 });
      await expect(page.locator('.cloud-sync [role=alert]')).toHaveCount(0);
    };
    await sync();
    if (phase === 'pull' || phase === 'edit') {
      const expected = JSON.parse(await readFile(join(output, 'native-saved.json'), 'utf8'));
      assertShared(expected.data, await workspace(page));
    }
    if (phase === 'setup' || phase === 'edit') {
      await page.getByRole('button', { name: phase === 'setup' ? '记录身体数据' : '编辑2026-10-27身体记录', exact: true }).click();
      const body = page.getByRole('dialog');
      if (phase === 'setup') await body.getByLabel('记录日期', { exact: true }).fill('2026-10-27');
      await body.getByLabel('体重 (kg)', { exact: true }).fill(phase === 'setup' ? '70' : '76');
      if (phase === 'setup') await body.getByLabel('备注（可选）', { exact: true }).fill('SIM-CLOUD-WEB-' + fixture.runId);
      await body.getByRole('button', { name: '保存身体记录', exact: true }).click();
      await expect(body).not.toBeVisible(); await sync();
    }
    const data = await workspace(page);
    if (phase === 'setup' || phase === 'edit') assert.equal(data.bodyMetrics.find(x => x.date === '2026-10-27')?.weightKg, phase === 'setup' ? 70 : 76);
    await save('web-' + phase + '.json', { data, actualWebBackend: true, bridgeMocked: false });
    await page.screenshot({ path: join(output, 'web-' + phase + '.png'), fullPage: true });
    await context.close();
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Isolated Web peer failed; credentials and raw errors withheld'); process.exitCode = 1; });
}
