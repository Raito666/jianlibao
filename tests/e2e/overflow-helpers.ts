import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

export const longText = (length: number) => {
  const sample = '超长训练名称ABCxyz0123456789无空格';
  return sample.repeat(Math.ceil(length / sample.length)).slice(0, length);
};
export const overflowRuns = new WeakMap<TestInfo, OverflowRun>();

/** Inspect layout, not scrollWidth alone: ellipses and local scrollports retain full text. */
export async function overflowFindings(page: Page) {
  return page.evaluate(() => {
    const findings: { kind: string; element: string; text: string; excess: number }[] = [];
    const epsilon = 1;
    // overflow-y:auto implicitly computes overflow-x:auto. That is not sufficient
    // evidence of an intentional horizontal scroll area (for example modal bodies).
    const horizontalRules: string[] = [];
    function collectScrollRules(rules: CSSRuleList) {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && !matchMedia(rule.conditionText).matches) continue;
        if (rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) continue;
        if (rule instanceof CSSStyleRule && /^(auto|scroll)$/.test(rule.style.overflowX)) horizontalRules.push(rule.selectorText);
        if ('cssRules' in rule) collectScrollRules((rule as CSSGroupingRule).cssRules);
      }
    }
    for (const sheet of document.styleSheets) collectScrollRules(sheet.cssRules);
    const horizontalIntent = new WeakMap<HTMLElement, boolean>();
    const allowsHorizontalScroll = (el: HTMLElement) => {
      let known = horizontalIntent.get(el);
      if (known === undefined) {
        known = /^(auto|scroll)$/.test(el.style.overflowX) || horizontalRules.some(selector => el.matches(selector));
        horizontalIntent.set(el, known);
      }
      return known;
    };
    const describe = (el: Element) => `${el.tagName.toLowerCase()}.${el.className}`;
    const add = (kind: string, el: Element, excess: number) => findings.push({ kind, element: describe(el), text: (el.textContent || '').trim().slice(0, 100), excess: Math.round(excess * 100) / 100 });
    if (document.documentElement.scrollWidth > innerWidth + epsilon) add('document', document.documentElement, document.documentElement.scrollWidth - innerWidth);
    const visible = (el: HTMLElement) => {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      // Explicit screen-reader-only clipping is not a visible text label.
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return !((s.clip !== 'auto' || s.clipPath !== 'none') && r.width <= 1 && r.height <= 1);
    };
    const textClip = (el: HTMLElement): HTMLElement | null => {
      for (let target: HTMLElement | null = el; target && target !== document.body; target = target.parentElement) {
        const s = getComputedStyle(target);
        const ellipsis = s.display !== 'inline' && target.clientWidth > 0 && s.textOverflow === 'ellipsis' && /^(hidden|clip)$/.test(s.overflowX) && s.whiteSpace === 'nowrap';
        const clamp = Number(s.webkitLineClamp) > 0 && s.webkitBoxOrient === 'vertical' && /^(flow-root|-webkit-box|-webkit-inline-box)$/.test(s.display) && s.overflowY === 'hidden';
        if (ellipsis || clamp) return target;
      }
      return null;
    };
    const scrollport = (el: HTMLElement): HTMLElement | null => {
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const s = getComputedStyle(parent);
        if (/^(auto|scroll)$/.test(s.overflowX) && parent.scrollWidth > parent.clientWidth + epsilon && allowsHorizontalScroll(parent)) return parent;
      }
      return null;
    };
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
      if (!(el instanceof HTMLElement) || !visible(el) || el.closest('svg,script,style,option')) continue;
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const nodes = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      // Decorative artwork and intentional container bleed are not text overflow.
      // Descendant text/controls still get their own geometric checks.
      if (!nodes.length && !el.matches('input,textarea,select') && !(/^(auto|scroll)$/.test(s.overflowX) && el.scrollWidth > el.clientWidth + epsilon)) continue;
      const port = scrollport(el);
      const hasHorizontalScroll = /^(auto|scroll)$/.test(s.overflowX) && el.scrollWidth > el.clientWidth + epsilon;
      const selfScrolls = hasHorizontalScroll && allowsHorizontalScroll(el);
      if (hasHorizontalScroll && !selfScrolls) add('implicit-horizontal-scroll', el, el.scrollWidth - el.clientWidth);
      const clip = textClip(el);
      // Descendants inherit effective visible bounds from a working ellipsis/clamp.
      // The clipping element itself is still checked against its parent and viewport.
      if (clip && clip !== el && !el.matches('input,textarea,select')) continue;
      // Elements inside a bounded horizontal scrollport can be wider than it.
      if (!port && (r.right > innerWidth + epsilon || r.left < -epsilon)) add('box-viewport', el, Math.max(r.right - innerWidth, -r.left));
      const parent = el.parentElement;
      if (parent && !port && getComputedStyle(parent).display !== 'inline') {
        const p = parent.getBoundingClientRect();
        if (r.right > p.right + epsilon || r.left < p.left - epsilon) add('box-parent', el, Math.max(r.right - p.right, p.left - r.left));
      }
      // Native editors manage their own caret scrolling. Their outer boxes were checked above.
      if (el.matches('input,textarea,select')) continue;
      if (!nodes.length) continue;
      if (clip || selfScrolls) continue;
      for (const node of nodes) {
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          // Inline fragments may wrap; compare to the nearest block/flex/grid container.
          let boundary: HTMLElement | null = el;
          while (boundary && getComputedStyle(boundary).display === 'inline') boundary = boundary.parentElement;
          if (!boundary) continue;
          const b = boundary.getBoundingClientRect();
          if (rect.right > b.right + epsilon || rect.left < b.left - epsilon) add('text-container', el, Math.max(rect.right - b.right, b.left - rect.left));
        }
      }
    }
    for (const text of document.querySelectorAll<SVGTextElement>('svg text')) {
      if (!text.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || !text.textContent?.trim()) continue;
      const r = text.getBoundingClientRect(), frame = text.ownerSVGElement!.getBoundingClientRect();
      if (r.right > frame.right + epsilon || r.left < frame.left - epsilon) add('svg-text-container', text, Math.max(r.right - frame.right, frame.left - r.left));
    }
    return findings;
  });
}

