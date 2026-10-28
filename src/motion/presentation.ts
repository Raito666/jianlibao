import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion, subscribeReducedMotion } from './reduced-motion';
import { afterPageSnapshots } from './transition';

const enter = 'cubic-bezier(0, 0, 0.2, 1)';

function animateElements(entries: { element: Element; delay: number; duration: number; offset: number }[]) {
  if (!Element.prototype.animate) return () => {};
  const reduced = prefersReducedMotion();
  const animations = entries.map(({ element, delay, duration, offset }) =>
    element.animate(
      reduced
        ? [{ opacity: 0.65 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: `translateY(${offset}px)` },
            { opacity: 1, transform: 'none' },
          ],
      { duration: reduced ? 100 : duration, delay: reduced ? 0 : delay, easing: enter, fill: 'backwards' },
    ),
  );
  let stopped = false;
  let unsubscribe = () => {};
  const cancel = () => {
    if (stopped) return;
    stopped = true;
    animations.forEach((animation) => animation.cancel());
    unsubscribe();
  };
  unsubscribe = subscribeReducedMotion((value) => {
    if (value) cancel();
  });
  void Promise.all(animations.map((animation) => animation.finished.catch(() => {}))).then(cancel);
  return cancel;
}

/** Skip the first mount; only explain a changed result, never choreograph all 302 items. */
export function useListMotion(ref: RefObject<HTMLElement | null>, resultKey: string, selector: string) {
  const previous = useRef(resultKey);
  useLayoutEffect(() => {
    if (previous.current === resultKey) return;
    previous.current = resultKey;
    const elements = [...(ref.current?.querySelectorAll(selector) ?? [])].slice(0, 6);
    return animateElements(
      elements.map((element, index) => ({ element, delay: index * 20, duration: 200, offset: 4 })),
    );
  }, [ref, resultKey, selector]);
}

/** Give native snapshots and the fallback the same reading order, without extra wrappers. */
export function markPageParts(main: HTMLElement) {
  main.querySelectorAll('[data-motion-part]').forEach((element) => element.removeAttribute('data-motion-part'));
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight;
  };
  const title = main.querySelector('h1');
  const subtitle = [
    ...main.querySelectorAll(
      '.hero-copy > p, .progress-masthead p, .section-heading p, .library-intro p, .workout-header p',
    ),
  ].find(visible);
  const action = [...main.querySelectorAll('.btn-primary:not(:disabled)')].find(visible);
  title?.setAttribute('data-motion-part', 'title');
  subtitle?.setAttribute('data-motion-part', 'subtitle');
  action?.setAttribute('data-motion-part', 'action');
}

/** Fallback reads in order, without transforming sticky/fixed ancestors. */
export function animatePage(main: HTMLElement) {
  const title = main.querySelector('[data-motion-part="title"]');
  const subtitle = main.querySelector('[data-motion-part="subtitle"]');
  const action = main.querySelector('[data-motion-part="action"]');
  let stopEntry = () => {};
  const stopWaiting = afterPageSnapshots(() => {
    stopEntry = animateElements([
      ...(title ? [{ element: title, delay: 0, duration: 200, offset: 4 }] : []),
      ...(subtitle ? [{ element: subtitle, delay: 20, duration: 200, offset: 4 }] : []),
      ...(action ? [{ element: action, delay: 60, duration: 140, offset: 0 }] : []),
    ]);
  });
  return () => { stopWaiting(); stopEntry(); };
}

export function fadeValue(element: HTMLElement) {
  return animateElements([{ element, delay: 0, duration: 100, offset: 0 }]);
}
