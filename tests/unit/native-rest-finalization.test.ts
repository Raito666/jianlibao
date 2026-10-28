import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeRestScheduler, REST_NOTIFICATION_ID, type NotificationPort } from '../../src/platform/rest-notifications';

const target = { id: 'cleanup-session', status: 'active' as const, restUntil: 150_000 };
const preferences = { sound: true, vibration: true };

function fixture(scheduleGate: Promise<void> = Promise.resolve()) {
  const pending = new Set<number>();
  const notifications = {
    checkPermissions: vi.fn(async () => ({ display: 'granted' as const })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' as const })),
    schedule: vi.fn(async (options: Parameters<NotificationPort['schedule']>[0]) => {
      await scheduleGate;
      for (const note of options.notifications) pending.add(note.id);
      return { notifications: options.notifications.map(note => ({ id: note.id })) };
    }),
    cancel: vi.fn(async (options: Parameters<NotificationPort['cancel']>[0]) => {
      for (const note of options.notifications) pending.delete(note.id);
    }),
    removeDeliveredNotificationsById: vi.fn(async () => {}),
  };
  const load = vi.fn(async () => ({ notifications }));
  return { pending, notifications, load, scheduler: createNativeRestScheduler(load) };
}

describe('native rest final cancellation', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
  afterEach(() => vi.useRealTimers());

  it.each(['skip', 'paused', 'review', 'completed', 'readonly', 'muted', 'off'] as const)(
    'finishes %s cancellation after a late native schedule even if the JS controller is disposed', async mode => {
      let release!: () => void;
      const f = fixture(new Promise(resolve => { release = resolve; }));
      const scheduling = f.scheduler.update(target, true, preferences);
      await vi.waitFor(() => expect(f.notifications.schedule).toHaveBeenCalledTimes(1));
      const cancelling = mode === 'off' ? f.scheduler.setEnabled(false) : f.scheduler.update(
        mode === 'skip' ? undefined : { ...target, status: mode === 'paused' || mode === 'review' || mode === 'completed' ? mode : 'active' },
        mode !== 'readonly', mode === 'muted' ? { sound: false, vibration: false } : preferences,
      );
      const closing = f.scheduler.dispose();
      release();
      await Promise.all([scheduling, cancelling, closing]);
      expect(f.pending.size).toBe(0);
      expect(f.notifications.cancel.mock.invocationCallOrder.at(-1)).toBeGreaterThan(f.notifications.schedule.mock.invocationCallOrder[0]);
      expect(f.notifications.cancel).toHaveBeenLastCalledWith({ notifications: [{ id: REST_NOTIFICATION_ID }] });
      expect(f.notifications.requestPermissions).not.toHaveBeenCalled();
      expect(f.scheduler.scheduled(target.id, target.restUntil)).toBe(false);
    },
  );

  it('finishes a queued skip after an already acknowledged schedule before disposal', async () => {
    const f = fixture();
    await f.scheduler.update(target, true, preferences);
    const cancelling = f.scheduler.update(undefined, true, preferences);
    await Promise.all([cancelling, f.scheduler.dispose()]);
    expect(f.pending.size).toBe(0);
  });

  it('preserves a valid committed system notification when closing or reloading', async () => {
    const f = fixture();
    await f.scheduler.update(target, true, preferences);
    await f.scheduler.dispose();
    expect(f.pending).toEqual(new Set([REST_NOTIFICATION_ID]));
    expect(f.notifications.cancel).toHaveBeenCalledTimes(1);
  });

  it('does not start a bridge cleanup for an idle controller that never issued a notification', async () => {
    const f = fixture();
    await f.scheduler.dispose();
    expect(f.load).not.toHaveBeenCalled();
  });
});
