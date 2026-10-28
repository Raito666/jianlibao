import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAssetCopies } from '../../scripts/verify-ios-assets.mjs';

const fixtures: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'jianlibao-ios-sync-'));
  fixtures.push(root);
  const web = join(root, 'dist'),
    native = join(root, 'native');
  for (const directory of [web, native]) {
    await mkdir(join(directory, 'art'), { recursive: true });
    await writeFile(join(directory, 'index.html'), '<html><head></head><body>健力宝</body></html>');
    await writeFile(join(directory, 'art/深蹲.svg'), '<svg>frame</svg>');
  }
  return { web, native };
}
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('iOS copied Web asset integrity', () => {
  it('checks nested non-ASCII resources by bytes and permits only the generated Cordova shims', async () => {
    const { web, native } = await fixture();
    await writeFile(join(native, 'cordova.js'), '');
    await writeFile(join(native, 'cordova_plugins.js'), '');
    const result = await verifyAssetCopies(web, native);
    expect(result.files).toHaveLength(2);
    expect(result.files.find((file) => file.path === 'art/深蹲.svg')?.bytes).toBe(16);
    expect(result.extraFiles).toEqual(['cordova.js', 'cordova_plugins.js']);
  });
  it('rejects a missing offline illustration instead of accepting the HTML alone', async () => {
    const { web, native } = await fixture();
    await rm(join(native, 'art/深蹲.svg'));
    await expect(verifyAssetCopies(web, native)).rejects.toThrow('art/深蹲.svg');
  });
  it('rejects stale copied content even when file names and lengths still match', async () => {
    const { web, native } = await fixture();
    await writeFile(join(native, 'art/深蹲.svg'), '<svg>stale</svg>');
    await expect(verifyAssetCopies(web, native)).rejects.toThrow('art/深蹲.svg');
  });
  it('rejects stale extras left by an older native sync', async () => {
    const { web, native } = await fixture();
    await writeFile(join(native, 'old-bundle.js'), 'stale');
    await expect(verifyAssetCopies(web, native)).rejects.toThrow('old-bundle.js');
  });
  it('rejects an empty source bundle', async () => {
    const { web, native } = await fixture();
    await rm(join(web, 'index.html'));
    await expect(verifyAssetCopies(web, native)).rejects.toThrow('index.html');
  });
});
