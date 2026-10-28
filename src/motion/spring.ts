import { prefersReducedMotion, subscribeReducedMotion } from './reduced-motion';

type SpringOptions = {
  from: number;
  to: number;
  stiffness?: number;
  damping?: number;
  mass?: number;
  maxDuration?: number;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
};

export function spring({
  from,
  to,
  stiffness = 300,
  damping = 30,
  mass = 1,
  maxDuration = 300,
  onUpdate,
  onComplete,
}: SpringOptions): () => void {
  to = Number.isFinite(to) ? to : 0;
  from = Number.isFinite(from) ? from : to;
  stiffness = Number.isFinite(stiffness) && stiffness > 0 ? stiffness : 300;
  damping = Number.isFinite(damping) && damping >= 0 ? damping : 30;
  mass = Number.isFinite(mass) && mass > 0 ? mass : 1;
  maxDuration = Number.isFinite(maxDuration) ? Math.max(0, Math.min(maxDuration, 300)) : 300;
  let position = from;
  let velocity = 0;
  let active = true;
  let cancelled = false;
  let frame: number | undefined;
  let unsubscribe: () => void = () => undefined;
  const release = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    unsubscribe();
  };
  const cancel = () => {
    cancelled = true;
    active = false;
    release();
  };
  const finish = () => {
    if (!active) return;
    active = false;
    release();
    onUpdate(to);
    if (!cancelled) onComplete?.();
  };
  if (from === to || maxDuration === 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    finish();
    return cancel;
  }
  const started = performance.now();
  let previous = started;
  const step = (now: number) => {
    frame = undefined;
    if (!active) return;
    if (now - started >= maxDuration) {
      finish();
      return;
    }
    // Small integration steps keep a delayed frame stable without replaying a long pause.
    let remaining = Math.max(0, Math.min((now - previous) / 1000, 0.064));
    previous = now;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 240);
      velocity += ((-stiffness * (position - to) - damping * velocity) / mass) * dt;
      position += velocity * dt;
      if (!Number.isFinite(position) || !Number.isFinite(velocity)) {
        finish();
        return;
      }
      remaining -= dt;
    }
    if (Math.abs(velocity) < 0.01 && Math.abs(position - to) < 0.01) {
      finish();
      return;
    }
    onUpdate(position);
    if (active) frame = requestAnimationFrame(step);
  };
  unsubscribe = subscribeReducedMotion((reduced) => {
    if (reduced) finish();
  });
  frame = requestAnimationFrame(step);
  return cancel;
}
