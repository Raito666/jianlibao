import type { Locator } from '@playwright/test';

type Credit = { author: string; license: string; sourceUrl: string; licenseUrl: string };

/** Shared checks used by both positive and deliberate negative browser cases. */
export async function mediaCreditFindings(container: Locator, expected: Credit): Promise<string[]> {
  return container.evaluate((element, expected) => {
    const findings: string[] = [];
    function checkVisible(node: Element, key: string) {
      // A flex credit row stretches past the text. Windows WebKit can round
      // a blank far corner into the following row. Check every actual author /
      // separator / license fragment; keep full44px rectangles for links.
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...(key === 'credit' ? range.getClientRects() : node.getClientRects())];
      let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
      let hidden = !rects.length;
      const containerBox = element.getBoundingClientRect();
      left = Math.max(left, containerBox.left); top = Math.max(top, containerBox.top);
      right = Math.min(right, containerBox.right); bottom = Math.min(bottom, containerBox.bottom);
      for (let parent: Element | null = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        hidden ||= style.visibility === 'hidden' || style.visibility === 'collapse' ||
          style.display === 'none' || Number(style.opacity) <= 0.05;
        if (parent === node) continue;
        const bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);
        }
      }
      if (hidden) findings.push(key + ':hidden');
      const clipped = rects.some(rect => rect.width <= 0 || rect.height <= 0 ||
        rect.left < left - 1 || rect.right > right + 1 || rect.top < top - 1 || rect.bottom > bottom + 1 ||
        [[rect.left + 1, rect.top + 1], [rect.right - 1, rect.bottom - 1]].some(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !hit || !(hit === node || node.contains(hit));
        }));
      if (clipped) findings.push(key + ':clipped');
    }
    const credits = element.querySelectorAll('.reference-credit > span:first-child');
    if (credits.length !== 1) findings.push('credit:count');
    else {
      const text = credits[0].textContent?.replace(/\s+/g, ' ').trim();
      if (text !== `${expected.author} · ${expected.license}`) findings.push('credit:text');
      checkVisible(credits[0], 'credit');
    }
    for (const [key, label, href] of [['source', '原始素材', expected.sourceUrl], ['license', '许可', expected.licenseUrl]]) {
      const links = [...element.querySelectorAll('a')].filter(link => link.textContent?.trim() === label);
      if (links.length !== 1) findings.push(key + ':count');
      else {
        if (links[0].getAttribute('href') !== href) findings.push(key + ':href');
        checkVisible(links[0], key);
      }
    }
    return findings;
  }, expected);
}
