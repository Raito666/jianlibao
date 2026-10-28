/* Audit literal and resolved CSS values; CSS variables cannot hide extra scale values. */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { createRequire } = require('module');
const postcss = createRequire(require.resolve('vite'))('postcss');
const root = path.resolve(__dirname, '..');
const bundledGit = 'C:/Users/PC/AppData/Local/GitHubDesktop/app-3.6.7/resources/app/git/cmd/git.exe';
const gitBinary = process.env.JLB_GIT_BINARY || (fs.existsSync(bundledGit) ? bundledGit : 'git');
const baselineRef = process.argv[2] || 'v0.4.0-stage1';
const outputPath = path.resolve(root, process.argv[3] || 'artifacts/stage2-2026-10-16/css-audit.json');
function gitFile(ref, file) {
  const result = cp.spawnSync(gitBinary, ['-c', 'safe.directory=' + root.replaceAll('\\', '/'), 'show', ref + ':' + file], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout;
}
function sheets(read) {
  const found = [];
  function visit(file) {
    const text = read(file);
    const ast = postcss.parse(text, { from: file });
    ast.walkAtRules('import', rule => {
      const match = rule.params.match(/["']([^"']+)["']/);
      if (!match) throw new Error('Unsupported import: ' + rule.params);
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
    });
    found.push({ file, ast });
  }
  visit('src/styles.css');
  return found;
}
const sorted = values => [...new Set(values)].sort((a, b) => a - b);
function variables(input, theme) {
  const vars = new Map();
  for (const { ast } of input) ast.walkDecls(/^--/, decl => {
    const selector = decl.parent.selector || '';
    if (selector === ':root' || (theme === 'light' && selector === ':root[data-theme="light"]')) vars.set(decl.prop, decl.value);
  });
  return vars;
}
function resolve(value, vars, trail = []) {
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fallback) => {
    if (trail.includes(name)) throw new Error('Cyclic CSS variable: ' + [...trail, name].join(' -> '));
    if (!vars.has(name)) {
      if (fallback !== undefined) return fallback;
      throw new Error('Missing CSS variable: ' + name);
    }
    return resolve(vars.get(name), vars, [...trail, name]);
  });
}
function audit(input, allowedFontSizes, allowedFontWeights) {
  const font = [], directFont = [], radius = [], weights = [], space = [];
  const violations = { fontSize: [], radius: [], weight: [], spacing: [], unresolved: [], negativeTracking: [], italic: [], shadowsOutsideModal: [], rawColorsOutsideTokens: [] };
  const fontFunctions = [], inheritedRadius = [], declarations = [];
  for (const theme of ['dark', 'light']) {
    const vars = variables(input, theme);
    for (const { file, ast } of input) ast.walkDecls(decl => {
      // Font-face descriptors describe supported ranges, not rendered UI style values.
      if (decl.parent.type === 'atrule' && decl.parent.name === 'font-face') return;
      if (decl.prop.startsWith('--')) return;
      const selector = decl.parent.selector || '@' + decl.parent.name;
      const record = { theme, file, line: decl.source.start.line, selector, property: decl.prop, value: decl.value };
      let value;
      try { value = resolve(decl.value, vars); } catch (error) { violations.unresolved.push({ ...record, reason: error.message }); return; }
      record.resolved = value;
      const px = [...value.matchAll(/(-?\d*\.?\d+)px\b/g)].map(match => Number(match[1]));
      if (decl.prop === 'font-size') {
        declarations.push(record);
        font.push(...px);
        if (/^\d+(?:\.\d+)?px$/.test(decl.value)) directFont.push(Number.parseFloat(decl.value));
        if (/clamp\(|calc\(|min\(|max\(/.test(value)) fontFunctions.push(record);
        if (px.some(n => !allowedFontSizes.includes(n)) || !/^\d+(?:\.\d+)?px$/.test(value)) violations.fontSize.push(record);
      }
      if (decl.prop === 'border-radius') {
        radius.push(...px.filter(n => n !== 0 && n !== 9999));
        if (value === 'inherit') inheritedRadius.push(record);
        if (px.some(n => ![0,6,8,12,9999].includes(n)) || (value.includes('%') && value !== '50%')) violations.radius.push(record);
      }
      if (decl.prop === 'font-weight') {
        const n = Number(value); if (Number.isFinite(n)) weights.push(n);
        if (!allowedFontWeights.includes(n)) violations.weight.push(record);
      }
      if (/^(padding|margin)(-|$)|^(gap|row-gap|column-gap)$/.test(decl.prop)) {
        space.push(...px); if (px.some(n => n % 4 !== 0)) violations.spacing.push(record);
      }
      if (decl.prop === 'letter-spacing' && Number.parseFloat(value) < 0) violations.negativeTracking.push(record);
      if (decl.prop === 'font-style' && value !== 'normal') violations.italic.push(record);
      if (decl.prop === 'box-shadow' && value !== 'none' && !/^\.modal$/.test(selector)) violations.shadowsOutsideModal.push(record);
      if (!file.endsWith('/tokens.css') && /#[0-9a-f]{3,8}\b/i.test(value) && /#[0-9a-f]{3,8}\b/i.test(decl.value)) violations.rawColorsOutsideTokens.push(record);
    });
  }
  const count = Object.fromEntries(Object.entries(violations).map(([key, value]) => [key, value.length]));
  return { files: input.map(item => item.file), fontSizeValuesPx: sorted(font), directFontSizeValuesPx: sorted(directFont), fontSizeFunctions: fontFunctions, radiusValuesPxExcludingZeroAndCircles: sorted(radius), fontWeights: sorted(weights), spacingPxSubvalues: sorted(space), inheritedRadiusDeclarations: inheritedRadius, violations: count, violationDetails: violations, fontSizeDeclarations: declarations };
}
function rgb(value) {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0,2,4].map(i => parseInt(hex[1].slice(i, i + 2), 16));
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (!match) throw new Error('Unsupported contrast color: ' + value);
  return match[1].split(',').map(Number);
}
function luminance(color) {
  const [r,g,b] = color.map(channel => { const n = channel / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return Number(((values[0] + 0.05) / (values[1] + 0.05)).toFixed(3)); }
function contrastChecks(input) {
  const checks = [];
  for (const theme of ['dark', 'light']) {
    const vars = variables(input, theme);
    const c = name => rgb(resolve('var(' + name + ')', vars));
    for (const surface of ['--bg','--surface-1','--surface-2','--surface-3','--surface-4']) {
      for (const text of ['--text-primary','--text-secondary']) checks.push({ theme, foreground: text, background: surface, ratio: contrast(c(text), c(surface)), minimum: theme === 'dark' ? 7 : 4.5 });
      checks.push({ theme, foreground: '--control-border', background: surface, ratio: contrast(c('--control-border'), c(surface)), minimum: 3 });
    }
    for (const accent of ['--accent','--accent-hover','--accent-active']) checks.push({ theme, foreground: '--accent-ink', background: accent, ratio: contrast(c('--accent-ink'), c(accent)), minimum: 4.5 });
  }
  return checks.map(check => ({ ...check, pass: check.ratio >= check.minimum }));
}
const beforeSheets = sheets(file => gitFile(baselineRef, file));
const afterSheets = sheets(file => fs.readFileSync(path.join(root, file), 'utf8'));
const currentFontSizes = [11,13,16,18,22,26,40];
const before = audit(beforeSheets, [11,13,16,20,24,32], [400,500,600]), after = audit(afterSheets, currentFontSizes, [400,600,700]);
const contrastResults = contrastChecks(afterSheets);
const baseColorRoles = ['--bg', '--surface-1', '--surface-2', '--surface-3', '--surface-4', '--text-primary', '--text-secondary', '--text-tertiary', '--control-border', '--accent'];
const stateColorRoles = ['--border-subtle', '--border-default', '--border-strong', '--text-disabled', '--accent-hover', '--accent-active', '--accent-subtle', '--accent-text', '--accent-muted', '--accent-ink', '--activity-low', '--activity-mid', '--activity-high', '--danger', '--danger-subtle', '--warning', '--success', '--info', '--overlay-backdrop'];
const canvasColorRoles = ['--illustration-bg', '--illustration-ink', '--illustration-secondary', '--illustration-control'];
const palettes = ['dark', 'light'].map(theme => {
  const vars = variables(afterSheets, theme);
  const read = names => names.map(token => ({ token, value: resolve(`var(${token})`, vars) }));
  const classified = new Set([...baseColorRoles, ...stateColorRoles, ...canvasColorRoles]);
  const unclassifiedPrimitiveColors = [...vars].filter(([name, value]) => /^(#[0-9a-f]{3,8}|rgba?\([^()]+\))$/i.test(value) && !classified.has(name)).map(([token, value]) => ({ token, value }));
  const base = read(baseColorRoles);
  return { theme, base, baseRoleCount: base.length, uniqueBaseValues: new Set(base.map(item => item.value.toUpperCase())).size, states: read(stateColorRoles), illustrationCanvas: read(canvasColorRoles), unclassifiedPrimitiveColors };
});
const result = {
  baseline: baselineRef,
  generatedAt: new Date().toISOString(),
  method: 'PostCSS parses every imported declaration for each theme; recursively resolves custom properties, includes clamp endpoints, reports every spacing px subvalue and any unresolved value. Inherited radii are listed separately; zero and circle radii are excluded.',
  before, after, contrastResults, palettes,
  scope: 'Scale, spacing, declared style and token contrast checks; per-theme base palette <=12. User approved separate interaction, transparency and semantic state colors. Illustration canvas reuses the light content palette.',
  limitations: ['Contrast checks cover token foreground/background pairs. Actual composited browser colors, image overlays, layout, keyboard operation and hit targets require browser verification. Responsive font functions in the baseline are reported as ranges rather than reduced to their endpoints alone.'],
  pass: JSON.stringify(after.fontSizeValuesPx) === JSON.stringify(currentFontSizes) && JSON.stringify(after.radiusValuesPxExcludingZeroAndCircles) === JSON.stringify([6,8,12]) && Object.values(after.violations).every(value => value === 0) && contrastResults.every(check => check.pass) && palettes.every(palette => palette.baseRoleCount <= 12 && palette.unclassifiedPrimitiveColors.length === 0),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ outputPath, pass: result.pass, before: { font: before.fontSizeValuesPx, directFont: before.directFontSizeValuesPx, radius: before.radiusValuesPxExcludingZeroAndCircles, weight: before.fontWeights, spacing: before.spacingPxSubvalues }, after: { font: after.fontSizeValuesPx, radius: after.radiusValuesPxExcludingZeroAndCircles, weight: after.fontWeights, spacing: after.spacingPxSubvalues, violations: after.violations }, failedContrast: contrastResults.filter(check => !check.pass) }, null, 2));
if (!result.pass) process.exitCode = 1;