export class OverflowRun {
  readonly findings: { state: string; issues: Awaited<ReturnType<typeof overflowFindings>> }[] = [];
  readonly fields: { state: string; tag: string; type: string; label: string; value: string; maxlength: number | null }[] = [];
  readonly metrics: { state: string; elements: unknown[] }[] = [];
  constructor(readonly page: Page, readonly info: TestInfo, readonly alphabet: 'mixed' | 'ascii' = 'mixed') { overflowRuns.set(info, this); }

  async capture(state: string) {
    await this.page.evaluate(() => document.fonts.ready);
    await this.page.waitForFunction(() => document.getAnimations().every(a => a.effect?.getComputedTiming().iterations === Infinity || (a.playState !== 'running' && !a.pending)), undefined, { timeout: 10_000 });
    const issues = await overflowFindings(this.page);
    this.findings.push({ state, issues });
    if (issues.length && !state.includes(':number-')) await this.page.screenshot({ path: this.info.outputPath(`${state}.png`), animations: 'disabled' });
    if (issues.length && !state.includes(':number-')) this.metrics.push({ state, elements: await this.page.locator('.summary-grid .stat,.summary-grid .stat-value,.summary-grid .stat-value small,.session-card,.session-card-body,.session-card-title,.session-note,.records-list,.records-list > button,.records-list strong').evaluateAll(elements => elements.map(el => {
      const style = getComputedStyle(el), r = el.getBoundingClientRect(), p = el.parentElement!.getBoundingClientRect();
      return { element: el.tagName + '.' + el.className, text: el.textContent?.slice(0, 80), width: r.width, left: r.left, right: r.right, parentLeft: p.left, parentRight: p.right, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, display: style.display, minWidth: style.minWidth, columns: style.gridTemplateColumns, overflow: style.overflowX, whiteSpace: style.whiteSpace };
    })) });
    this.fields.push(...await this.page.locator('input,textarea,select').evaluateAll((elements, currentState) => elements.filter(el => el.checkVisibility()).map(el => {
      const field = el as HTMLInputElement;
      return { state: currentState, tag: el.tagName.toLowerCase(), type: field.type, label: el.getAttribute('aria-label') || [...(field.labels || [])].map(label => label.textContent?.trim()).join(' '), value: field.value, maxlength: field.maxLength >= 0 ? field.maxLength : null };
    }), state));
    console.log(`overflow checkpoint: ${state}`);
  }

  async text(field: Locator, length: number) {
    const value = this.alphabet === 'ascii' ? 'X'.repeat(length) : longText(length);
    // A controlled textarea's text node can become part of its wrapping label after input.
    // Keep a stable structural locator rather than resolving the now-expanded label again.
    const textareaIndex = await field.evaluate(el => el.tagName === 'TEXTAREA' ? [...document.querySelectorAll('textarea')].indexOf(el as HTMLTextAreaElement) : -1);
    const stable = textareaIndex < 0 ? field : this.page.locator('textarea').nth(textareaIndex);
    await stable.fill(value);
    await expect(stable).toHaveValue(value);
    return value;
  }

  /** Reach valid numeric boundaries without feeding impossible strings to typed controls. */
  async numeric(scope: Locator, state: string) {
    const fields = scope.locator('input[type=number]:not([readonly]):not([disabled])');
    for (let i = 0; i < await fields.count(); i++) {
      const field = fields.nth(i), original = await field.inputValue();
      const max = await field.getAttribute('max');
      await field.fill(max || '999999');
      await expect(field).toHaveValue(max || '999999');
      await this.capture(`${state}:number-${i}-max`);
      await field.fill(original);
      await field.blur();
    }
  }

  async report() {
    for (const [name, content] of [['overflow-findings', this.findings], ['editable-fields', this.fields], ['layout-metrics', this.metrics]] as const) {
      const path = this.info.outputPath(`${name}.json`);
      await writeFile(path, JSON.stringify(content, null, 2));
      await this.info.attach(name, { path, contentType: 'application/json' });
    }
  }

  async finish() {
    const errors = this.findings.filter(entry => entry.issues.length);
    if (errors.length) await this.page.screenshot({ path: this.info.outputPath('last-state.png'), fullPage: true });
    expect(errors, '可见文本/容器越界；报告逐状态保留，不忽略真实裁切').toEqual([]);
  }
}

export async function nav(page: Page, name: string) {
  await page.getByRole('navigation', { name: '移动端导航', exact: true }).getByRole('button', { name, exact: true }).click();
}
