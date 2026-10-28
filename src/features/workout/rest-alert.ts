import type { Session } from '../../domain/types';

type RestSource = Pick<Session, 'id' | 'status' | 'restUntil'>;

/** Only deadlines seen in the future may alert; persisted overdue rests stay quiet. */
export function createRestDeadlineWatcher(onComplete: (sessionId: string, restUntil: number) => void) {
  let observed: { sessionId: string; restUntil: number; delivered: boolean } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const clearTimer = () => { clearTimeout(timer); timer = undefined; };
  const check = () => {
    clearTimer();
    if (disposed || !observed || observed.delivered) return;
    const remaining = observed.restUntil - Date.now();
    if (remaining > 0) {
      timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
      return;
    }
    observed.delivered = true;
    onComplete(observed.sessionId, observed.restUntil);
  };
  return {
    update(session: RestSource | undefined, writable: boolean) {
      if (disposed) return;
      if (!writable || session?.status !== 'active' || session.restUntil === null || !Number.isFinite(session.restUntil)) {
        clearTimer(); observed = null; return;
      }
      if (observed?.sessionId === session.id && observed.restUntil === session.restUntil) { check(); return; }
      clearTimer();
      observed = session.restUntil > Date.now()
        ? { sessionId: session.id, restUntil: session.restUntil, delivered: false }
        : null;
      check();
    },
    check,
    dispose() { disposed = true; clearTimer(); observed = null; },
  };
}

/** Audio is unlocked by a trusted gesture; timer callbacks only use a running context. */
export function createRestAlertController(onAudioReady: (ready: boolean) => void = () => {}) {
  let context: AudioContext | null = null;
  let warmed = false;
  let disposed = false;
  let unlocking: Promise<void> | null = null;
  let preferences = { sound: true, vibration: true };
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  const vibrationSupported = typeof nav?.vibrate === 'function';
  const nodes = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  const reportReady = () => { if (!disposed) onAudioReady(context?.state === 'running' && warmed); };
  const release = (node: { oscillator: OscillatorNode; gain: GainNode }, stop = false) => {
    if (!nodes.delete(node)) return;
    node.oscillator.onended = null;
    if (stop) { try { node.oscillator.stop(); } catch { /* Already stopped. */ } }
    try { node.oscillator.disconnect(); } catch { /* Device may have gone away. */ }
    try { node.gain.disconnect(); } catch { /* Device may have gone away. */ }
  };
  const tone = (silent: boolean) => {
    if (!context || context.state !== 'running') return false;
    let gain: GainNode | undefined;
    let oscillator: OscillatorNode | undefined;
    let node: { oscillator: OscillatorNode; gain: GainNode } | undefined;
    try {
      gain = context.createGain();
      oscillator = context.createOscillator();
      node = { oscillator, gain };
      nodes.add(node);
      const playing = node;
      oscillator.onended = () => release(playing);
      oscillator.type = 'sine';
      const now = context.currentTime;
      gain.gain.setValueAtTime(0, now);
      if (!silent) {
        oscillator.frequency.setValueAtTime(880, now);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.015);
        gain.gain.linearRampToValueAtTime(0, now + 0.22);
      }
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(now); oscillator.stop(now + (silent ? 0.01 : 0.24));
      return true;
    } catch {
      if (node) release(node, true);
      else {
        try { oscillator?.disconnect(); } catch { /* Partial initialization. */ }
        try { gain?.disconnect(); } catch { /* Partial initialization. */ }
      }
      return false;
    }
  };
  const unlockAudio = async () => {
    if (disposed || !preferences.sound) return;
    if (context?.state === 'running' && warmed) { reportReady(); return; }
    if (unlocking) return unlocking;
    try {
      const Constructor = globalThis.AudioContext
        ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) return;
      if (!context) {
        context = new Constructor();
        context.addEventListener('statechange', reportReady);
      }
      const audio = context;
      const resumed = audio.state === 'running' ? Promise.resolve() : audio.resume();
      unlocking = Promise.resolve(resumed).then(() => {
        if (disposed || context !== audio) return;
        if (audio.state === 'running' && !warmed) warmed = tone(true);
        reportReady();
      }).catch(() => { if (!disposed) onAudioReady(false); }).finally(() => { unlocking = null; });
      await unlocking;
    } catch { if (!disposed) onAudioReady(false); }
  };
  const play = () => {
    if (disposed) return;
    if (preferences.sound && warmed && !tone(false)) { warmed = false; reportReady(); }
    if (preferences.vibration && vibrationSupported) {
      try { nav!.vibrate([120, 60, 120]); } catch { /* Support does not guarantee permission or hardware. */ }
    }
  };
  return {
    vibrationSupported,
    unlockAudio,
    play,
    async testAlert() { await unlockAudio(); play(); },
    setPreferences(next: { sound: boolean; vibration: boolean }) {
      preferences = { ...next };
      if (!next.sound) for (const node of nodes) release(node, true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const node of nodes) release(node, true);
      const audio = context; context = null;
      if (audio) {
        audio.removeEventListener('statechange', reportReady);
        try { void Promise.resolve(audio.close()).catch(() => {}); } catch { /* Already closed or denied. */ }
      }
    },
  };
}
