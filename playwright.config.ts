import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { getE2ERunDirectory } from './scripts/e2e-output.mjs';

const runDirectory = getE2ERunDirectory();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  outputDir: join(runDirectory, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: join(runDirectory, 'report'), open: 'never' }],
    ['json', { outputFile: join(runDirectory, 'report.json') }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5426',
    browserName: 'chromium',
    launchOptions: {
      executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    },
    viewport: { width: 1440, height: 980 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5426 --strictPort',
    url: 'http://127.0.0.1:5426',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
