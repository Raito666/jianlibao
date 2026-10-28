import { webkit } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Resolve from each owning package, including pnpm's isolated dependency layout.
export async function playwrightMetadata(from = import.meta.url) {
  const testPath = createRequire(from).resolve('@playwright/test/package.json');
  const playwrightPath = createRequire(testPath).resolve('playwright/package.json');
  const corePath = createRequire(playwrightPath).resolve('playwright-core/package.json');
  const pkg = JSON.parse(await readFile(testPath));
  const browsers = JSON.parse(await readFile(new URL('browsers.json', pathToFileURL(corePath))));
  const entry = browsers.browsers.find(browser => browser.name === 'webkit');
  if (!entry) throw new Error('Locked WebKit metadata is missing');
  return { playwright: pkg.version, webkitRevision: entry.revision };
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Actual macOS required');
  const root = new URL('../../', import.meta.url);
  const metadata = await playwrightMetadata();
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage();
    const runtime = await page.evaluate(() => ({userAgent: navigator.userAgent, nativeViewTransition: typeof document.startViewTransition === 'function'}));
    const record = {host: process.platform, arch: process.arch, node: process.version, ...metadata, browserVersion: browser.version(), executable: webkit.executablePath(), ...runtime, actualIOS: false, officialSafariTested: false};
    await writeFile(new URL('artifacts/webkit-macos/browser-environment.json', root), JSON.stringify(record, null, 2));
    console.log(JSON.stringify(record));
  } finally { await browser.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
