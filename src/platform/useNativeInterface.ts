import { useEffect } from 'react';
import { isIos, nativeFeedback } from './native';

/** Feedback is independent from domain mutations, and never awaits or intercepts an action. */
export function useNativeInterface() {
  useEffect(() => {
    if (!isIos()) return;
    const click = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null;
      if (!button || button.disabled) return;
      if (button.classList.contains('btn-danger')) void nativeFeedback('warning');
      else if (button.dataset.haptic === 'selection') void nativeFeedback('selection');
    };
    const change = (event: Event) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'checkbox' && !event.target.disabled) void nativeFeedback('selection');
    };
    document.addEventListener('click', click);
    document.addEventListener('change', change);
    return () => { document.removeEventListener('click', click); document.removeEventListener('change', change); };
  }, []);
}
