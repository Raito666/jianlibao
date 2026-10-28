import { describe, expect, it } from 'vitest';
import { createInstallController, detectInstallPlatform, isEmbeddedBrowser } from '../../src/pwa/install';

function fixture(options: { ua?: string; platform?: string; touch?: number; standalone?: boolean; secure?: boolean; legacy?: boolean } = {}) {
  const events = new EventTarget();
  let change: (() => void) | undefined;
  const media = { matches: false, ...(options.legacy ? { addListener: (fn: () => void) => { change = fn; }, removeListener: () => { change = undefined; } } : { addEventListener: (_: string, fn: () => void) => { change = fn; }, removeEventListener: () => { change = undefined; } }) };
  const controller = createInstallController({ events, media, secure: options.secure ?? true, navigator: { userAgent: options.ua ?? 'Android Chrome/130', platform: options.platform ?? '', maxTouchPoints: options.touch ?? 0, standalone: options.standalone } });
  return { events, media, controller, change: () => change?.() };
}
function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted', fail = false) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  let calls = 0;
  Object.assign(event, { prompt: async () => { calls++; if (fail) throw new Error('platform failure'); }, userChoice: Promise.resolve({ outcome, platform: 'web' }) });
  return { event, calls: () => calls };
}

describe('PWA installation', () => {
  it('detects iPhone, desktop-UA iPad, Android and desktop', () => {
    expect(detectInstallPlatform({ userAgent: 'iPhone', platform: '', maxTouchPoints: 0 })).toBe('ios');
    expect(detectInstallPlatform({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios');
    expect(detectInstallPlatform({ userAgent: 'Android', platform: '', maxTouchPoints: 5 })).toBe('android');
    expect(detectInstallPlatform({ userAgent: 'Windows', platform: 'Win32', maxTouchPoints: 0 })).toBe('other');
  });
  it('identifies embedded browsers without blocking ordinary Chrome', () => {
    for (const ua of ['iPhone MicroMessenger', 'Android; wv)', 'Android QQ/9', 'iPhone FBAN']) expect(isEmbeddedBrowser(ua)).toBe(true);
    expect(isEmbeddedBrowser('Android Chrome/130 Safari/537.36')).toBe(false);
  });
  it('captures an early install event and notifies late subscribers', () => {
    const { controller, events } = fixture(); const { event } = promptEvent(); events.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(controller.getSnapshot().available).toBe(true);
    let updates = 0; const off = controller.subscribe(() => updates++); events.dispatchEvent(new Event('appinstalled'));
    expect(updates).toBe(1); expect(controller.getSnapshot().installed).toBe(true); off(); controller.dispose();
  });
  it('accepted prompt waits for actual appinstalled confirmation', async () => {
    const { controller, events } = fixture(); const prompt = promptEvent(); events.dispatchEvent(prompt.event);
    await controller.install(); expect(prompt.calls()).toBe(1);
    expect(controller.getSnapshot()).toMatchObject({ installed: false, available: false, installing: false });
    expect(controller.getSnapshot().message).toContain('系统'); events.dispatchEvent(new Event('appinstalled'));
    expect(controller.getSnapshot().installed).toBe(true); controller.dispose();
  });
  it('dismissal and failure remain uninstalled and allow a later new prompt', async () => {
    for (const fail of [false, true]) {
      const { controller, events } = fixture(); events.dispatchEvent(promptEvent('dismissed', fail).event);
      await controller.install(); expect(controller.getSnapshot()).toMatchObject({ installed: false, available: false, installing: false });
      expect(controller.getSnapshot().message.length).toBeGreaterThan(0);
      events.dispatchEvent(promptEvent().event); expect(controller.getSnapshot().available).toBe(true); controller.dispose();
    }
  });
  it('concurrent install clicks consume the platform event once', async () => {
    const { controller, events } = fixture(); const prompt = promptEvent(); events.dispatchEvent(prompt.event);
    await Promise.all([controller.install(), controller.install()]); expect(prompt.calls()).toBe(1); controller.dispose();
  });
  it('does not swallow system prompts in embedded or insecure contexts', async () => {
    for (const options of [{ secure: false }, { ua: 'Android MicroMessenger' }]) {
      const { controller, events } = fixture(options); const prompt = promptEvent(); events.dispatchEvent(prompt.event);
      await controller.install(); expect(prompt.calls()).toBe(0); expect(prompt.event.defaultPrevented).toBe(false); controller.dispose();
    }
  });
  it('tracks standalone changes, Safari standalone and legacy media listeners', () => {
    for (const legacy of [true, false]) {
      const { controller, media, change } = fixture({ legacy }); media.matches = true; change();
      expect(controller.getSnapshot().installed).toBe(true); media.matches = false; change();
      expect(controller.getSnapshot().installed).toBe(false); controller.dispose();
    }
    const { controller } = fixture({ standalone: true }); expect(controller.getSnapshot().installed).toBe(true); controller.dispose();
  });
  it('disposed controllers stop observing platform events', () => {
    const { controller, events } = fixture(); controller.dispose(); events.dispatchEvent(promptEvent().event);
    expect(controller.getSnapshot().available).toBe(false);
  });
});
