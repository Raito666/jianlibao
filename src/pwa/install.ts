export type InstallPlatform = 'ios' | 'android' | 'other';
type Device = { userAgent: string; platform: string; maxTouchPoints: number; standalone?: boolean };
type Media = {
  matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};
type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export type InstallSnapshot = {
  platform: InstallPlatform; embedded: boolean; installed: boolean;
  available: boolean; installing: boolean; message: string;
};

export function detectInstallPlatform(device: Device): InstallPlatform {
  if (/iPad|iPhone|iPod/i.test(device.userAgent) || (device.platform === 'MacIntel' && device.maxTouchPoints > 1)) return 'ios';
  return /Android/i.test(device.userAgent) ? 'android' : 'other';
}
export function isEmbeddedBrowser(ua: string) {
  return /MicroMessenger|FBAN|FBAV|DingTalk|Weibo|\bQQ\/|; wv\)/i.test(ua);
}

/** Browser installation state only. Never stored in AppData, a backup, or sync. */
export function createInstallController(host: { events: EventTarget; media: Media; navigator: Device; secure: boolean }) {
  const { events, media, navigator: device } = host;
  let state: InstallSnapshot = {
    platform: detectInstallPlatform(device), embedded: isEmbeddedBrowser(device.userAgent),
    installed: media.matches || device.standalone === true, available: false, installing: false, message: '',
  };
  let pending: InstallPrompt | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<InstallSnapshot>) => {
    if (disposed) return;
    state = { ...state, ...patch }; listeners.forEach(listener => listener());
  };
  const beforeInstall = (event: Event) => {
    const candidate = event as Partial<InstallPrompt>;
    if (!host.secure || state.embedded || state.installed || state.installing || typeof candidate.prompt !== 'function' || typeof candidate.userChoice?.then !== 'function') return;
    event.preventDefault(); pending = event as InstallPrompt; update({ available: true, message: '' });
  };
  const installed = () => { pending = undefined; update({ installed: true, available: false, message: '' }); };
  const displayChanged = () => {
    const installed = media.matches || device.standalone === true;
    if (installed) pending = undefined;
    update({ installed, available: installed ? false : !!pending, message: '' });
  };
  events.addEventListener('beforeinstallprompt', beforeInstall);
  events.addEventListener('appinstalled', installed);
  if (media.addEventListener) media.addEventListener('change', displayChanged);
  else media.addListener?.(displayChanged);
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async install() {
      if (!pending || state.installing || disposed) return;
      const prompt = pending; pending = undefined; update({ available: false, installing: true, message: '' });
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (!state.installed) update({ message: outcome === 'accepted' ? '请按系统提示完成安装，再从桌面打开。' : '已取消安装，仍可继续使用网页版。' });
      } catch {
        if (!state.installed) update({ message: '系统安装未完成，请按下方步骤从浏览器菜单添加。' });
      } finally { update({ installing: false }); }
    },
    dispose() {
      disposed = true; pending = undefined; listeners.clear();
      events.removeEventListener('beforeinstallprompt', beforeInstall); events.removeEventListener('appinstalled', installed);
      if (media.removeEventListener) media.removeEventListener('change', displayChanged);
      else media.removeListener?.(displayChanged);
    },
  };
}

let browserController: ReturnType<typeof createInstallController> | undefined;
export function getInstallController() {
  return browserController ??= createInstallController({
    events: window, media: window.matchMedia('(display-mode: standalone)'),
    navigator, secure: window.isSecureContext,
  });
}
