import { afterEach, describe, expect, it, vi } from 'vitest';

function installPreference(initial = false, legacy = false) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = {
    matches: initial,
    ...(legacy
      ? {
          addListener: (listener: (event: { matches: boolean }) => void) => listeners.add(listener),
          removeListener: (listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
        }
      : {
          addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
          removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) =>
            listeners.delete(listener),
        }),
  };
  vi.stubGlobal('window', { matchMedia: () => media });
  return {
    set(value: boolean) {
      media.matches = value;
      for (const listener of [...listeners]) listener({ matches: value });
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

function installFrames() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  return {
    tick(delta: number) {
      now += delta;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(now);
    },
    pendingCount: () => pending.size,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function controlledTransition() {
  const ready = deferred();
  const finished = deferred();
  const updateCallbackDone = deferred();
  let skips = 0;
  return {
    ready,
    finished,
    updateCallbackDone,
    native: {
      ready: ready.promise,
      finished: finished.promise,
      updateCallbackDone: updateCallbackDone.promise,
      skipTransition: () => {
        skips++;
      },
    },
    skipCount: () => skips,
  };
}

describe('reduced motion', () => {
  it('reads the current reduced-motion preference', async () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }),
    });
    const motion = await import('../../src/motion/reduced-motion');

    expect(motion.prefersReducedMotion()).toBe(true);
  });

  it('falls back to no preference when matchMedia is unavailable', async () => {
    vi.stubGlobal('window', {});
    const { prefersReducedMotion } = await import('../../src/motion/reduced-motion');

    expect(prefersReducedMotion()).toBe(false);
  });

  it('can be read without a browser window', async () => {
    const { prefersReducedMotion } = await import('../../src/motion/reduced-motion');

    expect(prefersReducedMotion()).toBe(false);
  });

  it.each([false, true])('subscribes to preference changes and removes the listener (legacy=%s)', async (legacy) => {
    const preference = installPreference(false, legacy);
    const changes: boolean[] = [];
    const motion = await import('../../src/motion/reduced-motion');
    const unsubscribe = motion.subscribeReducedMotion((value: boolean) => changes.push(value));

    preference.set(true);
    expect(changes).toEqual([true]);
    unsubscribe();
    unsubscribe();
    preference.set(false);
    expect(changes).toEqual([true]);
    expect(preference.listenerCount()).toBe(0);
  });

  it('returns a usable cleanup when preference subscriptions are unavailable', async () => {
    vi.stubGlobal('window', {});
    const motion = await import('../../src/motion/reduced-motion');

    expect(motion.subscribeReducedMotion(() => undefined)).toBeTypeOf('function');
  });
});

