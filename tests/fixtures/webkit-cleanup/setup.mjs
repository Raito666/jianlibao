import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
export default function setup() {
  if (process.env.JLB_INHERIT_PIPE === '1') {
    // Launched by the CLI itself, this descendant holds its stdout handle.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], {
      windowsHide: true, stdio: 'inherit',
    });
    child.unref();
    writeFileSync(join(process.env.JLB_E2E_RUN_DIR, 'pipe-holder.json'), JSON.stringify({ pid: child.pid }));
  }
}
