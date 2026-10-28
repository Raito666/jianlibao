import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDecipheriv, createHash } from 'node:crypto';
import { createFixture, loadFixture, emptyEnvelope, cleanupFixture, assertShared } from '../../scripts/ci/ios_cloud_peer.mjs';

test('new isolated fixtures are private, random, owned and never silently overwritten', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jlb-cloud-peer-'));
  try {
    const fixture = await createFixture(root);
    assert.match(fixture.secret, /^JLB1-[A-Za-z0-9_-]{43}$/);
    assert.equal((await loadFixture(root)).secret, fixture.secret);
    await assert.rejects(() => createFixture(root));
    const raw = JSON.parse(await readFile(join(root, 'fixture.json'), 'utf8')); raw.createdForThisRun = false;
    await import('node:fs/promises').then(fs => fs.writeFile(join(root, 'fixture.json'), JSON.stringify(raw)));
    await assert.rejects(() => loadFixture(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('cleanup envelope matches the application encryption format and contains no shared records', () => {
  const secret = 'JLB1-' + 'A'.repeat(43), envelope = emptyEnvelope(secret);
  const bytes = Buffer.from(envelope.ciphertext, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update('jianlibao:encryption:v1:' + secret).digest(), Buffer.from(envelope.iv, 'base64url'));
  decipher.setAAD(Buffer.from('jianlibao-sync-v1')); decipher.setAuthTag(bytes.subarray(-16));
  const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]));
  assert.deepEqual(data, { version: 1, tombstones: [], exercises: [], templates: [], sessions: [], bodyMetrics: [] });
});
test('cleanup uses conditional encrypted PUT and confirms the stored envelope before removing the key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jlb-cloud-cleanup-')); const calls = [];
  try {
    await createFixture(root);
    let saved = {};
    const result = await cleanupFixture(root, async (url, options) => {
      calls.push({ url, ...options });
      if (options.method === 'PUT') saved = JSON.parse(options.body);
      return new Response(JSON.stringify(options.method === 'GET' ? saved : { saved: true }), {
        headers: { 'Content-Type': 'application/json', 'X-Jianlibao-Revision': calls.length === 1 ? 'owned-revision' : 'cleared-revision' },
      });
    });
    assert.equal(result.cleared, true); assert.equal(result.readBackVerified, true); assert.equal(calls.length, 3);
    assert.equal(calls[1].method, 'PUT'); assert.equal(calls[1].headers['X-Jianlibao-Revision'], 'owned-revision');
    assert.equal(calls[2].method, 'GET');
    assert.match(calls[0].headers.Authorization, /^Bearer [A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(result).includes('JLB1-'), false);
    await assert.rejects(() => loadFixture(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('an acknowledged write with stale or tampered read-back must keep the private fixture', async () => {
  for (const bad of ['stale', 'tampered', 'unavailable']) {
    const root = await mkdtemp(join(tmpdir(), 'jlb-cloud-readback-'));
    let reads = 0;
    try {
      const fixture = await createFixture(root);
      await assert.rejects(() => cleanupFixture(root, async (_url, options) => {
        if (options.method === 'PUT') return new Response('{"saved":true}', { headers: { 'X-Jianlibao-Revision': 'new-revision' } });
        reads++;
        if (bad === 'unavailable' && reads > 1) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify(emptyEnvelope(fixture.secret)), {
          headers: { 'Content-Type': 'application/json', 'X-Jianlibao-Revision': bad === 'stale' ? 'old-revision' : 'new-revision' },
        });
      }));
      assert.equal((await loadFixture(root)).secret, fixture.secret);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
test('failed cleanup keeps the private fixture for recovery, without returning credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jlb-cloud-failed-cleanup-'));
  try {
    await createFixture(root);
    await assert.rejects(() => cleanupFixture(root, async () => new Response('{}', { status: 503 })));
    assert.equal((await loadFixture(root)).createdForThisRun, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('Web peer must match every shared record, not counts or an empty success marker', () => {
  const data = { exercises: [{ id: 'e' }], templates: [{ id: 't' }], sessions: [{ id: 's', status: 'completed', note: 'native' }], bodyMetrics: [{ id: 'b', date: '2026-10-27', weightKg: 74 }] };
  assertShared(data, structuredClone(data));
  for (const key of ['exercises', 'templates', 'sessions', 'bodyMetrics']) {
    const changed = structuredClone(data); changed[key][0].id = 'lost-record';
    assert.throws(() => assertShared(data, changed));
  }
});
