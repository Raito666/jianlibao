import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppData } from '../domain/types';
import { createRepository, StoreConflictError } from '../data';
import { validateAppData } from '../data/backup';

// Preserve the original document-lifetime connection across StrictMode effect replay and pending saves.
const repository = createRepository();

export function useWorkspace() {
  const [data, setData] = useState<AppData | null>(null);
  const [status, setStatus] = useState<'loading' | 'saved' | 'saving' | 'error' | 'conflict'>('loading');
  const [error, setError] = useState('');
  const [writable, setWritable] = useState(false);
  const [savedAt, setSavedAt] = useState('');
  const current = useRef<AppData | null>(null);
  const persistedRevision = useRef(0);
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const blocked = useRef(false);
  const dirty = useRef(false);
  const owner = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const release = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const lastLoaded = useRef(0);
  const mutationEpoch = useRef(0);

  const reload = useCallback(async (discardUnsaved = true) => {
    const epoch = mutationEpoch.current;
    await queue.current;
    if (!discardUnsaved && (dirty.current || pending.current)) return false;
    try {
      const next = await repository.load();
      if (!discardUnsaved && (epoch !== mutationEpoch.current || dirty.current || pending.current)) return false;
      if (!discardUnsaved && current.current && next.revision === persistedRevision.current) return true;
      current.current = next; persistedRevision.current = next.revision;
      blocked.current = false; dirty.current = false;
      setData(next); setError(''); setStatus('saved'); lastLoaded.current++;
      return true;
    } catch (e) { setError(String(e instanceof Error ? e.message : e)); setStatus('error'); return false; }
  }, []);

  const acquire = useCallback((wait: boolean) => {
    if (!navigator.locks) { owner.current = true; setWritable(true); return; }
    void navigator.locks.request('jianlibao-editor', wait ? {} : { ifAvailable: true }, async lock => {
      if (!lock || !alive.current) return;
      await reload(false);
      if (!alive.current) return;
      owner.current = true; setWritable(true);
      await new Promise<void>(resolve => { release.current = resolve; });
      owner.current = false; if (alive.current) setWritable(false);
    });
  }, [reload]);

  useEffect(() => {
    alive.current = true;
    void reload(false); acquire(false);
    const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('jianlibao-changes') : null;
    channel.current = bc;
    const receive = async (e: MessageEvent) => {
      if (e.data?.type === 'takeover' && owner.current) {
        owner.current = false; setWritable(false);
        await queue.current; release.current?.(); release.current = null;
      }
      if (e.data?.type === 'saved' && !dirty.current && pending.current === 0) await reload(false);
    };
    bc?.addEventListener('message', receive);
    const focus = () => { if (!dirty.current && pending.current === 0) void reload(false); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current || pending.current) { event.preventDefault(); }
    };
    window.addEventListener('focus', focus); window.addEventListener('beforeunload', beforeUnload);
    return () => { alive.current = false; release.current?.(); bc?.close(); window.removeEventListener('focus', focus); window.removeEventListener('beforeunload', beforeUnload); };
  }, [acquire, reload]);

  const persist = useCallback((snapshot: AppData) => {
    pending.current++;
    queue.current = queue.current.then(async () => {
      if (blocked.current) return;
      try {
        const saved = await repository.save(snapshot, persistedRevision.current);
        persistedRevision.current = saved.revision;
        if (current.current) { current.current = { ...current.current, revision: saved.revision }; setData(current.current); }
        channel.current?.postMessage({ type: 'saved', revision: saved.revision });
        setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch (e) {
        blocked.current = true;
        setError(e instanceof Error ? e.message : '本地写入失败');
        setStatus(e instanceof StoreConflictError ? 'conflict' : 'error');
      }
    }).finally(() => {
      pending.current--;
      if (!pending.current && !blocked.current) { dirty.current = false; setStatus('saved'); setError(''); }
    });
    return queue.current.then(() => !blocked.current);
  }, []);

  const mutate = useCallback((fn: (latest: AppData) => AppData) => {
    if (!current.current || !owner.current) return Promise.resolve(false);
    try {
      const next = validateAppData(fn(current.current));
      current.current = next; dirty.current = true; mutationEpoch.current++; setData(next);
      if (!blocked.current) setStatus('saving');
      return persist(structuredClone(next));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return Promise.resolve(false); }
  }, [persist]);

  const retry = useCallback(async () => {
    if (!current.current || !owner.current) return false;
    await queue.current;
    blocked.current = false; setStatus('saving');
    return persist(structuredClone(current.current));
  }, [persist]);

  const takeover = useCallback(async () => {
    channel.current?.postMessage({ type: 'takeover' });
    acquire(true);
  }, [acquire]);

  return { data, status, error, writable, savedAt, mutate, retry, reload, takeover, dirty: dirty.current, loadEpoch: lastLoaded.current };
}
