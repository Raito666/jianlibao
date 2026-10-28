import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getE2ERunDirectory } from './e2e-output.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const browserDirectory = fileURLToPath(new URL('../tools/playwright-webkit/', import.meta.url));
const lifecycleReporter = fileURLToPath(new URL('./webkit-lifecycle-reporter.mjs', import.meta.url));
const args = process.argv.slice(2);
// CLI reporter overrides replace config reporters. Preserve the caller's
// selection while retaining our separate lifecycle channel.
for (let index = 0; index < args.length; index++) {
  if (args[index].startsWith('--reporter=')) args[index] += `,${lifecycleReporter}`;
  else if (args[index] === '--reporter' && args[index + 1]) args[++index] += `,${lifecycleReporter}`;
}

const cleanupMs = Number(process.env.JLB_WEBKIT_CLEANUP_TIMEOUT_MS ?? 60_000);
if (!Number.isInteger(cleanupMs) || cleanupMs < 500 || cleanupMs > 120_000)
  throw new Error('JLB_WEBKIT_CLEANUP_TIMEOUT_MS must be an integer from 500 to 120000.');

const directory = getE2ERunDirectory();
const started = Date.now();
const receipt = {
  hostPlatform: process.platform, actualIOS: false,
  started: new Date(started).toISOString(), cleanupTimeoutMs: cleanupMs,
  phase: 'starting', completedAssertions: 0, passedAssertions: 0,
  timedOut: false, stopRequested: false, cleanupComplete: false,
};
const save = () => writeFileSync(join(directory, 'webkit-lifecycle.json'), JSON.stringify({ ...receipt, elapsedMs: Date.now() - started }, null, 2));
const child = spawn(process.execPath,
  [cli, 'test', '--config', 'playwright.webkit.config.ts', ...args], {
    cwd: root, windowsHide: true, detached: process.platform !== 'win32',
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserDirectory, JLB_WEBKIT_SUPERVISED: '1' },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
receipt.pid = child.pid;
let timer, stopTimer, stopped = false, finished = false, cliExited = false;
save();

function arm(phase, timeout) {
  if (stopped || finished) return;
  clearTimeout(timer);
  receipt.phase = phase;
  save();
  timer = setTimeout(() => stop('timeout', 124), timeout);
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  clearTimeout(stopTimer);
  receipt.exitCode = code;
  receipt.cleanupComplete = !stopped && cliExited;
  save();
  process.off('SIGINT', interrupted);
  process.off('SIGTERM', terminated);
  process.exitCode = code;
}

function stop(reason, code) {
  if (stopped || finished) return;
  stopped = true;
  clearTimeout(timer);
  receipt.stopRequested = true;
  receipt.timedOut = reason === 'timeout';
  receipt.stopReason = reason;
  save();
  console.error(`WebKit lifecycle ${reason} during ${receipt.phase}; this invocation fails (${code}). Receipt: ${join(directory, 'webkit-lifecycle.json')}`);
  // Only this still-live child tree. Never kill by executable name, or target
  // a PID after its exit event (Windows can reuse that PID).
  if (child.pid && !cliExited) {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, encoding: 'utf8', timeout: 5000,
      });
      receipt.treeStopExitCode = result.status;
      if (result.error) receipt.treeStopError = result.error.message;
      if (result.status !== 0) receipt.treeStopMessage = `${result.stderr ?? ''}${result.stdout ?? ''}`.slice(0, 2000);
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { receipt.treeStopError = error.message; }
    }
  }
  receipt.forcedExitCode = code;
  save();
  // Restricted permissions must not hang the supervisor or appear as clean
  // teardown. Leave a failure receipt even if the child cannot be stopped.
  stopTimer = setTimeout(() => {
    if (child.connected) child.disconnect();
    child.unref();
    finish(code);
  }, 1000);
}

function interrupted() { stop('SIGINT', 130); }
function terminated() { stop('SIGTERM', 143); }
process.on('SIGINT', interrupted);
process.on('SIGTERM', terminated);
child.on('message', message => {
  if (message?.type !== 'jianlibao:webkit-lifecycle' || stopped || finished) return;
  if (message.event === 'begin') arm('waiting-for-worker', 60_000);
  if (message.event === 'test-begin') {
    // Playwright owns the live test timeout, including test.setTimeout changes.
    // This supervisor bounds cleanup only, never a snapshot of the body limit.
    clearTimeout(timer);
    receipt.phase = 'test';
    save();
  }
  if (message.event === 'after-hooks') arm('test-fixture-cleanup', cleanupMs);
  if (message.event === 'test-end') {
    receipt.completedAssertions++;
    if (message.status === 'passed') receipt.passedAssertions++;
    arm('between-tests-or-worker-cleanup', cleanupMs);
  }
  if (message.event === 'end') arm('report-and-server-cleanup', cleanupMs);
});
child.on('error', error => { receipt.spawnError = error.message; finish(1); });
child.on('exit', (code, signal) => {
  cliExited = true;
  receipt.cliExitCode = code;
  receipt.signal = signal;
  save();
});
child.on('close', (code) => finish(receipt.forcedExitCode ?? code ?? 1));
arm('starting', 60_000);
