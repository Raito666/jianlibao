import { describe, expect, it } from 'vitest';
import { synchronize } from '../../src/sync/engine';
import { createInitialData } from '../../src/domain/seed';
import { emptySnapshot, snapshotOf, type Snapshot } from '../../src/sync/model';
import { createSecret } from '../../src/sync/crypto';
import type { SyncConnection } from '../../src/sync/store';
function setup() {
  let local = createInitialData(); local.onboarded = true;
  let cloud: Snapshot | null = null, etag: string | null = null, puts = 0, applies = 0;
  const connection: SyncConnection = { secret: createSecret(), base: null, lastSuccess: null };
  const adapter = {
    getLocal: () => local,
    apply: async (fn: (data: typeof local) => typeof local) => { local = fn(local); applies++; return true; },
    pull: async () => ({ snapshot: cloud, etag }),
    push: async (next: Snapshot, expected: string | null) => {
      if (expected !== etag) return null;
      cloud = structuredClone(next); etag = `v${++puts}`; return etag;
    },
    active: () => true,
  };
  return { adapter, connection, local: () => local, cloud: () => cloud, puts: () => puts, applies: () => applies,
    setLocal: (next: typeof local) => { local = next; }, setCloud: (next: Snapshot) => { cloud = next; etag = `v${++puts}`; } };
}
describe('local-first synchronization commit protocol', () => {
  it('creates an empty vault without erasing local records and avoids redundant writes', async () => {
    const s = setup(); s.local().bodyMetrics = [{ id: 'a', date: '2026-10-26', weightKg: 71 }];
    const first = await synchronize(s.connection, s.adapter);
    expect(first.conflicts).toEqual([]); expect(first.connection!.base?.bodyMetrics).toEqual(s.local().bodyMetrics);
    await synchronize(first.connection!, s.adapter); expect(s.puts()).toBe(1);
  });
  it('never treats an unexpectedly missing existing cloud document as an intentional deletion', async () => {
    const s = setup(); s.connection.base = emptySnapshot();
    await expect(synchronize(s.connection, s.adapter)).rejects.toThrow(/不存在/);
    expect(s.puts()).toBe(0); expect(s.applies()).toBe(0);
  });
  it('does not apply or upload conflicted records', async () => {
    const s = setup(); s.local().bodyMetrics = [{ id: 'a', date: '2026-10-26', weightKg: 70 }];
    const cloud = snapshotOf(s.local()); cloud.bodyMetrics = [{ id: 'b', date: '2026-10-26', weightKg: 73 }]; s.setCloud(cloud);
    const result = await synchronize(s.connection, s.adapter);
    expect(result.conflicts).toHaveLength(1); expect(s.applies()).toBe(0); expect(s.puts()).toBe(1);
  });
  it('preserves newer local edits made while an upload is in flight', async () => {
    const s = setup(); s.local().bodyMetrics = [{ id: 'a', date: '2026-10-26', weightKg: 70 }];
    const push = s.adapter.push;
    s.adapter.push = async (next, etag) => { const saved = await push(next, etag); s.local().bodyMetrics = [{ id: 'a', date: '2026-10-26', weightKg: 74 }]; return saved; };
    const result = await synchronize(s.connection, s.adapter);
    expect(s.local().bodyMetrics[0].weightKg).toBe(74); expect(result.connection!.base?.bodyMetrics[0].weightKg).toBe(70);
  });
  it('retries a conditional-write race with a fresh cloud read', async () => {
    const s = setup(); const push = s.adapter.push; let calls = 0;
    s.adapter.push = async (next, etag) => ++calls === 1 ? null : push(next, etag);
    await synchronize(s.connection, s.adapter); expect(calls).toBe(2);
  });
  it('does not acknowledge sync after local persistence fails or after disconnect', async () => {
    const s = setup(); const cloud = snapshotOf(s.local()); cloud.bodyMetrics = [{ id: 'a', date: '2026-10-26', weightKg: 70 }]; s.setCloud(cloud);
    s.adapter.apply = async () => false;
    await expect(synchronize(s.connection, s.adapter)).rejects.toThrow(/本地保存/);
    s.adapter.active = () => false;
    await expect(synchronize(s.connection, s.adapter)).rejects.toThrow(/断开/);
  });
  it('does not reuse a conflict decision after either record changed', async () => {
    const s = setup(); s.local().bodyMetrics = [{ id: 'a', date: '2026-10-26', weightKg: 70 }];
    const remote = snapshotOf(s.local()); remote.bodyMetrics = [{ id: 'b', date: '2026-10-26', weightKg: 73 }]; s.setCloud(remote);
    const old = (await synchronize(s.connection, s.adapter)).conflicts[0];
    const newer = structuredClone(remote); newer.bodyMetrics[0].weightKg = 75; s.setCloud(newer);
    const result = await synchronize(s.connection, s.adapter, { [old.key]: { choice: 'remote', local: old.local, remote: old.remote } });
    expect(result.conflicts).toHaveLength(1); expect(s.local().bodyMetrics[0].weightKg).toBe(70);
  });
});
