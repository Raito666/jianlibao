import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getE2ERunDirectory } from './scripts/e2e-output.mjs';

const runDirectory = getE2ERunDirectory();

// A separate engine lane reuses these existing tests without changing their
// assertions. It does not replace the complete default Edge suite.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    '**/cloud-sync.spec.ts',
    '**/ios-cloud-sync.spec.ts',
    '**/web.spec.ts',
    '**/training-experience.spec.ts',
    '**/stage6-records-body.spec.ts',
    '**/stage7-information-architecture.spec.ts',
    '**/history-calendar.spec.ts',
    '**/mobile-layout-compat.spec.ts',
    '**/mobile-usability.spec.ts',
    '**/mobile-continuity.spec.ts',
    '**/overflow.spec.ts',
    '**/reference-library.spec.ts',
    '**/reference-media.spec.ts',
    '**/reference-video-errors.spec.ts',
    '**/pwa-activation-race.spec.ts',
    '**/reference-recovery.spec.ts',
    '**/reference-upgrade.spec.ts',
    '**/reviewed-videos.spec.ts',
    '**/rendered-art.spec.ts',
    '**/view-transition-snapshot.spec.ts',
    '**/art-control-contrast.spec.ts',
    ...(process.platform === 'win32'
      ? ['**/webkit-resize-media.spec.ts', '**/webkit-native-transition.spec.ts']
      : []),
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: join(runDirectory, 'test-results'),
  reporter: [
    [fileURLToPath(new URL('./scripts/webkit-lifecycle-reporter.mjs', import.meta.url))],
    ['list'],
    ['html', { outputFolder: join(runDirectory, 'report'), open: 'never' }],
    ['json', { outputFile: join(runDirectory, 'report.json') }],
  ],
  metadata: {
    engine: 'Playwright WebKit',
    hostPlatform: process.platform,
    actualIOS: false,
  },
  projects: [{ name: 'webkit', use: { browserName: 'webkit' } }],
  use: {
    baseURL: 'http://127.0.0.1:5442',
    viewport: { width: 1440, height: 980 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    // The Windows software compositor crashes on native snapshot resize and
    // successive captures, even in a page without application code. Keep the
    // available compositor enabled; retain all other Playwright defaults.
    ...(process.platform === 'win32'
      ? { launchOptions: { ignoreDefaultArgs: ['--disable-accelerated-compositing'] } }
      : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5442 --strictPort',
    url: 'http://127.0.0.1:5442',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
