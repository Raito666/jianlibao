import { isCompactViewport } from './compact-layout';
import { useEffect } from 'react';
import { isIos } from './native';

/** Browser keyboard geometry only; never changes values, saves or submits. */
export function useWebInputViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (isIos() || !viewport) return;
    const root = document.documentElement;
    let frame = 0;
    let host: HTMLElement | null = null;
    let activeField: HTMLElement | null = null;
    const properties = ['--web-visible-height', '--web-visible-top'];
    const previous = properties.map(name => [name, root.style.getPropertyValue(name)]);

    function reset() {
      root.removeAttribute('data-web-keyboard');
      root.removeAttribute('data-web-keyboard-compact');
      host?.removeAttribute('data-web-input-active');
      host = null;
      activeField = null;
      for (const [name, value] of previous) {
        if (value) root.style.setProperty(name, value);
        else root.style.removeProperty(name);
      }
    }

    function update() {
      frame = 0;
      const field = document.activeElement;
      const editable = (field instanceof HTMLInputElement && /^(text|number|search|email|tel|url)$/.test(field.type)) || field instanceof HTMLTextAreaElement;
      if (!editable || !field.isConnected || field.readOnly || field.disabled
        || !isCompactViewport()
        || Math.abs(viewport!.scale - 1) > 0.01
        || document.documentElement.clientHeight - viewport!.height < 120) {
        reset();
        return;
      }
      const nextHost = field.closest<HTMLElement>('.main[data-page="workout"]');
      activeField = field;
      if (host !== nextHost) host?.removeAttribute('data-web-input-active');
      host = nextHost;
      root.setAttribute('data-web-keyboard', 'true');
      root.toggleAttribute('data-web-keyboard-compact', viewport!.height < 240);
      root.style.setProperty('--web-visible-height', `${viewport!.height}px`);
      root.style.setProperty('--web-visible-top', `${Math.max(0, viewport!.offsetTop)}px`);
      host?.setAttribute('data-web-input-active', 'true');

      const scroller = field.closest<HTMLElement>('.modal-body, .workout-view') ?? document.scrollingElement;
      if (!scroller) return;
      const area = scroller.getBoundingClientRect();
      const box = field.getBoundingClientRect();
      const visibleTop = Math.max(viewport!.offsetTop, area.top);
      const visibleBottom = Math.min(viewport!.offsetTop + viewport!.height, area.bottom);
      const inset = Math.min(12, Math.max(0, (visibleBottom - visibleTop - box.height) / 2));
      const top = visibleTop + inset;
      const bottom = visibleBottom - inset;
      if (box.bottom > bottom) scroller.scrollTop += box.bottom - bottom;
      else if (box.top < top) scroller.scrollTop += box.top - top;
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    const observer = new MutationObserver(() => {
      // A removed field may not emit blur. Unrelated live timers must not
      // pull a reader back to the focused field while they scroll a form.
      if (activeField && !activeField.isConnected) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      observer.disconnect();
      reset();
    };
  }, []);
}