describe('spring', () => {
  it('moves toward the exact target and completes within 300ms', async () => {
    const preference = installPreference();
    const frames = installFrames();
    const values: number[] = [];
    let completed = 0;
    const motion = await import('../../src/motion/spring');
    motion.spring({ from: 0, to: 1, onUpdate: (value: number) => values.push(value), onComplete: () => completed++ });

    frames.tick(16);
    expect(values[0]).toBeGreaterThan(0);
    expect(values[0]).toBeLessThan(1);
    for (let elapsed = 16; elapsed < 300; elapsed += 16) frames.tick(Math.min(16, 300 - elapsed));
    expect(values.at(-1)).toBe(1);
    expect(completed).toBe(1);
    expect(frames.pendingCount()).toBe(0);
    expect(preference.listenerCount()).toBe(0);
    frames.tick(1000);
    expect(completed).toBe(1);
  });

  it('stops callbacks and removes resources when cancelled', async () => {
    const preference = installPreference();
    const frames = installFrames();
    const values: number[] = [];
    let completed = 0;
    const motion = await import('../../src/motion/spring');
    const cancel = motion.spring({
      from: 0,
      to: 1,
      onUpdate: (value: number) => values.push(value),
      onComplete: () => completed++,
    });

    frames.tick(16);
    expect(values).toHaveLength(1);
    cancel();
    cancel();
    frames.tick(1000);
    preference.set(true);
    expect(values).toHaveLength(1);
    expect(completed).toBe(0);
    expect(frames.pendingCount()).toBe(0);
    expect(preference.listenerCount()).toBe(0);
  });

  it('honours a shorter completion deadline for feedback icons', async () => {
    installPreference();
    const frames = installFrames();
    const values: number[] = [];
    let completed = 0;
    const motion = await import('../../src/motion/spring');
    motion.spring({
      from: 1.15,
      to: 1,
      maxDuration: 120,
      onUpdate: (value: number) => values.push(value),
      onComplete: () => completed++,
    });

    frames.tick(119);
    expect(completed).toBe(0);
    frames.tick(1);
    expect(values.at(-1)).toBe(1);
    expect(completed).toBe(1);
    expect(frames.pendingCount()).toBe(0);
  });

  it('settles immediately when reduced motion is already enabled', async () => {
    const preference = installPreference(true);
    const frames = installFrames();
    const values: number[] = [];
    let completed = 0;
    const motion = await import('../../src/motion/spring');
    motion.spring({ from: 0, to: 1, onUpdate: (value: number) => values.push(value), onComplete: () => completed++ });

    expect(values).toEqual([1]);
    expect(completed).toBe(1);
    expect(frames.pendingCount()).toBe(0);
    expect(preference.listenerCount()).toBe(0);
  });

  it('settles and releases frames when reduced motion becomes enabled', async () => {
    const preference = installPreference();
    const frames = installFrames();
    const values: number[] = [];
    let completed = 0;
    const motion = await import('../../src/motion/spring');
    motion.spring({ from: 0, to: 1, onUpdate: (value: number) => values.push(value), onComplete: () => completed++ });

    frames.tick(16);
    preference.set(true);
    expect(values.at(-1)).toBe(1);
    expect(completed).toBe(1);
    expect(frames.pendingCount()).toBe(0);
    expect(preference.listenerCount()).toBe(0);
    const count = values.length;
    preference.set(false);
    frames.tick(16);
    expect(values).toHaveLength(count);
  });

  it('keeps long-frame output finite and finishes after a background pause', async () => {
    installPreference();
    const frames = installFrames();
    const values: number[] = [];
    let completed = 0;
    const motion = await import('../../src/motion/spring');
    motion.spring({ from: 0, to: 1, onUpdate: (value: number) => values.push(value), onComplete: () => completed++ });

    frames.tick(200);
    expect(values).toHaveLength(1);
    expect(values[0]).toBeGreaterThan(0);
    expect(values[0]).toBeLessThan(2);
    frames.tick(10000);
    expect(values.every(Number.isFinite)).toBe(true);
    expect(values.at(-1)).toBe(1);
    expect(completed).toBe(1);
    expect(frames.pendingCount()).toBe(0);
  });

  it.each([
    { from: 0, to: 1, maxDuration: 0 },
    { from: 1, to: 1 },
  ])('settles without scheduling an unnecessary frame: %j', async (options) => {
    const preference = installPreference();
    const frames = installFrames();
    const values: number[] = [];
    let completed = 0;
    const { spring } = await import('../../src/motion/spring');
    spring({ ...options, onUpdate: (value) => values.push(value), onComplete: () => completed++ });

    expect(values).toEqual([1]);
    expect(completed).toBe(1);
    expect(frames.pendingCount()).toBe(0);
    expect(preference.listenerCount()).toBe(0);
  });

  it('falls back to the target when animation frames are unavailable', async () => {
    installPreference();
    vi.stubGlobal('requestAnimationFrame', undefined);
    const values: number[] = [];
    const { spring } = await import('../../src/motion/spring');
    spring({ from: 0, to: 1, onUpdate: (value) => values.push(value) });

    expect(values).toEqual([1]);
  });

  it.each([
    { from: Number.NaN, to: 1, stiffness: 300, damping: 30, mass: 1 },
    { from: 0, to: Number.POSITIVE_INFINITY, stiffness: 300, damping: 30, mass: 1 },
    { from: 0, to: 1, stiffness: Number.POSITIVE_INFINITY, damping: -1, mass: 0 },
    { from: 0, to: 1, stiffness: Number.MAX_VALUE, damping: 30, mass: Number.MIN_VALUE },
  ])('never emits a non-finite transform value for invalid or extreme input: %j', async (options) => {
    installPreference();
    const frames = installFrames();
    const values: number[] = [];
    const { spring } = await import('../../src/motion/spring');
    spring({ ...options, onUpdate: (value) => values.push(value) });

    frames.tick(16);
    frames.tick(300);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every(Number.isFinite)).toBe(true);
    expect(values.at(-1)).toBe(Number.isFinite(options.to) ? options.to : 0);
    expect(frames.pendingCount()).toBe(0);
  });

  it('caps an excessive requested duration at 300ms', async () => {
    installPreference();
    const frames = installFrames();
    const values: number[] = [];
    let completed = 0;
    const { spring } = await import('../../src/motion/spring');
    spring({
      from: 0,
      to: 1,
      maxDuration: 10000,
      onUpdate: (value) => values.push(value),
      onComplete: () => completed++,
    });

    frames.tick(300);
    expect(values).toEqual([1]);
    expect(completed).toBe(1);
    expect(frames.pendingCount()).toBe(0);
  });
});

