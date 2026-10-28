/** Real loopback HTTP + production handler; memory storage and synthetic keys only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, request as localRequest } from 'node:http';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, webcrypto } from 'node:crypto';
import { createSyncHandler } from '../../netlify/functions/lib/sync-handler.mjs';
import { createFixture, loadFixture, cleanupFixture } from '../../scripts/ci/ios_cloud_peer.mjs';

const hash = text => createHash('sha256').update(text).digest('base64url');
const auth = secret => 'Bearer ' + hash('jianlibao:auth:v1:' + secret);

async function encryptedSample(secret, marker) {
  // Independent browser WebCrypto encoding, as used by the app; handler stores opaque envelopes.
  const bytes = new TextEncoder(), iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.importKey('raw', createHash('sha256').update('jianlibao:encryption:v1:' + secret).digest(), 'AES-GCM', false, ['encrypt']);
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: bytes.encode('jianlibao-sync-v1') }, key, bytes.encode(JSON.stringify({ syntheticMarker: marker })));
  return { version: 1, iv: Buffer.from(iv).toString('base64url'), ciphertext: Buffer.from(encrypted).toString('base64url') };
}

async function setup(t) {
  const entries = new Map(), calls = [];
  let revision = 0, conflicts = 0, stale = false, previous = null;
  const store = {
    async getWithMetadata(key) { return structuredClone(stale && previous?.key === key && previous.value !== null ? previous.value : entries.get(key) ?? null); },
    async setJSON(key, data, condition) {
      const existing = entries.get(key);
      if (conflicts > 0) {
        conflicts--; if (existing) entries.set(key, { ...existing, etag: String(++revision) });
        return { modified: false };
      }
      if ((condition.onlyIfNew && existing) || (condition.onlyIfMatch && existing?.etag !== condition.onlyIfMatch)) return { modified: false };
      previous = { key, value: structuredClone(existing ?? null) };
      const etag = String(++revision); entries.set(key, { data: structuredClone(data), etag });
      return { modified: true, etag };
    },
  };
  const handler = createSyncHandler(() => store);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const request = new Request('http://127.0.0.1' + incoming.url, {
        method: incoming.method, headers: incoming.headers,
        ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }),
      });
      const result = await handler(request);
      calls.push({ method: incoming.method, status: result.status });
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch { outgoing.writeHead(500); outgoing.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const port = server.address().port;
  const request = async (target, options) => {
    // Deliberately never fetch(target): the only opened socket is this test's 127.0.0.1 port.
    const url = new URL(target);
    assert.equal(url.hostname, 'jianlibao-training-raitox.netlify.app');
    assert.equal(url.pathname, '/.netlify/functions/sync');
    return new Promise((resolve, reject) => {
      const client = localRequest({ hostname: '127.0.0.1', port, path: url.pathname, method: options.method,
        headers: options.headers, signal: options.signal }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      });
      client.on('error', reject); client.end(options.body);
    });
  };
  async function fixture(marker) {
    const directory = await mkdtemp(join(tmpdir(), 'jlb-cloud-loopback-'));
    t.after(async () => {
      try { await unlink(join(directory, 'fixture.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rmdir(directory); // Nonrecursive: unknown files are never removed.
    });
    const value = await createFixture(directory), envelope = await encryptedSample(value.secret, marker);
    const saved = await request('https://jianlibao-training-raitox.netlify.app/.netlify/functions/sync', {
      method: 'PUT', headers: { Authorization: auth(value.secret), 'Content-Type': 'application/json', 'X-Jianlibao-Revision': 'new' }, body: JSON.stringify(envelope),
    });
    assert.equal(saved.status, 200);
    return { directory, ...value, envelope, key: 'vault-' + hash(hash('jianlibao:auth:v1:' + value.secret)) };
  }
  return { entries, calls, request, fixture, conflict: count => { conflicts = count; }, stale: () => { stale = true; } };
}

test('loopback handler confirms cleanup over HTTP and leaves another fixture unchanged', async t => {
  const local = await setup(t), first = await local.fixture('first synthetic record'), second = await local.fixture('second synthetic record');
  const otherBefore = structuredClone(local.entries.get(second.key));
  const proof = await cleanupFixture(first.directory, local.request);
  assert.equal(proof.readBackVerified, true); assert.equal(proof.encryptedEmptyDocumentRetained, true);
  assert.deepEqual(local.entries.get(second.key), otherBefore);
  assert.deepEqual(local.calls.slice(-3).map(x => [x.method, x.status]), [['GET', 200], ['PUT', 200], ['GET', 200]]);
  await assert.rejects(() => loadFixture(first.directory));
});
test('loopback handler retries an actual conditional 409 using the newly read revision', async t => {
  const local = await setup(t), fixture = await local.fixture('conflict sample');
  local.conflict(1);
  const proof = await cleanupFixture(fixture.directory, local.request);
  assert.equal(proof.readBackVerified, true);
  assert.deepEqual(local.calls.slice(-5).map(x => [x.method, x.status]), [['GET', 200], ['PUT', 409], ['GET', 200], ['PUT', 200], ['GET', 200]]);
});
test('loopback stale storage read-back cannot acknowledge successful cleanup', async t => {
  const local = await setup(t), fixture = await local.fixture('stale sample');
  local.stale();
  await assert.rejects(() => cleanupFixture(fixture.directory, local.request));
  assert.equal((await loadFixture(fixture.directory)).secret, fixture.secret);
});
test('loopback repeated conflicts stop after three writes and retain the fixture', async t => {
  const local = await setup(t), fixture = await local.fixture('bounded retry sample');
  local.conflict(10);
  await assert.rejects(() => cleanupFixture(fixture.directory, local.request));
  assert.equal(local.calls.filter(x => x.status === 409).length, 3);
  assert.equal((await loadFixture(fixture.directory)).secret, fixture.secret);
});
test('loopback authentication and same-origin checks reject unrelated requests', async t => {
  const local = await setup(t), fixture = await local.fixture('authorization sample');
  const url = 'https://jianlibao-training-raitox.netlify.app/.netlify/functions/sync';
  assert.equal((await local.request(url, { method: 'GET', headers: {} })).status, 401);
  assert.equal((await local.request(url, { method: 'GET', headers: { Authorization: auth(fixture.secret), Origin: 'https://unrelated.invalid' } })).status, 403);
  assert.deepEqual(local.entries.get(fixture.key).data, fixture.envelope);
});
