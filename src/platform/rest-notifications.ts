import type { Session } from '../domain/types';
import type { LocalNotificationsPlugin } from '@capacitor/local-notifications';

export type NotificationPort = Pick<LocalNotificationsPlugin,
  'checkPermissions' | 'requestPermissions' | 'schedule' | 'cancel' | 'removeDeliveredNotificationsById'>;
export type NotificationState = 'prompt' | 'granted' | 'denied' | 'off' | 'error';
export const REST_NOTIFICATION_ID = 5104001;
export type RestTarget = Pick<Session, 'id' | 'status' | 'restUntil'>;
export type AlertPreferences = { sound: boolean; vibration: boolean };

export function createNativeRestScheduler(
  load: () => Promise<{ notifications: NotificationPort }>,
  onState: (state: NotificationState) => void = () => {},
) {
  let target: RestTarget | undefined;
  let writable = false;
  let preferences: AlertPreferences = { sound: true, vibration: true };
  let enabled = true;
  let disposed = false;
  let generation = 0;
  let scheduled: { sessionId: string; restUntil: number } | null = null;
  let mayHaveNotification = false;
  let queue = Promise.resolve();
  const report = (state: NotificationState) => { if (!disposed) onState(state); };
  const reconcile = (requestPermission = false) => {
    const ticket = ++generation;
    queue = queue.then(async () => {
      if (disposed || (ticket !== generation && !requestPermission)) return;
      const { notifications } = await load();
      if (disposed) return;
      if (ticket !== generation && !requestPermission) return;
      scheduled = null;
      // Cancellation needs no authorization. It must still run if permission querying later fails.
      await notifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
      mayHaveNotification = false;
      await notifications.removeDeliveredNotificationsById({ ids: [REST_NOTIFICATION_ID] });
      if (disposed || (ticket !== generation && !requestPermission)) return;
      let permission = await notifications.checkPermissions();
      // schedule() in plugin 8.3+ can request permission itself. Never call it before a grant.
      if (requestPermission && enabled && permission.display !== 'granted' && permission.display !== 'denied') {
        permission = await notifications.requestPermissions();
      }
      if (disposed || ticket !== generation) return;
      const state = enabled ? permission.display === 'granted' ? 'granted' : permission.display === 'denied' ? 'denied' : 'prompt' : 'off';
      report(state);
      const restUntil = target?.restUntil;
      if (state !== 'granted' || !writable || target?.status !== 'active'
        || typeof restUntil !== 'number' || !Number.isFinite(restUntil) || restUntil <= Date.now()
        || (!preferences.sound && !preferences.vibration)) return;
      const sessionId = target.id;
      mayHaveNotification = true;
      await notifications.schedule({ notifications: [{
        id: REST_NOTIFICATION_ID,
        title: '休息结束',
        body: '可以开始下一组了。',
        schedule: { at: new Date(restUntil) },
        foreground: false,
        ...(preferences.sound ? { sound: 'default' } : {}),
        extra: { sessionId, restUntil },
      }] });
      if (!disposed && ticket === generation) scheduled = { sessionId, restUntil };
    }).catch(() => { scheduled = null; report('error'); });
    return queue;
  };
  return {
    update(next: RestTarget | undefined, canWrite: boolean, nextPreferences: AlertPreferences) {
      target = next ? { ...next } : undefined;
      writable = canWrite;
      preferences = { ...nextPreferences };
      return reconcile();
    },
    setEnabled(value: boolean) { enabled = value; return reconcile(value); },
    refresh: () => reconcile(),
    scheduled: (sessionId: string, restUntil: number) => scheduled?.sessionId === sessionId && scheduled.restUntil === restUntil,
    dispose() {
      if (disposed) return queue;
      const preserve = enabled && writable && target?.status === 'active'
        && typeof target.restUntil === 'number' && Number.isFinite(target.restUntil)
        && (preferences.sound || preferences.vibration);
      disposed = true; generation++;
      // A skip/pause can be queued behind a native schedule. Drain its final cancellation
      // after that schedule settles; otherwise disposal would leave a stale OS alert.
      // Valid committed alerts survive reload. Idle StrictMode cleanup does not touch the bridge.
      if (mayHaveNotification && !preserve) {
        scheduled = null;
        queue = queue.then(async () => {
          const { notifications } = await load();
          await notifications.cancel({ notifications: [{ id: REST_NOTIFICATION_ID }] });
          mayHaveNotification = false;
          await notifications.removeDeliveredNotificationsById({ ids: [REST_NOTIFICATION_ID] });
        }).catch(() => { scheduled = null; });
      }
      return queue;
    },
  };
}
