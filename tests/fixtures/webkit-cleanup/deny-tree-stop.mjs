// Test-only fault injection for the real access-denied path observed locally.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const original = cp.spawnSync;
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/run-webkit.mjs')) {
  cp.spawnSync = function (command, ...args) {
    if (command === 'taskkill.exe')
      return { status: 5, signal: null, stdout: '', stderr: 'fixture: access denied', error: undefined };
    return Reflect.apply(original, this, [command, ...args]);
  };
  syncBuiltinESMExports();
}
