import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  platform: vi.fn(() => 'ios'),
  haptics: { impact: vi.fn(async () => {}), notification: vi.fn(async () => {}), selectionStart: vi.fn(async () => {}), selectionChanged: vi.fn(async () => {}), selectionEnd: vi.fn(async () => {}) },
  app: { addListener: vi.fn(), getState: vi.fn() },
  registered: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: mocks.platform },
  registerPlugin: (name: string) => { mocks.registered(name); return name === 'Haptics' ? mocks.haptics : name === 'App' ? mocks.app : {}; },
}));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.platform.mockReturnValue('ios'); });
describe('native feedback and activity listener boundary', () => {
  it('does not register native plugins on Web feedback or activity observation', async () => {
    mocks.platform.mockReturnValue('web');
    const api = await import('../../src/platform/native');
    await api.nativeFeedback('success');
    const stop = api.watchNativeActivity(vi.fn()); stop();
    expect(mocks.registered).not.toHaveBeenCalled();
  });
  it('maps impact/success/warning and balances a selection lifecycle', async () => {
    const api = await import('../../src/platform/native');
    await api.nativeFeedback('impact'); await api.nativeFeedback('success'); await api.nativeFeedback('warning'); await api.nativeFeedback('selection');
    expect(mocks.haptics.impact).toHaveBeenCalledWith({ style: 'LIGHT' });
    expect(mocks.haptics.notification.mock.calls.map(x => x[0])).toEqual([{ type: 'SUCCESS' }, { type: 'WARNING' }]);
    expect(mocks.haptics.selectionStart).toHaveBeenCalledTimes(1);
    expect(mocks.haptics.selectionChanged).toHaveBeenCalledTimes(1);
    expect(mocks.haptics.selectionEnd).toHaveBeenCalledTimes(1);
  });
  it('contains haptic rejection and still ends a failed selection', async () => {
    const api = await import('../../src/platform/native');
    mocks.haptics.selectionChanged.mockRejectedValueOnce(new Error('no hardware'));
    await expect(api.nativeFeedback('selection')).resolves.toBeUndefined();
    expect(mocks.haptics.selectionEnd).toHaveBeenCalledTimes(1);
    mocks.haptics.impact.mockRejectedValueOnce(new Error('bridge unavailable'));
    await expect(api.nativeFeedback('impact')).resolves.toBeUndefined();
  });
  it('removes a late listener handle after disposal without reading state', async () => {
    const api = await import('../../src/platform/native');
    let complete!: (handle: { remove: () => Promise<void> }) => void;
    mocks.app.addListener.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const remove = vi.fn(async () => {}), state = vi.fn();
    const stop = api.watchNativeActivity(state);
    await vi.waitFor(() => expect(mocks.app.addListener).toHaveBeenCalled());
    stop(); complete({ remove });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(mocks.app.getState).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
  });
  it('does not let a stale initial state overwrite a newer lifecycle event', async () => {
    const api = await import('../../src/platform/native');
    const remove = vi.fn(async () => {}), state = vi.fn();
    let complete!: (state: { isActive: boolean }) => void;
    mocks.app.addListener.mockResolvedValueOnce({ remove });
    mocks.app.getState.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const stop = api.watchNativeActivity(state);
    await vi.waitFor(() => expect(mocks.app.getState).toHaveBeenCalled());
    mocks.app.addListener.mock.calls[0][1]({ isActive: false });
    complete({ isActive: true });
    await Promise.resolve(); await Promise.resolve();
    expect(state.mock.calls).toEqual([[false]]);
    stop(); expect(remove).toHaveBeenCalledTimes(1);
  });
});
