import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../capacitor.config.ts';
import { verifyAssetCopies } from './verify-ios-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFile(resolve(root, path), 'utf8');
const pkg = JSON.parse(await read('package.json'));
const native = JSON.parse(await read('ios/App/App/capacitor.config.json'));
const { packageClassList, ...syncedConfig } = native;
assert.deepEqual(syncedConfig, config, 'Native configuration is stale; run pnpm ios:sync');
assert.equal(config.appId, 'com.jianlibao.app');
assert.equal(config.appName, '健力宝');
assert.equal(config.webDir, 'dist');
assert.equal(native.loggingBehavior, 'none', 'Bridge logs must never contain sync credentials');
assert.equal(native.ios?.loggingBehavior ?? native.loggingBehavior, 'none');
assert.equal(config.server.hostname, 'localhost');
assert.equal(config.server.iosScheme, 'capacitor');
assert.equal(config.server.url, undefined, 'Native app must load its bundled assets');
assert.equal(config.server.cleartext, undefined);
assert.equal(config.server.allowNavigation, undefined);
assert.equal(config.ios.contentInset, 'never');
assert.deepEqual([...packageClassList].sort(), ['AppPlugin', 'CapacitorSQLitePlugin', 'FilesystemPlugin', 'HapticsPlugin', 'LocalNotificationsPlugin', 'SharePlugin', 'SplashScreenPlugin']);
assert.deepEqual(config.plugins.LocalNotifications.presentationOptions, []);
assert.equal(config.plugins.CapacitorSQLite.iosDatabaseLocation, 'Library/CapacitorDatabase');
assert.equal(config.plugins.CapacitorSQLite.iosIsEncryption, false);

const versions = {};
for (const name of ['core', 'cli', 'ios', 'splash-screen', 'app', 'filesystem', 'haptics', 'local-notifications', 'share']) {
  versions[name] = JSON.parse(await read(`node_modules/@capacitor/${name}/package.json`)).version;
  assert.equal(versions[name], pkg.dependencies[`@capacitor/${name}`] ?? pkg.devDependencies[`@capacitor/${name}`]);
}
assert.equal(versions.core, versions.ios);
assert.equal(versions.core, versions.cli);
versions.sqlite = JSON.parse(await read('node_modules/@capacitor-community/sqlite/package.json')).version;
assert.equal(versions.sqlite, pkg.dependencies['@capacitor-community/sqlite']);
assert.equal(pkg.dependencies['@capacitor/android'], undefined);
assert.equal(pkg.devDependencies['@capacitor/android'], undefined);

const project = await read('ios/App/App.xcodeproj/project.pbxproj');
assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.jianlibao\.app;/g) ?? []).length, 2);
assert.deepEqual(
  [...project.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((match) => match[1]),
  [pkg.version, pkg.version],
);
assert.ok(project.includes('relativePath = "CapApp-SPM";'));
assert.ok(project.includes('CapApp-SPM in Frameworks'));
const info = await read('ios/App/App/Info.plist');
assert.match(info, /<key>CFBundleDisplayName<\/key>\s*<string>健力宝<\/string>/);
assert.match(info, /<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<true\s*\/>/);
for (const path of [
  'AppDelegate.swift',
  'SceneDelegate.swift',
  'Base.lproj/Main.storyboard',
  'Base.lproj/LaunchScreen.storyboard',
]) {
  await access(resolve(root, 'ios/App/App', path));
}
const packagePath = resolve(root, 'ios/App/CapApp-SPM/Package.swift');
const swift = await readFile(packagePath, 'utf8');
assert.ok(swift.includes(`exact: "${versions.ios}"`));
assert.ok(swift.includes('.product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen")'));
const pluginPath = swift.match(/\.package\(name: "CapacitorSplashScreen", path: "([^"]+)"\)/)?.[1];
assert.ok(pluginPath, 'Splash plugin must have a local Swift package dependency');
await access(resolve(dirname(packagePath), pluginPath, 'Package.swift'));
assert.ok(swift.includes('.product(name: "CapacitorCommunitySqlite", package: "CapacitorCommunitySqlite")'));
const sqlitePath = swift.match(/\.package\(name: "CapacitorCommunitySqlite", path: "([^"]+)"\)/)?.[1];
assert.ok(sqlitePath, 'SQLite plugin must have a local Swift package dependency');
await access(resolve(dirname(packagePath), sqlitePath, 'Package.swift'));
for (const product of ['App', 'Filesystem', 'Haptics', 'LocalNotifications', 'Share']) {
  const name = `Capacitor${product}`;
  assert.ok(swift.includes(`.product(name: "${name}", package: "${name}")`));
  const match = swift.match(new RegExp(`\\.package\\(name: "${name}", path: "([^"]+)"\\)`));
  assert.ok(match, `${name} must have a local SPM package dependency`);
  await access(resolve(dirname(packagePath), match[1], 'Package.swift'));
}
const privacy = await read('ios/App/App/PrivacyInfo.xcprivacy');
assert.match(privacy, /NSPrivacyAccessedAPICategoryFileTimestamp/);
assert.match(privacy, /C617\.1/);
assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
assert.match(project, /path = PrivacyInfo\.xcprivacy/);

const assets = await verifyAssetCopies(resolve(root, config.webDir), resolve(root, 'ios/App/App/public'));
const result = {
  platform: 'ios',
  packageManager: 'SPM',
  versions,
  appId: config.appId,
  appName: config.appName,
  origin: `${config.server.iosScheme}://${config.server.hostname}`,
  webFiles: assets.files.length,
  totalBytes: assets.files.reduce((sum, file) => sum + file.bytes, 0),
  ...assets,
  nativeConfigurationMatches: true,
  iosBuildExecuted: false,
};
const reportAt = process.argv.indexOf('--report');
if (reportAt !== -1) {
  assert.ok(process.argv[reportAt + 1], '--report requires a file path');
  await writeFile(resolve(process.argv[reportAt + 1]), JSON.stringify(result, null, 2) + '\n');
}
console.log(
  `iOS SPM sync verified: ${result.webFiles} Web files (${result.totalBytes} bytes), configuration and plugin linkage match. No iOS build executed.`,
);
