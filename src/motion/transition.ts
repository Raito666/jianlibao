import { prefersReducedMotion, subscribeReducedMotion } from './reduced-motion';

let latestRequest = 0;
let activeTransition: { native: ViewTransition; release: () => void; domEntry: boolean } | undefined;

function needsDomEntry(): boolean {
  // This port exposes a Macintosh UA on Windows. Use its real platform too;
  // Apple WebKit and Chromium on Windows keep their existing snapshot motion.
  return typeof navigator !== 'undefined' && /^Win/.test(navigator.platform) &&
    /AppleWebKit\//.test(navigator.userAgent) &&
    !/(?:Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent);
}

function skip(transition: ViewTransition | undefined): void {
  try {
    transition?.skipTransition?.();
  } catch {
    // A failed visual cancellation must not block the next navigation.
  }
}

/** Do not animate named DOM elements while Windows WebKit captures them. */
export function afterPageSnapshots(enter: () => void): () => void {
  let cancelled = false;
  const run = () => { if (!cancelled) enter(); };
  if (activeTransition?.domEntry)
    void activeTransition.native.finished.then(run, run).catch(() => undefined);
  else run();
  return () => { cancelled = true; };
}

export function withViewTransition(update: () => void, onFallback?: () => void): void {
  const request = ++latestRequest;
  const previous = activeTransition;
  activeTransition = undefined;
  previous?.release();
  skip(previous?.native);
  let updated = false;
  const apply = (fallback = false) => {
    if (updated || request !== latestRequest) return;
    updated = true;
    if (fallback) onFallback?.();
    update();
  };
  const fallback = () => apply(true);
  if (
    typeof document === 'undefined' ||
    !document ||
    typeof document.startViewTransition !== 'function' ||
    prefersReducedMotion()
  ) {
    fallback();
    return;
  }
  const domEntry = needsDomEntry();
  if (document.documentElement)
    document.documentElement.dataset.snapshotMotion = domEntry ? 'static' : 'animated';
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(() => apply(domEntry));
  } catch {
    fallback();
    return;
  }
  let unsubscribe: () => void = () => undefined;
  const release = () => {
    unsubscribe();
    if (activeTransition?.native === transition) activeTransition = undefined;
  };
  if (request === latestRequest) {
    activeTransition = { native: transition, release, domEntry };
    unsubscribe = subscribeReducedMotion((reduced) => {
      if (reduced) {
        skip(transition);
        release();
      }
    });
  } else skip(transition);
  // Native rejection must neither lose the update nor leak an unhandled promise.
  // The final catch also contains an application callback thrown during fallback.
  void transition.ready.catch(fallback).catch(() => undefined);
  void transition.updateCallbackDone.catch(fallback).catch(() => undefined);
  void transition.finished
    .then(release, () => {
      release();
      fallback();
    })
    .catch(() => undefined);
}
