import { it, expect } from 'vitest';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

it('生产CSS保留iPhone和旧安卓浏览器可识别的手机断点，不生成MQ4范围语法', async () => {
  const root = fileURLToPath(new URL('../fixtures/safari-css/', import.meta.url));
  const config = fileURLToPath(new URL('../../vite.config.ts', import.meta.url));
  const result = await build({
    configFile: config,
    root,
    publicDir: false,
    logLevel: 'silent',
    build: {
      write: false,
      emptyOutDir: false,
      rolldownOptions: { input: fileURLToPath(new URL('../fixtures/safari-css/index.html', import.meta.url)) },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const css = bundles.flatMap(bundle => 'output' in bundle ? bundle.output : [])
    .filter(file => file.type === 'asset' && file.fileName.endsWith('.css'))
    .map(file => file.type === 'asset' ? String(file.source) : '')
    .join('\n');
  expect(css.length).toBeGreaterThan(1000);
  const rangeQueries = [...css.matchAll(/@media[^{}]*[<>]=?[^{}]*/g)].map(match => match[0]);
  expect(rangeQueries).toEqual([]);
  expect(/@media\s*\(max-width:\s*760px\)/.test(css)).toBe(true);
  expect(/@media\s*\(max-width:\s*359px\)/.test(css)).toBe(true);
  expect(/@media\s*\(min-width:\s*761px\)/.test(css)).toBe(true);
}, 30000);
