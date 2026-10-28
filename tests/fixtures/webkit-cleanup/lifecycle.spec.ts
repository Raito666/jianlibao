import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Replays a worker that keeps responding while resource teardown never ends.
// No user data, browser, cloud account or application source is involved.
const test = base.extend<{ heldTestResource: void }, { heldResource: void }>({
  heldTestResource: [async ({}, use) => {
    await use();
    if (process.env.JLB_CLEANUP_FIXTURE === 'stalled-test-fixture')
      await new Promise<void>(() => {});
  }, { auto: true, timeout: 0 }],
  heldResource: [async ({}, use) => {
    await use();
    if (process.env.JLB_CLEANUP_FIXTURE === 'stalled-worker') {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { windowsHide: true, stdio: 'ignore' });
      writeFileSync(join(process.env.JLB_E2E_RUN_DIR!, 'owned-child.json'), JSON.stringify({ pid: child.pid }));
      await new Promise<void>(() => {});
    }
  }, { scope: 'worker', auto: true, timeout: 0 }],
});

test('controlled lifecycle assertion', async () => {
  if (process.env.JLB_CLEANUP_FIXTURE === 'extended-body') {
    test.setTimeout(120000);
    await new Promise(resolve => setTimeout(resolve, 64000));
  }
  if (process.env.JLB_CLEANUP_FIXTURE === 'slow-body') {
    test.setTimeout(5000);
    await new Promise(resolve => setTimeout(resolve, 1400));
  }
  expect(process.env.JLB_CLEANUP_FIXTURE).not.toBe('failed-assertion');
});
