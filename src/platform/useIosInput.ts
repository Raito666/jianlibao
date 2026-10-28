import { useEffect, useRef, useState } from 'react';
import { isIos } from './native';
import { collectIosViewportDiagnostics } from './ios-viewport-diagnostics';

type Field = HTMLInputElement | HTMLTextAreaElement;
type InputState = {
  host: HTMLElement | null;
  label: string;
  previous: boolean;
  next: boolean;
};
const fieldSelector = 'input, textarea';
const inputTypes = new Set(['number', 'text', 'search', 'email', 'tel', 'url']);
const viewportProperties = ['--ios-visible-height', '--ios-visible-top', '--ios-input-bottom'];
const dialogViewportProperties = ['--ios-dialog-height', '--ios-dialog-top', '--ios-dialog-bottom'];

function editable(element: Element | null): element is Field {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
  if (element instanceof HTMLInputElement && !inputTypes.has(element.type)) return false;
  if (!element.isConnected || element.matches(':disabled') || element.readOnly || element.tabIndex < 0) return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  // Closed details may retain layout rectangles while their fields cannot receive focus.
  if (element.closest('details:not([open])')) return false;
  if (element.closest('dialog:not([open])') || !element.getClientRects().length) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

function scopeFor(field: Field): HTMLElement | null {
  return field.closest<HTMLElement>('form, [data-ios-input-scope]') ?? field.closest<HTMLElement>('dialog');
}

function fieldsIn(scope: HTMLElement, field: Field) {
  const dialog = field.closest('dialog');
  return [...scope.querySelectorAll<Field>(fieldSelector)].filter(
    candidate => editable(candidate) && scopeFor(candidate) === scope && candidate.closest('dialog') === dialog,
  );
}

function fieldLabel(field: Field) {
  const explicit = field.getAttribute('aria-label');
  if (explicit) return explicit;
  // A controlled textarea can keep its value in the label's textContent.
  // Read the caption without copying entered values into the accessory.
  const caption = field.labels?.[0]?.cloneNode(true);
  if (caption instanceof Element) caption.querySelectorAll('input, textarea, select, button, [aria-hidden="true"]').forEach(node => node.remove());
  return caption?.textContent?.trim() || '当前输入';
}

/** UI-only focus state. Never parses values, submits forms or writes application data. */
export function useIosInput() {
  const [state, setState] = useState<InputState | null>(null);
  const actions = useRef<{ move: (direction: number) => void; dismiss: () => void } | null>(null);
  useEffect(() => {
    if (!isIos()) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const oldActive = root.getAttribute('data-ios-input-active');
    const oldProperties = viewportProperties.map(name => [
      name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name),
    ]);
    const oldDialogProperties = dialogViewportProperties.map(name => [
      name, root.style.getPropertyValue(name), root.style.getPropertyPriority(name),
    ]);
    let field: Field | null = null;
    let scope: HTMLElement | null = null;
    let oldScopeEditing: string | null = null;
    let oldHint: string | null = null;
    let frame = 0;
    let reveal = false;
    let disposed = false;
    let manualPan = false;
    let lastViewportDiagnostic = '';
    let diagnosticFrame = 0;

    function restoreViewport() {
      if (oldActive === null) root.removeAttribute('data-ios-input-active');
      else root.setAttribute('data-ios-input-active', oldActive);
      for (const [name, value, priority] of oldProperties) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
    }

    function release() {
      observer.disconnect();
      layoutObserver.disconnect();
      if (field) {
        if (oldHint === null) field.removeAttribute('enterkeyhint');
        else field.setAttribute('enterkeyhint', oldHint);
      }
      if (scope) {
        if (oldScopeEditing === null) scope.removeAttribute('data-ios-editing');
        else scope.setAttribute('data-ios-editing', oldScopeEditing);
      }
      field = null;
      scope = null;
      restoreViewport();
    }

    function revealField(current: Field, host: HTMLElement | null) {
      const trace = (event: string, extra: Record<string, unknown> = {}) => {
        if (import.meta.env.VITE_IOS_INPUT_DIAGNOSTICS !== '1') return;
        const rect = current.getBoundingClientRect();
        // The Simulator diagnostic build logs geometry only, never entered values or labels.
        console.info('JLB_IOS_INPUT', JSON.stringify({ event, tag: current.tagName,
          viewport: { height: viewport?.height, offsetTop: viewport?.offsetTop, scale: viewport?.scale },
          window: { height: innerHeight, scrollY },
          field: { top: rect.top, bottom: rect.bottom, height: rect.height }, ...extra }));
      };
      // Do not pull a zoomed viewport or a user's manual scroll back into place.
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) { trace('zoom-skip'); return; }
      const dialog = current.closest('dialog');
      // WKWebView pans the top-layer dialog with the visual viewport. Its field,
      // scroller and accessory rects already share the visible coordinate space;
      // adding visualViewport.offsetTop again can put top below the scroller's
      // bottom (observed offsetTop=403, modal-body=133..302 on iOS 26).
      const dialogBounds = dialog?.getBoundingClientRect();
      const safeTop = Math.max(0, Number.parseFloat(getComputedStyle(root).getPropertyValue('--safe-top')) || 0);
      let top = Math.max(dialogBounds?.top ?? 0, safeTop) + 12;
      let bottom = (dialogBounds?.bottom ?? viewport?.height ?? window.innerHeight) - 12;
      const accessory = (host ?? document).querySelector<HTMLElement>('[data-ios-input-accessory]');
      if (accessory) bottom = Math.min(bottom, accessory.getBoundingClientRect().top - 12);
      const footer = dialog?.querySelector<HTMLElement>('.modal-footer');
      if (footer && !footer.contains(current)) bottom = Math.min(bottom, footer.getBoundingClientRect().top - 12);
      for (let parent = current.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!/(auto|scroll)/.test(style.overflowY) || parent.scrollHeight <= parent.clientHeight + 1) continue;
        const bounds = parent.getBoundingClientRect();
        top = Math.max(top, bounds.top + 12);
        bottom = Math.min(bottom, bounds.bottom - 12);
        if (bottom <= top) { trace('no-space', { top, bottom }); return; }
        const rect = current.getBoundingClientRect();
        const delta = rect.height > bottom - top || rect.top < top
          ? rect.top - top
          : rect.bottom > bottom ? rect.bottom - bottom : 0;
        trace('container-reveal', { top, bottom, delta, container: parent.className,
          scrollTop: parent.scrollTop, clientHeight: parent.clientHeight, scrollHeight: parent.scrollHeight });
        if (delta) parent.scrollBy({ top: delta, behavior: 'instant' });
        return;
      }
      const rect = current.getBoundingClientRect();
      const delta = rect.top < top ? rect.top - top : rect.bottom > bottom ? rect.bottom - bottom : 0;
      trace('window-reveal', { top, bottom, delta });
      if (delta) window.scrollBy({ top: delta, behavior: 'instant' });
    }

    function traceViewport() {
      if (import.meta.env.VITE_IOS_INPUT_DIAGNOSTICS !== '1') return;
      cancelAnimationFrame(diagnosticFrame);
      diagnosticFrame = requestAnimationFrame(() => {
        if (disposed) return;
        // Sample after focus attributes, portal state and layout reconcile.
        // Hit tests do not prove the native compositor actually drew the label.
        const diagnostic = JSON.stringify(collectIosViewportDiagnostics());
        if (diagnostic !== lastViewportDiagnostic) {
          lastViewportDiagnostic = diagnostic;
          console.info('JLB_IOS_VIEWPORT', diagnostic);
        }
      });
    }

    function refresh() {
      frame = 0;
      if (disposed) return;
      const visibleHeight = viewport?.height ?? window.innerHeight;
      const visibleTop = viewport?.offsetTop ?? 0;
      // Top-layer dialogs need the visual offset even with no editable focus.
      // Native history close was y20 instead of y88 after dismissing search.
      root.style.setProperty('--ios-dialog-height', `${visibleHeight}px`);
      root.style.setProperty('--ios-dialog-top', `${visibleTop}px`);
      root.style.setProperty('--ios-dialog-bottom', `${Math.max(0, window.innerHeight - visibleHeight - visibleTop)}px`);
      if (import.meta.env.VITE_IOS_INPUT_DIAGNOSTICS === '1' && document.querySelector('dialog[open]')) {
        console.info('JLB_IOS_INPUT', JSON.stringify({ event: 'dialog-viewport', height: visibleHeight,
          offsetTop: visibleTop, innerHeight, scrollY, scale: viewport?.scale }));
      }
      const shouldReveal = reveal;
      reveal = false;
      const focused = document.activeElement;
      // Keep the last field while a hardware keyboard or assistive control enters the accessory.
      const candidate = focused?.closest('[data-ios-input-accessory]') ? field : focused;
      const nextScope = editable(candidate) ? scopeFor(candidate) : null;
      if (!editable(candidate) || !nextScope) {
        release();
        setState(null);
        traceViewport();
        return;
      }
      if (field !== candidate || scope !== nextScope) {
        release();
        field = candidate;
        scope = nextScope;
        oldHint = field.getAttribute('enterkeyhint');
        oldScopeEditing = scope.getAttribute('data-ios-editing');
        scope.setAttribute('data-ios-editing', 'true');
        observer.observe(scope, {
          subtree: true, childList: true, attributes: true,
          attributeFilter: ['disabled', 'readonly', 'hidden', 'inert', 'open', 'aria-hidden'],
        });
        // Also release a field removed with its dialog/page; removal need not emit focusout.
        for (let parent = scope.parentElement; parent; parent = parent.parentElement) {
          observer.observe(parent, {
            childList: true, attributes: true, attributeFilter: ['hidden', 'inert', 'open', 'aria-hidden'],
          });
        }
        // The portal can commit after focus/keyboard events and resize this scroller.
        layoutObserver.observe(candidate.closest('.modal-body') ?? nextScope);
      }
      const fields = fieldsIn(nextScope, candidate);
      const index = fields.indexOf(candidate);
      const hasNext = index >= 0 && index < fields.length - 1;
      candidate.enterKeyHint = candidate instanceof HTMLTextAreaElement ? 'enter' : hasNext ? 'next' : 'done';
      root.setAttribute('data-ios-input-active', 'true');
      root.style.setProperty('--ios-visible-height', `${visibleHeight}px`);
      root.style.setProperty('--ios-visible-top', `${visibleTop}px`);
      // Fixed accessory coordinates also start at the visible origin in WKWebView.
      // Subtracting offsetTop a second time placed the training bar inside the
      // keyboard (native innerHeight=628, height=476, offsetTop=224).
      root.style.setProperty('--ios-input-bottom', `${Math.max(0, window.innerHeight - visibleHeight)}px`);
      const host = candidate.closest('dialog')?.querySelector<HTMLElement>('[data-ios-input-accessory-slot]') ?? null;
      if (import.meta.env.VITE_IOS_INPUT_DIAGNOSTICS === '1') {
        console.info('JLB_IOS_INPUT', JSON.stringify({ event: 'refresh', tag: candidate.tagName,
          shouldReveal, manualPan, viewport: { height: viewport?.height, offsetTop: viewport?.offsetTop, scale: viewport?.scale },
          window: { height: innerHeight, scrollY }, modalBody: candidate.closest('.modal-body')?.getBoundingClientRect().toJSON() }));
      }
      setState({ host, label: fieldLabel(candidate), previous: index > 0, next: hasNext });
      // A second frame lets the portal and the constrained scroll area take their space first.
      if (shouldReveal) requestReveal(candidate, host);
      traceViewport();
    }

    let revealFrame = 0;
    function requestReveal(current: Field, host: HTMLElement | null) {
      cancelAnimationFrame(revealFrame);
      revealFrame = requestAnimationFrame(() => {
        if (!disposed && !manualPan && current === field && editable(current)) revealField(current, host);
      });
    }
    function schedule(shouldReveal = false) {
      if (disposed) return;
      reveal ||= shouldReveal;
      if (!frame) frame = requestAnimationFrame(refresh);
    }
    const observer = new MutationObserver(() => schedule());
    const layoutObserver = new ResizeObserver(() => schedule(!manualPan));
    const focusChanged = (event: FocusEvent) => {
      if (event.type === 'focusin') manualPan = false;
      schedule(event.type === 'focusin');
    };
    const resized = () => { manualPan = false; schedule(true); };
    // WKWebView pans again after its keyboard animation. Follow that pan until
    // an actual user scroll gesture takes over, rather than pulling manual browsing back.
    const scrolled = () => schedule(!manualPan);
    const userPanned = () => {
      manualPan = true;
      reveal = false;
      cancelAnimationFrame(revealFrame);
    };
    // Typing can make WKWebView pan without resizing; keep the edited field
    // clear of our accessory. A manual viewport scroll still only updates position.
    const inputChanged = () => { manualPan = false; schedule(true); };
    const dismiss = () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      field?.blur();
      release();
      setState(null);
    };
    const move = (direction: number) => {
      if (!field || !scope || !editable(field)) return;
      const fields = fieldsIn(scope, field);
      const index = fields.indexOf(field);
      const target = index >= 0 ? fields[index + direction] : undefined;
      if (target) {
        target.focus({ preventScroll: true });
        schedule(true);
      }
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.key !== 'Enter' ||
        event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      const current = document.activeElement;
      if (current !== field || !(current instanceof HTMLInputElement) || !scope) return;
      event.preventDefault();
      const fields = fieldsIn(scope, current);
      if (fields.indexOf(current) < fields.length - 1) move(1);
      else dismiss();
    };
    actions.current = { move, dismiss };
    document.addEventListener('focusin', focusChanged);
    document.addEventListener('focusout', focusChanged);
    document.addEventListener('input', inputChanged);
    document.addEventListener('keydown', keyDown);
    document.addEventListener('touchmove', userPanned, { passive: true });
    document.addEventListener('wheel', userPanned, { passive: true });
    window.addEventListener('resize', resized);
    window.addEventListener('scroll', scrolled, { passive: true });
    viewport?.addEventListener('resize', resized);
    viewport?.addEventListener('scroll', scrolled);
    schedule(true);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(revealFrame);
      if (import.meta.env.VITE_IOS_INPUT_DIAGNOSTICS === '1') cancelAnimationFrame(diagnosticFrame);
      document.removeEventListener('focusin', focusChanged);
      document.removeEventListener('focusout', focusChanged);
      document.removeEventListener('input', inputChanged);
      document.removeEventListener('keydown', keyDown);
      document.removeEventListener('touchmove', userPanned);
      document.removeEventListener('wheel', userPanned);
      window.removeEventListener('resize', resized);
      window.removeEventListener('scroll', scrolled);
      viewport?.removeEventListener('resize', resized);
      viewport?.removeEventListener('scroll', scrolled);
      release();
      for (const [name, value, priority] of oldDialogProperties) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
      actions.current = null;
    };
  }, []);
  return { state, move: (direction: number) => actions.current?.move(direction), dismiss: () => actions.current?.dismiss() };
}
