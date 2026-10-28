import { useEffect, useRef } from 'react';
import { spring } from '../motion/spring';
import Icon from './Icon';

export default function CompletionMark({ completed }: { completed: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(completed);
  useEffect(() => {
    if (previous.current === completed) return;
    previous.current = completed;
    const element = ref.current;
    if (!element) return;
    const cancel = spring({
      from: 0.94,
      to: 1,
      stiffness: 500,
      damping: 40,
      maxDuration: 120,
      onUpdate: (value) => {
        element.style.transform = `scale(${Math.max(0.94, Math.min(1.04, value))})`;
      },
      onComplete: () => {
        element.style.transform = '';
      },
    });
    return () => {
      cancel();
      element.style.transform = '';
    };
  }, [completed]);
  return (
    <span ref={ref} className="completion-mark" aria-hidden="true">
      <Icon name={completed ? 'check' : 'plus'} />
    </span>
  );
}
