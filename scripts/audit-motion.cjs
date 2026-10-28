const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const postcss = createRequire(require.resolve('vite'))('postcss');
const root = path.resolve(__dirname, '..');
const output = path.resolve(root, process.argv[2] || 'artifacts/stage3-2026-10-17/motion-audit.json');
const sheets = fs
  .readdirSync(path.join(root, 'src/styles'))
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({
    file: `src/styles/${file}`,
    ast: postcss.parse(fs.readFileSync(path.join(root, 'src/styles', file), 'utf8')),
  }));
const variables = new Map();
for (const { ast } of sheets)
  ast.walkDecls((decl) => {
    if (decl.prop.startsWith('--')) variables.set(decl.prop, decl.value);
  });
function resolve(value) {
  for (let i = 0; i < 12 && /var\(/.test(value); i++)
    value = value.replace(/var\((--[\w-]+)\)/g, (match, key) => variables.get(key) || match);
  return value;
}
const violations = [],
  declarations = [],
  safeAreas = [];
const forbidden = new Set([
  'width',
  'height',
  'top',
  'right',
  'bottom',
  'left',
  'margin',
  'padding',
  'font-size',
  'line-height',
  'border-width',
  'all',
]);
for (const { file, ast } of sheets) {
  ast.walkDecls((decl) => {
    const value = resolve(decl.value);
    const entry = {
      file,
      line: decl.source.start.line,
      selector: decl.parent.selector || decl.parent.name,
      property: decl.prop,
      value,
    };
    if (decl.value.includes('var(--safe-')) safeAreas.push(entry);
    let parent = decl.parent,
      inFrames = false;
    while (parent) {
      if (parent.type === 'atrule' && parent.name.endsWith('keyframes')) inFrames = true;
      parent = parent.parent;
    }
    if (inFrames && !['transform', 'opacity'].includes(decl.prop))
      violations.push({ ...entry, reason: 'Keyframes must use transform/opacity only' });
    if (/^(transition|animation)(-|$)/.test(decl.prop) || inFrames) {
      declarations.push(entry);
      if (/\b(?:linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)\b/.test(value))
        violations.push({ ...entry, reason: 'Unapproved easing' });
      if (/var\(/.test(value)) violations.push({ ...entry, reason: 'Unresolved motion variable' });
      if (decl.prop === 'transition' || decl.prop === 'transition-property') {
        const items = postcss.list.comma(value).map((item) => item.trim().split(/\s/)[0]);
        if (items.some((item) => forbidden.has(item))) violations.push({ ...entry, reason: 'Layout/all transition' });
      }
      for (const time of value.matchAll(/([\d.]+)(ms|s)\b/g)) {
        const duration = Number(time[1]) * (time[2] === 's' ? 1000 : 1);
        if (duration > 320) violations.push({ ...entry, reason: 'Motion exceeds entry budget' });
      }
      if (inFrames && decl.prop === 'transform') {
        const offsets = [...value.matchAll(/translateY\((-?[\d.]+)px\)|translate\([^,]+,\s*(-?[\d.]+)px\)/g)].map(
          (match) => Math.abs(Number(match[1] || match[2])),
        );
        if (offsets.some((offset) => offset > 8))
          violations.push({ ...entry, reason: 'Entry/exit displacement exceeds 8px' });
      }
    }
    if (/linear\(/.test(decl.value)) violations.push({ ...entry, reason: 'CSS linear() prohibited' });
    if (decl.prop === 'will-change' && /(^|,)\s*\*/.test(decl.parent.selector || ''))
      violations.push({ ...entry, reason: 'Global will-change' });
  });
}
const expected = {
  '--duration-micro': '100ms',
  '--duration-local': '120ms',
  '--duration-page': '200ms',
  '--duration-full': '300ms',
  '--duration-enter': '240ms',
  '--duration-exit': '120ms',
  '--stagger-step': '20ms',
};
for (const [key, value] of Object.entries(expected))
  if (variables.get(key) !== value) violations.push({ property: key, reason: `Expected ${value}` });
const motion = fs.readFileSync(path.join(root, 'src/styles/motion.css'), 'utf8');
if (
  !/prefers-reduced-motion: reduce/.test(motion) ||
  !/transition-property:\s*background-color, border-color, color, opacity/.test(motion)
)
  violations.push({ reason: 'Reduced-motion must retain state feedback' });
const contexts = [...new Set(safeAreas.map((item) => item.selector))];
if (contexts.length < 8) violations.push({ reason: 'Fewer than eight inset contexts' });
const result = {
  pass: violations.length === 0,
  declarations,
  violations,
  durations: expected,
  safeAreas,
  safeContexts: contexts,
  listBudget: 'Browser test asserts at most six animations, each duration+delay <=300ms',
  limitations: [
    'Static CSS checks do not certify real-device frame rate or prove every interaction uses the tokens; browser integration and actual iOS device verification are separate.',
  ],
  generatedAt: new Date().toISOString(),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({ pass: result.pass, declarations: declarations.length, safeContexts: contexts, violations }, null, 2),
);
if (!result.pass) process.exitCode = 1;
