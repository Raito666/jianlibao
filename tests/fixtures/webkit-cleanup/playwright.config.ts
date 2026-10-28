import { defineConfig } from '@playwright/test';
import base from '../../../playwright.webkit.config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'lifecycle.spec.ts',
  webServer: undefined,
  globalSetup: fileURLToPath(new URL('./setup.mjs', import.meta.url)),
  timeout: 1000,
  // This test deliberately does not need a browser to replay the runner seam.
});
