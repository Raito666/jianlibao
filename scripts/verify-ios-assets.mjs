import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function listFiles(root, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported asset entry: ${path}`);
  }
  return files.sort();
}

/** Check the complete offline bundle, including nested illustrations, rather than just its entry point. */
export async function verifyAssetCopies(webDir, nativeDir) {
  const [source, destination] = await Promise.all([listFiles(webDir), listFiles(nativeDir)]);
  if (!source.includes('index.html')) throw new Error('Web bundle is missing index.html; run pnpm build first');
  const destinationSet = new Set(destination);
  const files = [];
  for (const path of source) {
    if (!destinationSet.has(path)) throw new Error(`Missing copied asset: ${path}`);
    const [web, native] = await Promise.all([readFile(join(webDir, path)), readFile(join(nativeDir, path))]);
    if (!web.equals(native)) throw new Error(`Copied asset differs from Web build: ${path}`);
    files.push({ path, bytes: web.length, sha256: createHash('sha256').update(web).digest('hex') });
  }
  const sourceSet = new Set(source);
  const extraFiles = destination.filter((path) => !sourceSet.has(path));
  const stale = extraFiles.filter((path) => path !== 'cordova.js' && path !== 'cordova_plugins.js');
  if (stale.length) throw new Error(`Unexpected native assets: ${stale.join(', ')}`);
  return { files, extraFiles };
}
