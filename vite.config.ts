import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Keep min/max media queries usable on older iPhone and Android WebViews.
  build: { cssTarget: ['safari15.4', 'chrome90'] },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