describe('view transitions', () => {
  it.each([false, true])('starts Windows DOM entry only after snapshots release (cancel=%s)', async cancel => {
    installPreference();
    vi.stubGlobal('navigator', {platform:'Win32',userAgent:'AppleWebKit/605.1.15 Safari/605.1.15'});
    const transition = controlledTransition();
    vi.stubGlobal('document', {documentElement:{dataset:{}},startViewTransition: (callback: () => void) => {callback();return transition.native;}});
    const motion = await import('../../src/motion/transition');
    motion.withViewTransition(() => {});
    let entries = 0;
    const dispose = motion.afterPageSnapshots(() => entries++);
    expect(entries).toBe(0);
    transition.ready.resolve();
    transition.updateCallbackDone.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(entries).toBe(0);
    if (cancel) dispose();
    transition.finished.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(entries).toBe(cancel ? 0 : 1);
  });

  it('does not delay fallback entry when no native snapshots are active', async () => {
    const motion = await import('../../src/motion/transition');
    let entries = 0;
    const dispose = motion.afterPageSnapshots(() => entries++);
    expect(entries).toBe(1);
    dispose();
    expect(entries).toBe(1);
  });

  it.each([
    ['Win32', 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15', true],
    ['MacIntel', 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15', false],
    ['iPhone', 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile Safari/604.1', false],
    ['Win32', 'Mozilla/5.0 AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0', false],
    ['Linux x86_64', 'Mozilla/5.0 AppleWebKit/605.1.15 Version/27.2 Safari/605.1.15', false],
  ])('keeps native lifecycle but selects safe page entry only for Windows WebKit (%s)', async (platform, userAgent, domEntry) => {
    installPreference();
    vi.stubGlobal('navigator', { platform, userAgent });
    const transition = controlledTransition();
    const events: string[] = [];
    const dataset: Record<string, string> = {};
    vi.stubGlobal('document', {
      documentElement: { dataset },
      startViewTransition: (callback: () => void) => {
        events.push('native');
        callback();
        callback();
        return transition.native;
      },
    });
    const { withViewTransition } = await import('../../src/motion/transition');
    withViewTransition(() => events.push('update'), () => events.push('dom-entry'));
    expect(events).toEqual(domEntry ? ['native', 'dom-entry', 'update'] : ['native', 'update']);
    if (domEntry) expect(dataset.snapshotMotion).toBe('static');
    transition.ready.resolve();
    transition.updateCallbackDone.resolve();
    transition.finished.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(events.filter(event => event === 'update')).toHaveLength(1);
  });

  it('keeps immediate reduced-motion updates on the Windows snapshot compatibility path', async () => {
    installPreference(true);
    vi.stubGlobal('navigator', { platform: 'Win32', userAgent: 'AppleWebKit/605.1.15 Safari/605.1.15' });
    const native = vi.fn();
    vi.stubGlobal('document', { startViewTransition: native, documentElement: { dataset: {} } });
    const events: string[] = [];
    const { withViewTransition } = await import('../../src/motion/transition');
    withViewTransition(() => events.push('update'), () => events.push('dom-entry'));
    expect(native).not.toHaveBeenCalled();
    expect(events).toEqual(['dom-entry', 'update']);
  });

  it.each([undefined, {}])('updates immediately when the browser API is absent: %j', async (documentValue) => {
    installPreference();
    vi.stubGlobal('document', documentValue);
    let updates = 0;
    const events: string[] = [];
    const motion = await import('../../src/motion/transition');
    motion.withViewTransition(() => {
      events.push('update');
      updates++;
    }, () => events.push('fallback'));

    expect(updates).toBe(1);
    expect(events).toEqual(['fallback', 'update']);
  });

  it('uses an immediate update for reduced motion', async () => {
    installPreference(true);
    let updates = 0;
    let transitions = 0;
    const events: string[] = [];
    vi.stubGlobal('document', { startViewTransition: () => transitions++ });
    const motion = await import('../../src/motion/transition');
    motion.withViewTransition(() => {
      events.push('update');
      updates++;
    }, () => events.push('fallback'));

    expect(updates).toBe(1);
    expect(transitions).toBe(0);
    expect(events).toEqual(['fallback', 'update']);
  });

  it.each([false, true])(
    'falls back exactly once when transition creation throws (callback ran=%s)',
    async (invokeFirst) => {
      installPreference();
      let updates = 0;
      const events: string[] = [];
      vi.stubGlobal('document', {
        startViewTransition: (callback: () => void) => {
          if (invokeFirst) callback();
          throw new Error('transition unavailable');
        },
      });
      const motion = await import('../../src/motion/transition');
      motion.withViewTransition(() => {
        events.push('update');
        updates++;
      }, () => events.push('fallback'));

      expect(updates).toBe(1);
      expect(events).toEqual(invokeFirst ? ['update'] : ['fallback', 'update']);
    },
  );

  it.each(['ready', 'finished', 'updateCallbackDone'] as const)(
    'handles %s rejection without losing or repeating the update',
    async (rejectedPromise) => {
      installPreference();
      const transition = controlledTransition();
      let queuedUpdate = () => undefined;
      let updates = 0;
      const events: string[] = [];
      vi.stubGlobal('document', {
        startViewTransition: (callback: () => void) => {
          queuedUpdate = callback;
          return transition.native;
        },
      });
      const { withViewTransition } = await import('../../src/motion/transition');
      withViewTransition(() => {
        events.push('update');
        updates++;
      }, () => events.push('fallback'));

      transition[rejectedPromise].reject(new Error('native transition rejected'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(updates).toBe(1);
      queuedUpdate();
      queuedUpdate();
      expect(updates).toBe(1);
      expect(events).toEqual(['fallback', 'update']);
      transition.ready.resolve();
      transition.finished.resolve();
      transition.updateCallbackDone.resolve();
    },
  );

  it('keeps only the latest queued navigation and skips the previous visual transition', async () => {
    installPreference();
    const transitions = [controlledTransition(), controlledTransition()];
    const callbacks: Array<() => void> = [];
    const updates: string[] = [];
    const fallbacks: string[] = [];
    vi.stubGlobal('document', {
      startViewTransition: (callback: () => void) => {
        callbacks.push(callback);
        return transitions[callbacks.length - 1].native;
      },
    });
    const { withViewTransition } = await import('../../src/motion/transition');
    withViewTransition(() => updates.push('old'), () => fallbacks.push('old'));
    withViewTransition(() => updates.push('latest'), () => fallbacks.push('latest'));

    callbacks[1]();
    callbacks[0]();
    callbacks[1]();
    expect(updates).toEqual(['latest']);
    expect(fallbacks).toEqual([]);
    expect(transitions[0].skipCount()).toBe(1);
  });

  it.each(['missing', 'reduced', 'throws'])(
    'invalidates a queued native update when the latest request falls back (%s)',
    async (fallback) => {
      const preference = installPreference();
      const old = controlledTransition();
      let oldUpdate = () => undefined;
      const updates: string[] = [];
      const events: string[] = [];
      vi.stubGlobal('document', {
        startViewTransition: (callback: () => void) => {
          oldUpdate = callback;
          return old.native;
        },
      });
      const { withViewTransition } = await import('../../src/motion/transition');
      withViewTransition(() => {
        events.push('old update');
        updates.push('old');
      }, () => events.push('old fallback'));
      if (fallback === 'missing') vi.stubGlobal('document', {});
      if (fallback === 'reduced') preference.set(true);
      if (fallback === 'throws')
        vi.stubGlobal('document', {
          startViewTransition: () => {
            throw new Error('unavailable');
          },
        });
      withViewTransition(() => {
        events.push('latest update');
        updates.push('latest');
      }, () => events.push('latest fallback'));

      oldUpdate();
      old.ready.reject(new Error('old snapshot rejected'));
      old.finished.reject(new Error('old transition skipped'));
      old.updateCallbackDone.reject(new Error('old callback rejected'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(updates).toEqual(['latest']);
      expect(events).toEqual(['latest fallback', 'latest update']);
      expect(old.skipCount()).toBe(1);
    },
  );

  it('keeps navigation working when cancelling the previous visual throws', async () => {
    installPreference();
    const old = controlledTransition();
    old.native.skipTransition = () => {
      throw new Error('cannot skip');
    };
    let oldUpdate = () => undefined;
    const updates: string[] = [];
    vi.stubGlobal('document', {
      startViewTransition: (callback: () => void) => {
        oldUpdate = callback;
        return old.native;
      },
    });
    const { withViewTransition } = await import('../../src/motion/transition');
    withViewTransition(() => updates.push('old'));
    vi.stubGlobal('document', {});
    withViewTransition(() => updates.push('latest'));
    oldUpdate();

    expect(updates).toEqual(['latest']);
  });

  it('releases a finished native transition before another navigation', async () => {
    installPreference();
    const transition = controlledTransition();
    let updates = 0;
    vi.stubGlobal('document', {
      startViewTransition: (callback: () => void) => {
        callback();
        return transition.native;
      },
    });
    const { withViewTransition } = await import('../../src/motion/transition');
    withViewTransition(() => updates++);
    transition.ready.resolve();
    transition.updateCallbackDone.resolve();
    transition.finished.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    vi.stubGlobal('document', {});
    withViewTransition(() => updates++);

    expect(updates).toBe(2);
    expect(transition.skipCount()).toBe(0);
  });

  it('skips an active visual immediately when reduced motion becomes enabled', async () => {
    const preference = installPreference();
    const transition = controlledTransition();
    let queuedUpdate = () => undefined;
    let updates = 0;
    vi.stubGlobal('document', {
      startViewTransition: (callback: () => void) => {
        queuedUpdate = callback;
        return transition.native;
      },
    });
    const { withViewTransition } = await import('../../src/motion/transition');
    withViewTransition(() => updates++);
    preference.set(true);
    queuedUpdate();
    queuedUpdate();

    expect(updates).toBe(1);
    expect(transition.skipCount()).toBe(1);
    expect(preference.listenerCount()).toBe(0);
  });

  it('cleans preference subscriptions when a transition is superseded or finished', async () => {
    const preference = installPreference();
    const transitions = [controlledTransition(), controlledTransition()];
    let index = 0;
    vi.stubGlobal('document', { startViewTransition: () => transitions[index++].native });
    const { withViewTransition } = await import('../../src/motion/transition');
    withViewTransition(() => undefined);
    expect(preference.listenerCount()).toBe(1);
    withViewTransition(() => undefined);
    expect(preference.listenerCount()).toBe(1);
    transitions[1].finished.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(preference.listenerCount()).toBe(0);
  });

  it.each(['ready', 'finished', 'updateCallbackDone'] as const)(
    'does not announce fallback when %s rejects after the native update committed',
    async (rejectedPromise) => {
      installPreference();
      const transition = controlledTransition();
      const events: string[] = [];
      vi.stubGlobal('document', {
        startViewTransition: (callback: () => void) => {
          callback();
          return transition.native;
        },
      });
      const { withViewTransition } = await import('../../src/motion/transition');
      withViewTransition(() => events.push('update'), () => events.push('fallback'));

      transition[rejectedPromise].reject(new Error('native transition rejected after update'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(events).toEqual(['update']);
      transition.ready.resolve();
      transition.finished.resolve();
      transition.updateCallbackDone.resolve();
    },
  );
});
