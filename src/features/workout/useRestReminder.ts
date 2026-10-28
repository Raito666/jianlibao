import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '../../domain/types';
import { createRestAlertController, createRestDeadlineWatcher } from './rest-alert';
import { isIos, loadNativeRuntime, nativeFeedback, watchNativeActivity } from '../../platform/native';
import { createNativeRestScheduler, type NotificationState } from '../../platform/rest-notifications';
import { createWakeLockController, type WakeState } from '../../platform/wake-lock';

export function useRestReminder(session: Session | undefined, writable: boolean, onRestComplete: () => void) {
  const [sound, setSoundState] = useState(true);
  const [vibration, setVibrationState] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [vibrationSupported, setVibrationSupported] = useState(false);
  const native = isIos();
  const [notificationState, setNotificationState] = useState<NotificationState>('prompt');
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [keepAwake, setKeepAwakeState] = useState(false);
  const [wakeState, setWakeState] = useState<WakeState>('off');
  const keepAwakeWanted = useRef(false);
  const foreground = useRef(true);
  const backgroundRest = useRef<number | null>(null);
  const scheduler = useRef<ReturnType<typeof createNativeRestScheduler> | null>(null);
  const wake = useRef<ReturnType<typeof createWakeLockController> | null>(null);
  const preferences = useRef({ sound: true, vibration: true });
  const latest = useRef({ session, writable, onRestComplete });
  latest.current = { session, writable, onRestComplete };
  const controller = useRef<ReturnType<typeof createRestAlertController> | null>(null);
  const watcher = useRef<ReturnType<typeof createRestDeadlineWatcher> | null>(null);

  useEffect(() => {
    const alert = createRestAlertController(setAudioReady);
    alert.setPreferences({ ...preferences.current, vibration: !native && preferences.current.vibration });
    setVibrationSupported(native || alert.vibrationSupported);
    const notifications = native ? createNativeRestScheduler(loadNativeRuntime, setNotificationState) : null;
    const screen = createWakeLockController(navigator.wakeLock, setWakeState);
    scheduler.current = notifications; wake.current = screen;
    foreground.current = document.visibilityState === 'visible';
    const observer = createRestDeadlineWatcher((sessionId, restUntil) => {
      const current = latest.current;
      // A new render may replace or cancel the rest before its effect runs.
      if (!current.writable || current.session?.id !== sessionId
        || current.session.status !== 'active' || current.session.restUntil !== restUntil) return;
      // The OS owns background delivery. Avoid a second ring/haptic when returning after its deadline.
      const systemHandled = native && (backgroundRest.current === restUntil && notifications?.scheduled(sessionId, restUntil));
      if (foreground.current && !systemHandled) {
        alert.play();
        if (native && preferences.current.vibration) void nativeFeedback('success');
      }
      current.onRestComplete();
    });
    controller.current = alert; watcher.current = observer;
    observer.update(latest.current.session, latest.current.writable);
    const unlock = (event: Event) => {
      if (event.isTrusted && latest.current.writable) void alert.unlockAudio();
    };
    let appActive = true;
    const syncEnvironment = () => {
      const visible = appActive && document.visibilityState === 'visible';
      if (foreground.current && !visible) backgroundRest.current = latest.current.session?.restUntil ?? null;
      foreground.current = visible;
      const current = latest.current;
      void screen.update(keepAwakeWanted.current && current.writable && current.session?.status === 'active', visible);
      if (!visible) return;
      observer.update(latest.current.session, latest.current.writable);
      observer.check();
      // Recheck permissions after a Settings change and rebuild only a still-future deadline.
      void notifications?.refresh();
    };
    const visibility = () => syncEnvironment();
    const stopActivity = watchNativeActivity(active => {
      appActive = active;
      syncEnvironment();
      if (active) window.dispatchEvent(new Event('jianlibao:resume'));
    });
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', visibility);
      stopActivity(); notifications?.dispose(); void screen.dispose();
      observer.dispose(); alert.dispose();
      controller.current = null; watcher.current = null; scheduler.current = null; wake.current = null;
    };
  }, []);

  useEffect(() => {
    watcher.current?.update(session, writable);
    void scheduler.current?.update(session, writable, preferences.current);
    void wake.current?.update(keepAwakeWanted.current && writable && session?.status === 'active', foreground.current);
  }, [session?.id, session?.status, session?.restUntil, writable]);

  const setSound = useCallback((value: boolean) => {
    preferences.current = { ...preferences.current, sound: value };
    controller.current?.setPreferences({ ...preferences.current, vibration: !native && preferences.current.vibration });
    void scheduler.current?.update(latest.current.session, latest.current.writable, preferences.current);
    setSoundState(value);
  }, []);
  const setVibration = useCallback((value: boolean) => {
    preferences.current = { ...preferences.current, vibration: value };
    controller.current?.setPreferences({ ...preferences.current, vibration: !native && preferences.current.vibration });
    void scheduler.current?.update(latest.current.session, latest.current.writable, preferences.current);
    setVibrationState(value);
  }, []);
  const testAlert = useCallback(() => {
    if (!latest.current.writable) return;
    void controller.current?.testAlert();
    if (native && preferences.current.vibration) void nativeFeedback('success');
  }, []);
  const setBackgroundReminder = useCallback(async (enabled: boolean) => {
    if (!latest.current.writable) return;
    setNotificationBusy(true);
    try { await scheduler.current?.setEnabled(enabled); } finally { setNotificationBusy(false); }
  }, []);
  const setKeepAwake = useCallback((enabled: boolean) => {
    keepAwakeWanted.current = enabled; setKeepAwakeState(enabled);
    const current = latest.current;
    void wake.current?.update(enabled && current.writable && current.session?.status === 'active', foreground.current);
  }, []);

  return { sound, vibration, setSound, setVibration, testAlert, audioReady, vibrationSupported,
    native, notificationState, notificationBusy, setBackgroundReminder, keepAwake, setKeepAwake, wakeState };
}
