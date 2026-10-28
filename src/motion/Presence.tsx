import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const ExitContext = createContext(false);
export const useExiting = () => useContext(ExitContext);

/** Retain presentation during exit; the owner's state and writes update immediately. */
export default function Presence({
  children,
  duration = 120,
  interruptKey,
}: {
  children: ReactNode;
  duration?: number;
  interruptKey?: unknown;
}) {
  const [previous, setPrevious] = useState(children);
  const [rendered, setRendered] = useState(children);
  const [previousKey, setPreviousKey] = useState(interruptKey);
  const [generation, setGeneration] = useState(0);
  if (children !== previous) {
    setPrevious(children);
    if (children) {
      setRendered(children);
      if (!previous) setGeneration((value) => value + 1);
    }
  }
  if (interruptKey !== previousKey) {
    setPreviousKey(interruptKey);
    if (!children) setRendered(null);
  }
  const exiting = !children && Boolean(rendered);
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setRendered(null), duration);
    return () => clearTimeout(timer);
  }, [exiting, duration]);
  return rendered ? (
    <ExitContext key={generation} value={exiting}>
      {rendered}
    </ExitContext>
  ) : null;
}
