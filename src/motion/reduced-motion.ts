function motionPreference(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}

export function prefersReducedMotion(): boolean {
  return motionPreference()?.matches ?? false;
}

export function subscribeReducedMotion(callback: (reduced: boolean) => void): () => void {
  const media = motionPreference();
  if (!media) return () => undefined;
  let active = true;
  const listener = (event: MediaQueryListEvent) => {
    if (active) callback(event.matches);
  };
  const modern = typeof media.addEventListener === 'function';
  if (modern) media.addEventListener('change', listener);
  else media.addListener(listener);
  return () => {
    if (!active) return;
    active = false;
    if (modern) media.removeEventListener('change', listener);
    else media.removeListener(listener);
  };
}
