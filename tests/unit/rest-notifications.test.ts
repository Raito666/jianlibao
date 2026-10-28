import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeRestScheduler, REST_NOTIFICATION_ID, type NotificationPort } from '../../src/platform/rest-notifications';

function setup(permission = 'granted') {
  const notifications = {
    checkPermissions: vi.fn(async () => ({ display: permission })),
    requestPermissions: vi.fn(async () => ({ display: permission })),
    schedule: vi.fn(async () => ({ notifications: [{ id: REST_NOTIFICATION_ID }] })),
    cancel: vi.fn(async () => {}),
    removeDeliveredNotificationsById: vi.fn(async () => {}),
  };
  const state = vi.fn();
  const scheduler = createNativeRestScheduler(async () => ({ notifications: notifications as NotificationPort }), state);
  return { notifications, scheduler, state };
}
const target = { id: 'session-a', status: 'active' as const, restUntil: 120_000 };
const preferences = { sound: true, vibration: true };
describe('native rest scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100_000); });
  afterEach(() => vi.useRealTimers());
  it('schedules the persisted absolute deadline, suppresses native foreground presentation and never auto-requests', async () => {
    const { scheduler, notifications } = setup();
    await scheduler.update(target, true, preferences);
    const note = notifications.schedule.mock.calls[0][0].notifications[0];
    expect(note.id).toBe(REST_NOTIFICATION_ID);
    expect(note.schedule?.at?.getTime()).toBe(target.restUntil);
    expect(note.foreground).toBe(false);
    expect(note.sound).toBe('default');
    expect(note.extra).toEqual({ sessionId: target.id, restUntil: target.restUntil });
    expect(notifications.requestPermissions).not.toHaveBeenCalled();
    expect(scheduler.scheduled(target.id, target.restUntil)).toBe(true);
  });
  it.each(['prompt', 'denied'])('does not schedule or request when permission is %s', async permission => {
    const { scheduler, notifications, state } = setup(permission);
    await scheduler.update(target, true, preferences);
    expect(notifications.schedule).not.toHaveBeenCalled();
    expect(notifications.requestPermissions).not.toHaveBeenCalled();
    expect(state).toHaveBeenLastCalledWith(permission);
  });
  it('requests only from the explicit enable action and gracefully reports denial', async () => {
    const { scheduler, notifications, state } = setup('prompt');
    notifications.requestPermissions.mockResolvedValue({ display: 'denied' });
    await scheduler.setEnabled(true);
    expect(notifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(notifications.schedule).not.toHaveBeenCalled();
    expect(state).toHaveBeenLastCalledWith('denied');
  });
  it.each([null, 'paused', 'review', 'completed', 'readonly', 'muted'])('cancels on %s, without touching unrelated notification ids', async mode => {
    const { scheduler, notifications } = setup();
    await scheduler.update(target, true, preferences);
    await scheduler.update(mode === null ? undefined : { ...target, status: ['paused', 'review', 'completed'].includes(mode) ? mode as 'paused' : 'active' }, mode !== 'readonly', mode === 'muted' ? { sound: false, vibration: false } : preferences);
    expect(notifications.cancel).toHaveBeenLastCalledWith({ notifications: [{ id: REST_NOTIFICATION_ID }] });
    expect(notifications.schedule).toHaveBeenCalledTimes(1);
    expect(scheduler.scheduled(target.id, target.restUntil)).toBe(false);
  });
  it('replaces an extended deadline and omits sound when disabled', async () => {
    const { scheduler, notifications } = setup();
    await scheduler.update(target, true, preferences);
    await scheduler.update({ ...target, restUntil: 150_000 }, true, { sound: false, vibration: true });
    const note = notifications.schedule.mock.calls.at(-1)![0].notifications[0];
    expect(note.schedule?.at?.getTime()).toBe(150_000);
    expect(note.sound).toBeUndefined();
  });
  it('never schedules an expired persisted deadline or off preference', async () => {
    const { scheduler, notifications } = setup();
    await scheduler.update({ ...target, restUntil: 99_000 }, true, preferences);
    await scheduler.setEnabled(false);
    await scheduler.update(target, true, preferences);
    expect(notifications.schedule).not.toHaveBeenCalled();
  });
  it('serializes pending scheduling and cancellation so a skip wins a race', async () => {
    const { scheduler, notifications } = setup();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    notifications.schedule.mockImplementationOnce(async () => { await gate; return { notifications: [{ id: REST_NOTIFICATION_ID }] }; });
    const pending = scheduler.update(target, true, preferences);
    await vi.waitFor(() => expect(notifications.schedule).toHaveBeenCalledTimes(1));
    const skipped = scheduler.update(undefined, true, preferences);
    finish();
    await Promise.all([pending, skipped]);
    expect(notifications.cancel.mock.invocationCallOrder.at(-1)).toBeGreaterThan(notifications.schedule.mock.invocationCallOrder[0]);
    expect(scheduler.scheduled(target.id, target.restUntil)).toBe(false);
  });
  it('contains plugin failures, reports degraded status, and retries on refresh', async () => {
    const { scheduler, notifications, state } = setup();
    notifications.cancel.mockRejectedValueOnce(new Error('bridge unavailable'));
    await expect(scheduler.update(target, true, preferences)).resolves.toBeUndefined();
    expect(state).toHaveBeenLastCalledWith('error');
    await scheduler.refresh();
    expect(notifications.schedule).toHaveBeenCalledTimes(1);
  });
  it('still cancels a scheduled rest when permission querying fails after a skip', async () => {
    const { scheduler, notifications } = setup();
    await scheduler.update(target, true, preferences);
    notifications.checkPermissions.mockRejectedValueOnce(new Error('permission bridge failed'));
    await scheduler.update(undefined, true, preferences);
    expect(notifications.cancel).toHaveBeenCalledTimes(2);
    expect(scheduler.scheduled(target.id, target.restUntil)).toBe(false);
  });
});
