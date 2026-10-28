import { describe, expect, it, vi } from 'vitest';
import { createRuntimeController, validShellProof } from '../../src/pwa/runtime';
const proof = (ready = true) => ({ type: 'jianlibao-shell-status', version: 1, cache: 'jianlibao-0123456789abcdef', ready, total: 13, cached: ready ? 13 : 12 });
function setup(options: { supported?: boolean; online?: boolean; registerFails?: boolean } = {}) {
  let online = options.online ?? true;
  const events = new EventTarget(), worker = Object.assign(new EventTarget(), { state: 'activated', postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), { active: worker, waiting: null as unknown, installing: null as unknown, update: vi.fn(async () => {}) });
  const sw = Object.assign(new EventTarget(), { controller: worker, getRegistration: vi.fn(async () => registration), register: vi.fn(async () => { if (options.registerFails) throw Error('blocked'); return registration; }) });
  const ping = vi.fn(async () => proof());
  const controller = createRuntimeController({ sw: options.supported === false ? undefined : sw as unknown as ServiceWorkerContainer, events, online: () => online, ping });
  return { controller, sw, registration, worker, events, ping, connection(value: boolean) { online = value; events.dispatchEvent(new Event(value ? 'online' : 'offline')); } };
}
describe('PWA runtime', () => {
  it('requires complete typed proof instead of trusting a controller or malformed response', () => {
    expect(validShellProof(proof())).toBe(true); expect(validShellProof(proof(false))).toBe(true);
    for (const invalid of [null, {}, { ...proof(), ready: 'yes' }, { ...proof(), total: 0 }, { ...proof(), cached: 12 }, { ...proof(), cached: 14 }, { ...proof(), version: true }, { ...proof(), cache: 'jianlibao-media-1' }]) expect(validShellProof(invalid)).toBe(false);
  });
  it('registers the fixed local worker and confirms actual shell cache readiness', async () => {
    const { controller, sw } = setup(); await controller.register();
    expect(sw.register).toHaveBeenCalledWith('/sw.js'); expect(controller.getSnapshot().phase).toBe('ready'); controller.dispose();
  });
  it('registration failure is visible and recoverable', async () => {
    const { controller, sw } = setup({ registerFails: true }); await controller.register(); expect(controller.getSnapshot().phase).toBe('failed');
    sw.register.mockResolvedValueOnce(await sw.getRegistration()); await controller.register(); expect(controller.getSnapshot().phase).toBe('ready'); expect(controller.getSnapshot().error).toBe(''); controller.dispose();
  });
  it('unsupported environment and older non-answering workers never claim offline readiness', async () => {
    const unsupported = setup({ supported: false }); await unsupported.controller.register(); expect(unsupported.controller.getSnapshot().phase).toBe('unsupported'); unsupported.controller.dispose();
    const { controller, ping } = setup(); ping.mockResolvedValueOnce(undefined as unknown as ReturnType<typeof proof>); await controller.register(); expect(controller.getSnapshot().phase).toBe('unconfirmed'); controller.dispose();
  });
  it('cache eviction reports incomplete and explicit repair can restore it', async () => {
    const { controller, ping } = setup(); await controller.register();
    ping.mockResolvedValueOnce(proof(false)); await controller.refresh(); expect(controller.getSnapshot().phase).toBe('incomplete');
    await controller.prepareOffline(); expect(ping.mock.calls.at(-1)?.[1]).toBe('prepare'); expect(controller.getSnapshot().phase).toBe('ready'); controller.dispose();
  });
  it('waiting updates are observed without activating or reloading', async () => {
    const { controller, registration, worker } = setup(); await controller.register();
    registration.waiting = { state: 'installed' }; await controller.checkUpdate();
    expect(controller.getSnapshot().waiting).toBe(true); expect(worker.postMessage).not.toHaveBeenCalled(); controller.dispose();
  });
  it('offline update and repair do not make requests or erase cached readiness', async () => {
    const { controller, registration, ping, connection } = setup(); await controller.register(); connection(false);
    const count = ping.mock.calls.length; await controller.checkUpdate(); await controller.prepareOffline();
    expect(registration.update).not.toHaveBeenCalled(); expect(ping.mock.calls.length).toBe(count); expect(controller.getSnapshot().online).toBe(false); expect(controller.getSnapshot().phase).toBe('ready'); controller.dispose();
  });
  it('duplicate update clicks share one operation', async () => {
    const { controller, registration } = setup(); await controller.register();
    await Promise.all([controller.checkUpdate(), controller.checkUpdate()]); expect(registration.update).toHaveBeenCalledTimes(1); expect(controller.getSnapshot().busy).toBe('idle'); controller.dispose();
  });
  it('update errors retain offline readiness and provide retry feedback', async () => {
    const { controller, registration } = setup(); await controller.register(); registration.update.mockRejectedValueOnce(Error('network'));
    await controller.checkUpdate(); expect(controller.getSnapshot().phase).toBe('ready'); expect(controller.getSnapshot().error).not.toBe('');
    await controller.checkUpdate(); expect(controller.getSnapshot().error).toBe(''); controller.dispose();
  });
  it('a late response from a previous controller cannot replace current readiness', async () => {
    const { controller, ping, sw } = setup(); await controller.register(); let finish!: (value: ReturnType<typeof proof>) => void;
    ping.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const old = controller.refresh();
    await vi.waitFor(() => expect(ping).toHaveBeenCalledTimes(2));
    sw.controller = Object.assign(new EventTarget(), { state: 'activated', postMessage: vi.fn() });
    ping.mockResolvedValueOnce(proof(false)); await controller.refresh(); finish(proof()); await old;
    expect(controller.getSnapshot().phase).toBe('incomplete'); controller.dispose();
  });
  it('disposing prevents further event work and subscriber updates', async () => {
    const { controller, events, ping } = setup(); await controller.register(); const listener = vi.fn(); controller.subscribe(listener); const count = ping.mock.calls.length; controller.dispose();
    events.dispatchEvent(new Event('focus')); events.dispatchEvent(new Event('online')); await Promise.resolve(); expect(listener).not.toHaveBeenCalled(); expect(ping.mock.calls.length).toBe(count);
  });
  it('foreground refresh does not supersede an explicit offline preparation', async () => {
    const { controller, ping, events } = setup(); await controller.register(); let finish!: (value: ReturnType<typeof proof>) => void;
    ping.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const pending = controller.prepareOffline();
    await vi.waitFor(() => expect(ping).toHaveBeenCalledTimes(2)); events.dispatchEvent(new Event('focus')); await Promise.resolve();
    expect(ping).toHaveBeenCalledTimes(2); finish(proof()); await pending; expect(controller.getSnapshot().phase).toBe('ready'); controller.dispose();
  });
  it('a hanging update has a deadline and does not block later retries', async () => {
    vi.useFakeTimers(); const { controller, registration } = setup();
    try {
      await controller.register(); registration.update.mockImplementationOnce(() => new Promise(() => {}));
      const pending = controller.checkUpdate(); await vi.advanceTimersByTimeAsync(10001); await pending;
      expect(controller.getSnapshot().busy).toBe('idle'); expect(controller.getSnapshot().error).not.toBe('');
      await controller.checkUpdate(); expect(controller.getSnapshot().error).toBe('');
    } finally { controller.dispose(); vi.useRealTimers(); }
  });
  it('late worker recovery clears a previous registration failure', async () => {
    const { controller } = setup({ registerFails: true }); await controller.register(); expect(controller.getSnapshot().phase).toBe('failed');
    await controller.refresh(); expect(controller.getSnapshot().phase).toBe('ready'); expect(controller.getSnapshot().error).toBe(''); controller.dispose();
  });
  it('a removed registration cannot claim readiness from its still-live controller', async () => {
    const { controller, sw, ping } = setup(); await controller.register();
    sw.getRegistration.mockResolvedValueOnce(undefined as unknown as Awaited<ReturnType<typeof sw.getRegistration>>);
    const count = ping.mock.calls.length; await controller.refresh();
    expect(controller.getSnapshot().phase).toBe('unconfirmed'); expect(ping).toHaveBeenCalledTimes(count);
    await controller.prepareOffline(); expect(controller.getSnapshot().phase).toBe('ready'); controller.dispose();
  });
  it('registration removed while cache proof is pending invalidates the late proof', async () => {
    const { controller, sw, ping } = setup(); await controller.register(); let finish!: (value: ReturnType<typeof proof>) => void;
    ping.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const pending = controller.refresh();
    await vi.waitFor(() => expect(ping).toHaveBeenCalledTimes(2));
    sw.getRegistration.mockResolvedValueOnce(undefined as unknown as Awaited<ReturnType<typeof sw.getRegistration>>);
    finish(proof()); await pending; expect(controller.getSnapshot().phase).toBe('unconfirmed'); controller.dispose();
  });
  it('a failed initial worker installation leaves a visible retryable failure', async () => {
    const { controller, sw, registration } = setup();
    const installing = Object.assign(new EventTarget(), { state: 'installing' });
    registration.installing = installing; registration.active = null as unknown as typeof registration.active; sw.controller = null as unknown as typeof sw.controller;
    await controller.register(); expect(controller.getSnapshot().phase).toBe('preparing');
    registration.installing = null; installing.state = 'redundant'; installing.dispatchEvent(new Event('statechange'));
    expect(controller.getSnapshot().phase).toBe('failed'); expect(controller.getSnapshot().error).not.toBe(''); controller.dispose();
  });
  it('a failed update keeps the verified old shell usable and reports the failure', async () => {
    const { controller, registration } = setup(); await controller.register();
    const installing = Object.assign(new EventTarget(), { state: 'installing' });
    registration.installing = installing; registration.dispatchEvent(new Event('updatefound'));
    registration.installing = null; installing.state = 'redundant'; installing.dispatchEvent(new Event('statechange'));
    expect(controller.getSnapshot().phase).toBe('ready'); expect(controller.getSnapshot().error).toContain('当前版本仍可使用'); controller.dispose();
  });
  it('a newer successful waiting worker can replace an older waiting worker without an error', async () => {
    const { controller, registration } = setup(); await controller.register();
    const older = Object.assign(new EventTarget(), { state: 'installing' });
    registration.installing = older; registration.dispatchEvent(new Event('updatefound'));
    registration.installing = null; registration.waiting = older; older.state = 'installed'; older.dispatchEvent(new Event('statechange'));
    const newer = Object.assign(new EventTarget(), { state: 'installed' }); registration.waiting = newer;
    older.state = 'redundant'; older.dispatchEvent(new Event('statechange'));
    expect(controller.getSnapshot().phase).toBe('ready'); expect(controller.getSnapshot().waiting).toBe(true); expect(controller.getSnapshot().error).toBe(''); controller.dispose();
  });
  it('events from a replaced registration cannot add an error to the current shell', async () => {
    const { controller, registration, sw, worker } = setup(); await controller.register();
    const installing = Object.assign(new EventTarget(), { state: 'installing' }); registration.installing = installing; registration.dispatchEvent(new Event('updatefound'));
    const replacement = Object.assign(new EventTarget(), { active: worker, waiting: null, installing: null, update: vi.fn(async () => {}) });
    sw.getRegistration.mockResolvedValue(replacement); await controller.refresh();
    installing.state = 'redundant'; installing.dispatchEvent(new Event('statechange'));
    expect(controller.getSnapshot().phase).toBe('ready'); expect(controller.getSnapshot().error).toBe(''); controller.dispose();
  });
});
