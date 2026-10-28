import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isIos } from '../platform/native';
import { getPwaRuntime } from '../pwa/runtime';
import { readStorageInfo, requestStorageProtection, type StorageInfo } from '../pwa/storage';
import Icon from '../components/Icon';

export function PwaUpdateNotice() {
  const runtime = getPwaRuntime(), state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  if (isIos() || !state.waiting) return null;
  return <aside className="pwa-update-notice" aria-label="应用更新" aria-live="polite">
    <Icon name="download" size={18} /><div><strong>新版本已准备</strong><p>当前训练不受影响。保存完成后，关闭所有健力宝窗口再打开即可更新。</p></div>
  </aside>;
}

export default function AppReadiness() {
  const runtime = getPwaRuntime(), state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const [storage, setStorage] = useState<StorageInfo>({ persisted: null, usage: null, quota: null });
  const [protecting, setProtecting] = useState(false), [feedback, setFeedback] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const check = () => { void readStorageInfo(navigator.storage).then(value => { if (alive.current) setStorage(value); }); };
    check(); window.addEventListener('focus', check);
    if (runtime.getSnapshot().phase !== 'failed' && runtime.getSnapshot().busy === 'idle') void runtime.refresh();
    return () => { alive.current = false; window.removeEventListener('focus', check); };
  }, [runtime]);
  if (isIos()) return null;
  const title = { preparing: '正在准备离线页面', ready: '离线启动已就绪', incomplete: '离线页面尚未完整', unconfirmed: '离线状态尚未确认', unsupported: '当前环境未启用离线服务', failed: '离线准备未完成' }[state.phase];
  async function protect() {
    if (protecting) return;
    setProtecting(true); setFeedback('');
    try {
      const result = await requestStorageProtection(navigator.storage);
      if (!alive.current) return;
      setFeedback({ granted: '浏览器已批准存储保护，请仍定期导出备份。', denied: '浏览器暂未批准，记录仍可保存；请定期导出备份。', unsupported: '当前浏览器不支持申请存储保护，请使用导出备份。', failed: '存储保护申请未完成，可重试；本机记录没有改动。' }[result]);
      const next = await readStorageInfo(navigator.storage);
      if (alive.current) setStorage(next);
    } finally { if (alive.current) setProtecting(false); }
  }
  return <section className="card pwa-readiness" aria-labelledby="pwa-readiness-title">
    <h2 id="pwa-readiness-title">应用与离线</h2>
    <div className={`pwa-health-row${state.phase === 'ready' ? ' is-ready' : ''}`}><Icon name={state.phase === 'ready' ? 'check' : 'wifi'} /><strong>{title}</strong></div>
    <p className="muted">{state.phase === 'ready' ? '训练记录与文字讲解可离线打开。图解和视频以实际保存情况为准。' : '离线启动需先准备页面资源。已有本机记录仍保留，请勿清除网站数据。'}</p>
    <div className="data-actions pwa-actions">
      <button className="btn btn-secondary" disabled={state.busy !== 'idle' || state.phase === 'unsupported'} onClick={() => { void runtime.refresh(); }}>检查离线状态</button>
      {state.phase !== 'ready' && <button className="btn btn-primary" disabled={state.busy !== 'idle' || state.phase === 'unsupported'} onClick={() => { void runtime.prepareOffline(); }}>{state.busy === 'preparing' ? '正在准备…' : '准备离线页面'}</button>}
      <a className="btn btn-secondary" href="#/exercises?offline=1">管理离线图解</a>
    </div>
    <div className="pwa-settings-section">
      <div className="pwa-setting-heading"><h3>版本更新</h3><span className="tag">{state.waiting ? '等待启用' : state.online ? '已连接网络' : '当前离线'}</span></div>
      <p className="muted">{state.waiting ? '新版本已下载。保存完成后关闭所有窗口，再从桌面打开；不会自动打断训练。' : '新版本会在后台准备，当前训练不会自动刷新。'}</p>
      <button className="btn btn-secondary" disabled={state.busy !== 'idle' || state.phase === 'unsupported'} onClick={() => { void runtime.checkUpdate(); }}>{state.busy === 'checking' ? '正在检查…' : '检查更新'}</button>
      {state.error && <p role="alert" className="error-text pwa-feedback">{state.error}</p>}
      {state.message && <p className="pwa-feedback">{state.message}</p>}
    </div>
    <div className="pwa-settings-section">
      <h3>浏览器存储保护</h3>
      <p className="muted">{storage.persisted === true ? '浏览器已批准持久存储，可降低自动回收风险。' : '可申请减少系统自动回收本地记录的可能。'}这不是云备份，也不能防止手动清除数据。</p>
      {storage.usage !== null && <p className="muted pwa-storage-size">本机占用约 {(storage.usage / 1_000_000).toFixed(1)} MB{storage.quota !== null ? ` · 浏览器额度约 ${(storage.quota / 1_000_000_000).toFixed(1)} GB` : ''}。容量为估算值。</p>}
      <button className="btn btn-secondary" disabled={protecting} onClick={() => { void protect(); }}>{protecting ? '正在申请…' : '申请持久存储'}</button>
      <p className="pwa-feedback" role="status">{feedback}</p>
    </div>
  </section>;
}
