import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runRoot = fileURLToPath(new URL('../artifacts/e2e-runs/', import.meta.url));

// Playwright workers inherit the parent CLI's directory. A new CLI gets a new
// directory; neither invocation clears an earlier run or historical evidence.
export function getE2ERunDirectory(env = process.env, base = runRoot) {
  mkdirSync(base, { recursive: true });
  base = realpathSync(base);
  if (env.JLB_E2E_RUN_DIR) {
    const inherited = realpathSync(resolve(env.JLB_E2E_RUN_DIR));
    if (dirname(inherited) !== base)
      throw new Error('E2E output must stay inside this project’s run directory.');
    return inherited;
  }
  const directory = mkdtempSync(join(base, 'run-'));
  env.JLB_E2E_RUN_DIR = directory;
  return directory;
}
