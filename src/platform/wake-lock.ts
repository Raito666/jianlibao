export type WakeState = 'off' | 'pending' | 'on' | 'unavailable';
export interface WakeHandle { release(): Promise<void>; addEventListener(type: 'release', callback: () => void): void }
export function createWakeLockController(
  api: { request(type: 'screen'): Promise<WakeHandle> } | undefined,
  onState: (state: WakeState) => void = () => {},
) {
  let wanted = false, foreground = true, disposed = false;
  let held: WakeHandle | null = null;
  let queue = Promise.resolve();
  const reconcile = () => {
    queue = queue.then(async () => {
      const shouldHold = () => wanted && foreground && !disposed;
      if (!shouldHold()) {
        const previous = held; held = null;
        if (previous) await previous.release();
        onState('off'); return;
      }
      if (held) return;
      if (!api) { onState('unavailable'); return; }
      onState('pending');
      const acquired = await api.request('screen');
      if (!shouldHold()) { await acquired.release(); onState('off'); return; }
      held = acquired;
      acquired.addEventListener('release', () => {
        if (held === acquired) { held = null; onState('off'); }
      });
      onState('on');
    }).catch(() => { onState('unavailable'); });
    return queue;
  };
  return {
    update(nextWanted: boolean, nextForeground: boolean) { wanted = nextWanted; foreground = nextForeground; return reconcile(); },
    dispose() { disposed = true; wanted = false; return reconcile(); },
  };
}
