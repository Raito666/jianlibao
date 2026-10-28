import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/domain/types';
import { createRestAlertController, createRestDeadlineWatcher } from '../../src/features/workout/rest-alert';

const start = Date.parse('2026-10-17T10:00:00.000Z');
function rest(restUntil: number | null = start + 10_000, overrides: Partial<Session> = {}): Session {
  return {
    id: 'training-a', name: '训练', startedAt: new Date(start).toISOString(), updatedAt: new Date(start).toISOString(),
    date: '2026-10-17', timeZone: 'Asia/Shanghai', status: 'active', pausedMs: 0,
    restUntil, restDuration: 90, exercises: [], note: '', ...overrides,
  };
}

describe('rest deadline watcher', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('alerts once at an observed deadline and does not repeat after rerender or visibility checks', () => {
    const completed = vi.fn();
    const watcher = createRestDeadlineWatcher(completed);
    watcher.update(rest(), true);
    vi.advanceTimersByTime(9_999);
    expect(completed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(completed).toHaveBeenCalledExactlyOnceWith('training-a', start + 10_000);
    watcher.update(rest(), true);
    watcher.check();
    vi.advanceTimersByTime(60_000);
    expect(completed).toHaveBeenCalledTimes(1);
    watcher.dispose();
  });

  it('replaces the old timeout when rest is extended by thirty seconds', () => {
    const completed = vi.fn();
    const watcher = createRestDeadlineWatcher(completed);
    watcher.update(rest(), true);
    vi.advanceTimersByTime(5_000);
    watcher.update(rest(start + 40_000), true);
    vi.advanceTimersByTime(5_000);
    expect(completed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(completed).toHaveBeenCalledExactlyOnceWith('training-a', start + 40_000);
    watcher.dispose();
  });

  it.each([
    ['skip', rest(null), true],
    ['pause', rest(start + 10_000, { status: 'paused' }), true],
    ['review', rest(start + 10_000, { status: 'review' }), true],
    ['cancel', rest(start + 10_000, { status: 'cancelled' }), true],
    ['complete', rest(start + 10_000, { status: 'completed' }), true],
    ['read-only', rest(), false],
    ['no active training', undefined, true],
  ])('cancels a pending reminder for %s', (_name, nextSession, writable) => {
    const completed = vi.fn();
    const watcher = createRestDeadlineWatcher(completed);
    watcher.update(rest(), true);
    vi.advanceTimersByTime(5_000);
    watcher.update(nextSession, writable);
    vi.advanceTimersByTime(60_000);
    watcher.check();
    expect(completed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    watcher.dispose();
  });

  it('drops the prior training reminder when the current training changes', () => {
    const completed = vi.fn();
    const watcher = createRestDeadlineWatcher(completed);
    watcher.update(rest(), true);
    watcher.update(rest(start + 20_000, { id: 'training-b' }), true);
    vi.advanceTimersByTime(10_000);
    expect(completed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(completed).toHaveBeenCalledExactlyOnceWith('training-b', start + 20_000);
    watcher.dispose();
  });

  it('catches up once after a long background suspension without relying on timer delivery', () => {
    const completed = vi.fn();
    const watcher = createRestDeadlineWatcher(completed);
    watcher.update(rest(), true);
    vi.setSystemTime(start + 3_600_000);
    watcher.check();
    watcher.check();
    vi.runOnlyPendingTimers();
    expect(completed).toHaveBeenCalledExactlyOnceWith('training-a', start + 10_000);
    expect(vi.getTimerCount()).toBe(0);
    watcher.dispose();
  });

  it('does not replay an already expired deadline on first load or after read-only access', () => {
    const completed = vi.fn();
    const watcher = createRestDeadlineWatcher(completed);
    watcher.update(rest(start - 1), true);
    watcher.check();
    watcher.update(rest(start + 10_000), false);
    vi.setSystemTime(start + 20_000);
    watcher.update(rest(start + 10_000), true);
    watcher.check();
    expect(completed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    watcher.dispose();
  });

  it('can observe a new future rest after a completed or skipped rest', () => {
    const completed = vi.fn();
    const watcher = createRestDeadlineWatcher(completed);
    watcher.update(rest(), true);
    vi.advanceTimersByTime(10_000);
    watcher.update(rest(null), true);
    watcher.update(rest(start + 20_000), true);
    vi.advanceTimersByTime(10_000);
    expect(completed.mock.calls).toEqual([
      ['training-a', start + 10_000], ['training-a', start + 20_000],
    ]);
    watcher.dispose();
  });

  it('cleans up its timeout and ignores checks and updates after disposal', () => {
    const completed = vi.fn();
    const watcher = createRestDeadlineWatcher(completed);
    watcher.update(rest(), true);
    watcher.dispose();
    expect(vi.getTimerCount()).toBe(0);
    watcher.update(rest(), true);
    vi.advanceTimersByTime(10_000);
    watcher.check();
    expect(completed).not.toHaveBeenCalled();
  });
});

function fakeOscillator() {
  return {
    type: 'sine', frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(),
    start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null,
  };
}
function fakeGain() {
  return {
    gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn(),
  };
}
class FakeAudioContext extends EventTarget {
  static instances: FakeAudioContext[] = [];
  state = 'suspended';
  currentTime = 3;
  destination = {};
  oscillators: ReturnType<typeof fakeOscillator>[] = [];
  gains: ReturnType<typeof fakeGain>[] = [];
  resume = vi.fn(async () => { this.state = 'running'; this.dispatchEvent(new Event('statechange')); });
  close = vi.fn(async () => { this.state = 'closed'; });
  createOscillator = vi.fn(() => {
    const node = fakeOscillator();
    this.oscillators.push(node);
    return node;
  });
  createGain = vi.fn(() => {
    const node = fakeGain();
    this.gains.push(node);
    return node;
  });
  constructor() { super(); FakeAudioContext.instances.push(this); }
}

describe('progressive Web rest alerts', () => {
  const vibrate = vi.fn((_pattern: number[]) => true);
  beforeEach(() => {
    FakeAudioContext.instances = [];
    vibrate.mockReset().mockReturnValue(true);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('webkitAudioContext', undefined);
    vi.stubGlobal('navigator', { vibrate });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('never creates or resumes audio for a timer alert before a user gesture', () => {
    const controller = createRestAlertController();
    controller.play();
    expect(FakeAudioContext.instances).toHaveLength(0);
    const pattern = vibrate.mock.calls[0][0];
    expect(pattern.length).toBeGreaterThan(0);
    expect(pattern.every((duration: number) => duration >= 0 && duration <= 500)).toBe(true);
    controller.dispose();
  });

  it('warms up once with silence and then plays a short tone at a bounded gain', async () => {
    const ready = vi.fn();
    const controller = createRestAlertController(ready);
    await controller.unlockAudio();
    await controller.unlockAudio();
    const context = FakeAudioContext.instances[0];
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.oscillators).toHaveLength(1);
    expect(context.gains[0].gain.setValueAtTime.mock.calls.every(([gain]) => gain === 0)).toBe(true);
    expect(ready).toHaveBeenLastCalledWith(true);
    controller.play();
    expect(context.oscillators).toHaveLength(2);
    const tone = context.oscillators[1];
    const gainValues = context.gains[1].gain.linearRampToValueAtTime.mock.calls.map(([gain]) => gain);
    expect(gainValues.some(gain => gain > 0 && gain <= 0.2)).toBe(true);
    expect(gainValues.at(-1)).toBe(0);
    expect(tone.start).toHaveBeenCalledWith(3);
    expect(tone.stop.mock.calls[0][0]).toBeGreaterThan(3);
    expect(tone.stop.mock.calls[0][0]).toBeLessThanOrEqual(3.5);
    tone.onended?.();
    expect(tone.disconnect).toHaveBeenCalledTimes(1);
    expect(context.gains[1].disconnect).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('keeps sound and vibration preferences independent and disabled alerts quiet', async () => {
    const controller = createRestAlertController();
    controller.setPreferences({ sound: false, vibration: false });
    await controller.testAlert();
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(vibrate).not.toHaveBeenCalled();
    controller.setPreferences({ sound: false, vibration: true });
    controller.play();
    expect(vibrate).toHaveBeenCalledTimes(1);
    controller.setPreferences({ sound: true, vibration: false });
    await controller.testAlert();
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(2);
    expect(vibrate).toHaveBeenCalledTimes(1);
    controller.setPreferences({ sound: false, vibration: false });
    controller.play();
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(2);
    expect(vibrate).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it('reports an interrupted audio context and waits for another gesture before resuming', async () => {
    const ready = vi.fn();
    const controller = createRestAlertController(ready);
    await controller.unlockAudio();
    const context = FakeAudioContext.instances[0];
    context.state = 'suspended';
    context.dispatchEvent(new Event('statechange'));
    controller.play();
    expect(ready).toHaveBeenLastCalledWith(false);
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.oscillators).toHaveLength(1);
    await controller.unlockAudio();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(ready).toHaveBeenLastCalledWith(true);
    controller.dispose();
  });

  it('degrades without audio or vibration APIs', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('navigator', {});
    const ready = vi.fn();
    const controller = createRestAlertController(ready);
    expect(controller.vibrationSupported).toBe(false);
    await expect(controller.testAlert()).resolves.toBeUndefined();
    expect(ready).not.toHaveBeenCalledWith(true);
    expect(() => controller.dispose()).not.toThrow();
  });

  it('catches construction and resume denials while still allowing supported vibration', async () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('unavailable'); } });
    const controller = createRestAlertController();
    await expect(controller.testAlert()).resolves.toBeUndefined();
    expect(vibrate).toHaveBeenCalledTimes(1);
    controller.dispose();

    vi.stubGlobal('AudioContext', FakeAudioContext);
    const ready = vi.fn();
    const denied = createRestAlertController(ready);
    const unlocking = denied.unlockAudio();
    const context = FakeAudioContext.instances[0];
    await unlocking;
    context.state = 'suspended';
    context.resume.mockRejectedValue(new Error('NotAllowedError'));
    await expect(denied.testAlert()).resolves.toBeUndefined();
    expect(ready).toHaveBeenLastCalledWith(false);
    expect(context.oscillators).toHaveLength(1);
    expect(vibrate).toHaveBeenCalledTimes(2);
    denied.dispose();
  });

  it('contains oscillator failures and vibration rejection or exceptions', async () => {
    const ready = vi.fn();
    const controller = createRestAlertController(ready);
    await controller.unlockAudio();
    const context = FakeAudioContext.instances[0];
    context.createOscillator.mockImplementationOnce(() => { throw new Error('device lost'); });
    vibrate.mockReturnValueOnce(false);
    expect(() => controller.play()).not.toThrow();
    expect(ready).toHaveBeenLastCalledWith(false);
    vibrate.mockImplementationOnce(() => { throw new Error('blocked'); });
    expect(() => controller.play()).not.toThrow();
    controller.dispose();
  });

  it('stays quiet after an initial resume rejection and can be enabled by a later gesture', async () => {
    vi.stubGlobal('AudioContext', class extends FakeAudioContext {
      resume = vi.fn(async (): Promise<void> => { throw new Error('NotAllowedError'); });
    });
    const ready = vi.fn();
    const controller = createRestAlertController(ready);
    await expect(controller.testAlert()).resolves.toBeUndefined();
    const context = FakeAudioContext.instances[0];
    expect(context.oscillators).toHaveLength(0);
    expect(ready).toHaveBeenLastCalledWith(false);
    context.resume.mockImplementation(async () => { context.state = 'running'; });
    await controller.testAlert();
    expect(context.oscillators).toHaveLength(2);
    expect(ready).toHaveBeenLastCalledWith(true);
    expect(vibrate).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('stops and disconnects live nodes, removes context subscriptions and catches close rejection', async () => {
    const controller = createRestAlertController();
    await controller.unlockAudio();
    controller.play();
    const context = FakeAudioContext.instances[0];
    const removed = vi.spyOn(context, 'removeEventListener');
    context.close.mockRejectedValue(new Error('already closed'));
    controller.dispose();
    await Promise.resolve();
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(removed).toHaveBeenCalledWith('statechange', expect.any(Function));
    for (const node of context.oscillators) {
      expect(node.stop).toHaveBeenCalled();
      expect(node.disconnect).toHaveBeenCalledTimes(1);
    }
    for (const gain of context.gains) expect(gain.disconnect).toHaveBeenCalledTimes(1);
    await controller.testAlert();
    controller.play();
    expect(context.oscillators).toHaveLength(2);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('does not warm up or report ready if disposed while audio resume is pending', async () => {
    const ready = vi.fn();
    const controller = createRestAlertController(ready);
    const unlocking = controller.unlockAudio();
    controller.dispose();
    await unlocking;
    expect(FakeAudioContext.instances[0].oscillators).toHaveLength(0);
    expect(ready).not.toHaveBeenCalledWith(true);
  });
});
