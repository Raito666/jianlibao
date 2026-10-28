/** Read-only, viewport-scoped measurements. This probe does not certify accessibility. */
export async function auditPage(page) {
  return page.evaluate(() => {
    const styles = new WeakMap();
    const boxes = new WeakMap();
    const legacyClips = new WeakMap();
    const recordedClipExclusions = new Set();
    const colors = new Map();
    const css = (el) => {
      if (!styles.has(el)) styles.set(el, getComputedStyle(el));
      return styles.get(el);
    };
    const box = (el) => {
      if (!boxes.has(el)) boxes.set(el, el.getBoundingClientRect());
      return boxes.get(el);
    };
    const round = (n) => Math.round(n * 1000) / 1000;
    const rectData = (r) => ({ x: round(r.left), y: round(r.top), width: round(r.width), height: round(r.height) });
    const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    const color = (value) => {
      if (colors.has(value)) return colors.get(value);
      let result = null;
      if (context && CSS.supports('color', value)) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const p = context.getImageData(0, 0, 1, 1).data;
        result = [p[0] / 255, p[1] / 255, p[2] / 255, p[3] / 255];
      }
      colors.set(value, result);
      return result;
    };
    const over = (front, back) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return alpha
        ? [0, 1, 2].map((i) => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha)
        : [0, 0, 0, 0];
    };
    const luminance = (rgba) => rgba.slice(0, 3).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const selector = (el) => {
      const parts = [];
      for (let node = el; node instanceof Element; node = node.parentElement) {
        if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
        let part = node.localName;
        const names = [...node.classList].slice(0, 2);
        if (names.length) part += names.map((name) => `.${CSS.escape(name)}`).join('');
        const siblings = node.parentElement ? [...node.parentElement.children].filter((s) => s.localName === node.localName) : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        parts.unshift(part);
      }
      return parts.join(' > ');
    };
    const textLabel = (el) => {
      const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
      return el.getAttribute('aria-label') || labelled || [...(el.labels || [])].map((l) => l.innerText).join(' ').trim()
        || el.innerText?.trim() || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '';
    };
    const disabled = (el) => {
      if (el.closest(':disabled, [aria-disabled="true"]')) return true;
      return Boolean(el.closest('label')?.control?.matches(':disabled, [aria-disabled="true"]'));
    };
    const legacyClip = (el) => {
      if (legacyClips.has(el)) return legacyClips.get(el);
      const s = css(el), match = /^rect\((.*)\)$/.exec(s.clip);
      let result = null;
      // Legacy clip only affects absolutely/fixed positioned elements; a static rect(0,0,0,0) still paints.
      if (match && /^(absolute|fixed)$/.test(s.position)) {
        const parts = match[1].trim().split(/\s*,\s*|\s+/);
        if (parts.length === 4 && parts.every((part) => part === 'auto' || /^[-+]?(?:\d*\.)?\d+(?:px)?$/.test(part))) {
          const b = box(el), width = el.offsetWidth || b.width, height = el.offsetHeight || b.height;
          const [top, right, bottom, left] = parts.map((part, i) => part === 'auto' ? [0, width, height, 0][i] : parseFloat(part));
          const scaleX = width ? b.width / width : 1, scaleY = height ? b.height / height : 1;
          result = { css: s.clip, empty: right <= left || bottom <= top,
            left: b.left + left * scaleX, right: b.left + right * scaleX,
            top: b.top + top * scaleY, bottom: b.top + bottom * scaleY };
        }
      }
      legacyClips.set(el, result);
      return result;
    };
    const hiddenReason = (el) => {
      if (css(el).visibility !== 'visible') return 'visibility';
      for (let node = el; node; node = node.parentElement) {
        const s = css(node);
        if (s.display === 'none' || s.contentVisibility === 'hidden') return 'display/content-visibility';
        if (Number(s.opacity) === 0) return 'opacity:0';
        const clip = legacyClip(node);
        if (clip?.empty) {
          const key = `${selector(el)}|${selector(node)}`;
          if (!recordedClipExclusions.has(key)) {
            recordedClipExclusions.add(key);
            excluded.physicallyClipped.push({ selector: selector(el), clipOwnerSelector: selector(node), clip: clip.css,
              reason: 'legacy-clip-empty: computed rect() has zero/inverted area on an absolute/fixed positioned element' });
          }
          return 'legacy-clip-empty';
        }
      }
      return null;
    };
    const clipped = (rect, el, includeViewport = true) => {
      let r = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      for (let node = el; node; node = node.parentElement) {
        const s = css(node), b = box(node);
        const legacy = legacyClip(node);
        if (legacy) {
          r.left = Math.max(r.left, legacy.left); r.right = Math.min(r.right, legacy.right);
          r.top = Math.max(r.top, legacy.top); r.bottom = Math.min(r.bottom, legacy.bottom);
        }
        if (node !== el && /hidden|clip|scroll|auto/.test(s.overflowX)) {
          r.left = Math.max(r.left, b.left + node.clientLeft);
          r.right = Math.min(r.right, b.left + node.clientLeft + node.clientWidth);
        }
        if (node !== el && /hidden|clip|scroll|auto/.test(s.overflowY)) {
          r.top = Math.max(r.top, b.top + node.clientTop);
          r.bottom = Math.min(r.bottom, b.top + node.clientTop + node.clientHeight);
        }
      }
      if (includeViewport) {
        r.left = Math.max(r.left, viewport.left); r.right = Math.min(r.right, viewport.right);
        r.top = Math.max(r.top, viewport.top); r.bottom = Math.min(r.bottom, viewport.bottom);
      }
      return r.right > r.left && r.bottom > r.top ? { ...r, width: r.right - r.left, height: r.bottom - r.top } : null;
    };
    const onTop = (el, r) => [0.25, 0.5, 0.75].some((fraction) => {
      const hit = document.elementFromPoint(r.left + r.width * fraction, r.top + r.height / 2);
      return hit && (hit === el || el.contains(hit) || hit.contains(el));
    });
    const visibleRects = (el, rects) => hiddenReason(el) ? [] : [...rects]
      .map((r) => clipped(r, el)).filter((r) => r && onTop(el, r));
    const visible = (el) => visibleRects(el, el.getClientRects()).length > 0;
    const contrastColors = (el, foreground, textOpacity = 1) => {
      let front = color(foreground), back = [0, 0, 0, 0];
      const manualReasons = [];
      if (!front) return { ratio: null, manualReasons: [`Unparsed foreground: ${foreground}`] };
      front = [...front]; front[3] *= textOpacity;
      for (let node = el; node; node = node.parentElement) {
        const s = css(node), background = color(s.backgroundColor);
        if (background) { front = over(front, background); back = over(back, background); }
        else manualReasons.push(`Unparsed background on ${selector(node)}: ${s.backgroundColor}`);
        if (s.backgroundImage !== 'none') manualReasons.push(`Background image/gradient on ${selector(node)}`);
        if (s.filter !== 'none' || s.mixBlendMode !== 'normal' || (s.backdropFilter && s.backdropFilter !== 'none')) {
          manualReasons.push(`Filter/blending on ${selector(node)}`);
        }
        const opacity = Number(s.opacity);
        front[3] *= opacity; back[3] *= opacity;
      }
      if (css(el).textShadow !== 'none') manualReasons.push('Text shadow requires visual judgment');
      front = over(front, [1, 1, 1, 1]); back = over(back, [1, 1, 1, 1]);
      const l1 = luminance(front), l2 = luminance(back);
      return { foreground: front.map(round), background: back.map(round), ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05), manualReasons: [...new Set(manualReasons)] };
    };
    const texts = [], controls = [], cards = [], skippedSvgTargets = [], disabledExceptions = [];
    const excluded = { hiddenTextNodes: 0, offscreenClippedOrOccludedTextNodes: 0, svgTextNodes: 0, emptyTextNodes: 0, physicallyClipped: [] };
    const dark = document.documentElement.dataset.theme === 'dark';
    function addText(el, value, kind, rects, pseudoStyle = null, textIndex = null) {
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text) { excluded.emptyTextNodes++; return; }
      if (hiddenReason(el)) { excluded.hiddenTextNodes++; return; }
      if (disabled(el)) { disabledExceptions.push({ selector: selector(el), text, kind, reason: 'Disabled control/associated label: exempt from automated contrast and 44px checks' }); return; }
      const rendered = visibleRects(el, rects);
      if (!rendered.length) { excluded.offscreenClippedOrOccludedTextNodes++; return; }
      const s = pseudoStyle || css(el), size = parseFloat(s.fontSize);
      if (pseudoStyle && (s.visibility !== 'visible' || Number(s.opacity) === 0)) { excluded.hiddenTextNodes++; return; }
      const paintedColor = s.webkitTextFillColor && s.webkitTextFillColor !== 'currentcolor' ? s.webkitTextFillColor : s.color;
      const measured = contrastColors(el, paintedColor, pseudoStyle ? Number(s.opacity) : 1);
      const threshold = size >= 20 ? 3 : 4.5;
      texts.push({ selector: selector(el), textIndex, text, kind, fontSize: size, fontWeight: s.fontWeight,
        lineHeight: s.lineHeight, cssColor: s.color, paintedCssColor: paintedColor, threshold,
        darkChineseBodyTarget: dark && size < 20 && /[\u3400-\u9fff]/.test(text) && !el.closest('h1,h2,h3,h4,h5,h6') ? 7 : null,
        decorative: Boolean(el.closest('[aria-hidden="true"]')), semanticContext: `${el.className || ''} ${el.getAttribute('role') || ''}`.trim(),
        rects: rendered.map(rectData), ...measured,
        status: measured.ratio === null ? 'unmeasured' : measured.ratio < threshold ? 'below-threshold' : measured.manualReasons.length ? 'manual-review' : 'meets-computed-threshold' });
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const el = node.parentElement;
      if (!el || el.closest('script,style,noscript,template,textarea,select')) continue;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') { if (node.textContent.trim()) excluded.svgTextNodes++; continue; }
      const range = document.createRange(); range.selectNodeContents(node);
      addText(el, node.textContent, 'text', range.getClientRects(), null, [...el.childNodes].indexOf(node));
    }
    for (const el of document.querySelectorAll('input:not([type="hidden"]),textarea,select')) {
      if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'color', 'file', 'password'].includes(el.type)) continue;
      if (el instanceof HTMLSelectElement) addText(el, [...el.selectedOptions].map((o) => o.label).join(' '), 'selected-option', el.getClientRects());
      else if (el.value) addText(el, el.value, 'input-value', el.getClientRects());
      else if (el.placeholder) addText(el, el.placeholder, 'placeholder', el.getClientRects(), getComputedStyle(el, '::placeholder'));
    }
    const targetSelector = 'button,input:not([type="hidden"]),select,textarea,a[href],summary,[role="button"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"],[tabindex]';
    for (const el of document.querySelectorAll(targetSelector)) {
      const native = el.matches('button,input,select,textarea,a[href],summary,[role="button"],[role="checkbox"],[role="switch"],[role="radio"],[role="tab"]');
      if (!native && el.tabIndex < 0) continue;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
        const hidden = hiddenReason(el);
        if ((!hidden || hidden === 'opacity:0') && clipped(box(el), el)) skippedSvgTargets.push({ selector: selector(el), text: textLabel(el), rect: rectData(box(el)), opacityZero: hidden === 'opacity:0',
          reason: 'SVG hotspot/chart point; excluded from regular HTML 44px check. Verify the named HTML buttons, previous/next or detail-list alternative manually.' });
        continue;
      }
      if (disabled(el)) {
        if (visible(el)) disabledExceptions.push({ selector: selector(el), text: textLabel(el), kind: 'control', reason: 'Disabled control: exempt from automated contrast and 44px checks' });
        continue;
      }
      let target = el, sizeSource = 'control';
      if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
        const labels = [...(el.labels || [])].filter(visible).sort((a, b) => Math.min(box(b).width, box(b).height) - Math.min(box(a).width, box(a).height));
        if (labels.length) { target = labels[0]; sizeSource = 'associated-label'; }
      }
      if (!visible(target)) continue;
      const r = box(target), small = r.width < 44 || r.height < 44;
      controls.push({ selector: selector(el), targetSelector: selector(target), text: textLabel(el), tag: el.localName, type: el.type || null,
        role: el.getAttribute('role'), sizeSource, rect: rectData(r), controlRect: rectData(box(el)),
        minTarget: 44, belowTarget: small, inlineLink: el.matches('a[href]') && css(el).display === 'inline' });
    }
    for (const el of document.querySelectorAll('.card')) {
      if (visible(el)) cards.push({ selector: selector(el), boxShadow: css(el).boxShadow, backgroundColor: css(el).backgroundColor, rect: rectData(box(el)) });
    }
    const overflowElements = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' || hiddenReason(el)) continue;
      const r = clipped(box(el), el, false);
      if (r && r.bottom > 0 && r.top < innerHeight && (r.left < -1 || r.right > innerWidth + 1)) {
        overflowElements.push({ selector: selector(el), text: textLabel(el).slice(0, 180), rect: rectData(r) });
      }
    }
    const summarize = (key) => [...texts.reduce((counts, item) => counts.set(item[key], (counts.get(item[key]) || 0) + 1), new Map())]
      .map(([value, count]) => ({ value, count })).sort((a, b) => Number(a.value) - Number(b.value));
    return {
      url: location.href, theme: document.documentElement.dataset.theme || null, viewport: { width: innerWidth, height: innerHeight },
      texts, fontSizes: summarize('fontSize'), fontWeights: summarize('fontWeight'), controls, cards,
      lowContrast: texts.filter((item) => item.ratio !== null && item.ratio < item.threshold),
      darkChineseBodyBelowTarget: texts.filter((item) => item.darkChineseBodyTarget && item.ratio !== null && item.ratio < 7),
      needsManualContrast: texts.filter((item) => item.manualReasons.length || item.ratio === null),
      smallTargets: controls.filter((item) => item.belowTarget), skippedSvgTargets, disabledExceptions, excluded,
      horizontalOverflow: { present: document.documentElement.scrollWidth > innerWidth + 1,
        viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        excess: Math.max(0, document.documentElement.scrollWidth - innerWidth), elements: overflowElements },
      methodology: [
        'Viewport-only HTML text nodes and visible input values/placeholders/selected options. CSS hiding, alpha-zero, ancestor clipping and sampled hit testing filter visibility.',
        'Computed legacy rect() clips on absolute/fixed positioned elements participate in visibility clipping; zero/inverted-area exclusions remain in excluded.physicallyClipped. Rotated/skewed clip geometry is only approximated by axis-aligned bounds.',
        'sRGB colors parsed with a detached 1px canvas; foreground/background rgba and ancestor group opacity are composited over the white browser canvas.',
        'Requested thresholds: ordinary text 4.5:1; text >=20 CSS px 3:1. Dark-theme Chinese text below20px outside headings is separately compared with the 7:1 project target; semantic status colors require human judgment.',
        'Decorative aria-hidden HTML text is retained and flagged. Disabled controls/associated labels are listed as exceptions. Inline links are retained in smallTargets for manual assessment.',
        'SVG interactive targets are listed separately; their HTML alternatives are not automatically certified. Invisible SVG chart hit areas may still be listed because they are interactive.',
        'Gradients/images, filters/blending and text shadows require manual contrast review. Ratios in those cases use background-color only and are not pixel-level passes.',
        'Does not inspect generated pseudo-element text, password/file content, native popup menus, keyboard behavior, offscreen content, or minimum spacing between targets. Hit testing is sampled and cannot reliably distinguish transparent overlays.'
      ]
    };
  });
}
