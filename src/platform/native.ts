import { Capacitor } from '@capacitor/core';
import { createFileExporter } from './export-text';

export const isIos = () => Capacitor.getPlatform() === 'ios';
let runtime: Promise<typeof import('./native-runtime')> | undefined;
export function loadNativeRuntime() {
  runtime ??= import('./native-runtime').catch(error => { runtime = undefined; throw error; });
  return runtime;
}
export type FeedbackKind = 'impact' | 'success' | 'warning' | 'selection';
/** Haptic hardware is not detectable through this API. Visual feedback always remains in the UI. */
export async function nativeFeedback(kind: FeedbackKind) {
  if (!isIos()) return;
  try {
    const { haptics } = await loadNativeRuntime();
    if (kind === 'impact') await haptics.impact({ style: 'LIGHT' as import('@capacitor/haptics').ImpactStyle });
    else if (kind === 'selection') {
      await haptics.selectionStart();
      try { await haptics.selectionChanged(); } finally { await haptics.selectionEnd(); }
    } else await haptics.notification({ type: (kind === 'success' ? 'SUCCESS' : 'WARNING') as import('@capacitor/haptics').NotificationType });
  } catch { /* Unsupported hardware or bridge failures must never block recording. */ }
}

export const exportTextFile = createFileExporter({
  native: isIos,
  load: async () => (await loadNativeRuntime()).files,
  download(file) {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.type }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = file.name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
});

/** Promise-based listener handles may arrive after cleanup; remove those late handles too. */
export function watchNativeActivity(onChange: (active: boolean) => void) {
  let disposed = false;
  let handle: { remove(): Promise<void> } | undefined;
  if (isIos()) void loadNativeRuntime().then(async ({ app }) => {
    let events = 0;
    const subscription = await app.addListener('appStateChange', state => {
      events++; if (!disposed) onChange(state.isActive);
    });
    if (disposed) { await subscription.remove(); return; }
    handle = subscription;
    const version = events;
    const initial = await app.getState();
    if (!disposed && events === version) onChange(initial.isActive);
  }).catch(() => { /* document visibility remains the fallback. */ });
  return () => { disposed = true; if (handle) void handle.remove().catch(() => {}); };
}
