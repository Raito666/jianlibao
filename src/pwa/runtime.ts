export type ShellProof = { type: 'jianlibao-shell-status'; version: 1; cache: string; ready: boolean; cached: number; total: number };
export function validShellProof(value: unknown): value is ShellProof {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<ShellProof>;
  return p.type === 'jianlibao-shell-status' && p.version === 1 && typeof p.cache === 'string' && /^jianlibao-[a-f0-9]{16}(?:-[\w-]+)?$/.test(p.cache)
    && typeof p.ready === 'boolean' && Number.isInteger(p.total) && p.total! > 0 && Number.isInteger(p.cached) && p.cached! >= 0 && p.cached! <= p.total! && (!p.ready || p.cached === p.total);
}
export type RuntimeState = {
  phase: 'preparing' | 'ready' | 'unconfirmed' | 'incomplete' | 'unsupported' | 'failed';
  online: boolean; waiting: boolean; busy: 'idle' | 'checking' | 'preparing'; error: string; message: string;
};
type Operation = 'status' | 'prepare';
export function askWorker(worker: ServiceWorker, operation: Operation, timeoutMs = operation === 'prepare' ? 20000 : 3000): Promise<unknown> {
  if (typeof MessageChannel === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const channel = new MessageChannel(); let finished = false;
    const finish = (value: unknown) => { if (finished) return; finished = true; clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = event => finish(event.data);
    channel.port1.onmessageerror = () => finish(null);
    try { worker.postMessage({ type: operation === 'prepare' ? 'jianlibao-shell-prepare' : 'jianlibao-shell-status' }, [channel.port2]); }
    catch { finish(null); }
  });
}
function deadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('timeout')), timeoutMs);
    operation.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
/** Public shell lifecycle only. No AppData, credentials, cloud APIs or forced updates. */
export function createRuntimeController(host: { sw?: ServiceWorkerContainer; events: EventTarget; online: () => boolean; ping?: typeof askWorker }) {
  const { sw, events } = host, ping = host.ping ?? askWorker;
  let state: RuntimeState = { phase: sw ? 'preparing' : 'unsupported', online: host.online(), waiting: false, busy: 'idle', error: '', message: '' };
  let disposed = false, epoch = 0, registration: ServiceWorkerRegistration | undefined, registrationTask: Promise<void> | undefined;
  const subscribers = new Set<() => void>(), cleanups: Array<() => void> = [];
  const set = (patch: Partial<RuntimeState>) => { if (disposed) return; state = { ...state, ...patch }; subscribers.forEach(fn => fn()); };
  const listen = (target: EventTarget, type: string, fn: EventListener) => { target.addEventListener(type, fn); cleanups.push(() => target.removeEventListener(type, fn)); };
  const watch = (next: ServiceWorkerRegistration) => {
    if (registration === next) return;
    registration = next;
    const installing = () => {
      if (disposed || registration !== next) return;
      const worker = next.installing;
      if (worker) {
        let previousState = worker.state;
        listen(worker, 'statechange', () => {
          if (disposed || registration !== next) return;
          const previous = previousState; previousState = worker.state;
          set({ waiting: !!next.waiting });
          if (worker.state === 'activated') void refresh();
          if (worker.state === 'redundant' && (previous === 'installing' || previous === 'activating') && !next.waiting) {
            if (!next.active && !sw?.controller) {
              epoch++;
              set({ phase: 'failed', error: '离线页面准备失败，联网后可重试；本机记录不受影响。' });
            } else set({ error: '新版本离线准备未完成，可稍后重试；当前版本仍可使用。' });
          }
        });
      }
    };
    listen(next, 'updatefound', installing); installing();
  };
  async function refresh(operation: Operation = 'status') {
    if (!sw || disposed) return;
    const version = ++epoch;
    try {
      const current = await sw.getRegistration(); if (version !== epoch || disposed) return;
      if (!current) { registration = undefined; set({ waiting: false, phase: 'unconfirmed' }); return; }
      if (current) watch(current);
      set({ waiting: !!current?.waiting });
      const worker = sw.controller ?? current?.active;
      if (!worker) { set({ phase: current?.installing ? 'preparing' : 'unconfirmed' }); return; }
      const response = await ping(worker, operation);
      const latest = await sw.getRegistration();
      if (version !== epoch || disposed) return;
      if (!latest) { registration = undefined; set({ waiting: false, phase: 'unconfirmed' }); return; }
      if (worker !== (sw.controller ?? latest.active)) return;
      const phase = validShellProof(response) ? response.ready ? 'ready' : 'incomplete' : 'unconfirmed';
      set({ phase, ...(phase === 'ready' && state.phase === 'failed' ? { error: '' } : {}) });
    } catch { if (version === epoch) set({ phase: 'unconfirmed' }); }
  }
  async function register() {
    if (!sw || disposed) return;
    if (registrationTask) return registrationTask;
    set({ error: '' });
    registrationTask = (async () => {
      try {
        const existing = await sw.getRegistration();
        const next = !host.online() && existing ? existing : await deadline(sw.register('/sw.js'), 15000);
        if (disposed) return; watch(next); await refresh();
      } catch { set({ phase: 'failed', error: '离线页面准备失败，联网后可重试；本机记录不受影响。' }); }
      finally { registrationTask = undefined; }
    })();
    return registrationTask;
  }
  async function run(operation: 'update' | 'prepare') {
    if (!sw || disposed || state.busy !== 'idle') return;
    if (!host.online()) { set({ online: false, message: '当前离线，可继续训练；联网后再准备或检查更新。' }); return; }
    set({ busy: operation === 'update' ? 'checking' : 'preparing', error: '', message: '' });
    try {
      if (!registration || state.phase === 'failed' || !await sw.getRegistration()) await register();
      if (!registration) throw Error('registration');
      if (operation === 'update') {
        await deadline(registration.update(), 10000); await refresh();
        set({ message: state.waiting ? '新版本已准备。保存完成后，关闭所有健力宝窗口再打开即可使用。' : '检查完成，暂未发现等待启用的新版本。' });
      } else {
        if (!sw.controller) await deadline(sw.ready, 15000);
        await refresh('prepare');
        if (state.phase !== 'ready') throw Error('shell not ready');
        set({ message: '离线启动检查通过，训练记录与文字讲解可离线打开。' });
      }
    } catch { set({ error: operation === 'update' ? '暂时无法完成更新检查，请确认网络后重试；当前版本仍可使用。' : '离线页面尚未准备完整，请联网重试；已有记录和素材不会被清除。' }); }
    finally { set({ busy: 'idle' }); }
  }
  const connection = () => { const online = host.online(); set({ online }); if (online && state.busy === 'idle') { if (state.phase === 'failed') void register(); else void refresh(); } };
  listen(events, 'online', connection); listen(events, 'offline', connection);
  listen(events, 'focus', () => { if (state.busy === 'idle') void refresh(); });
  if (sw) listen(sw, 'controllerchange', () => { void refresh(); });
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
    register, refresh: () => refresh(), checkUpdate: () => run('update'), prepareOffline: () => run('prepare'),
    dispose() { disposed = true; epoch++; cleanups.forEach(fn => fn()); subscribers.clear(); },
  };
}
let browserRuntime: ReturnType<typeof createRuntimeController> | undefined;
export function getPwaRuntime() {
  return browserRuntime ??= createRuntimeController({ sw: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined, events: window, online: () => navigator.onLine });
}
