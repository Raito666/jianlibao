import Presence from '../motion/Presence';
import { useEffect, useRef, useState } from 'react';
import type { AppData } from '../domain/types';
import { exportBackup, mergeImport, parseBackup, previewImport } from '../data/backup';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { exportTextFile, isIos } from '../platform/native';
import BodyMetrics from './BodyMetrics';
import CloudSyncPanel from './CloudSyncPanel';
import InstallApp from './InstallApp';
import AppReadiness from './AppReadiness';
import type { CloudSyncController } from '../sync/useCloudSync';

export function downloadBackup(data: AppData) {
  return exportTextFile({ text: exportBackup(data), name: `健力宝备份-${new Date().toISOString().slice(0, 10)}.json`, type: 'application/json;charset=utf-8' });
}

export default function BackupSettings({
  data,
  mutate,
  writable,
  notify,
  retry,
  cloud,
}: {
  data: AppData;
  mutate: (fn: (d: AppData) => AppData) => Promise<boolean>;
  writable: boolean;
  notify: (message: string) => void;
  retry: () => Promise<boolean>;
  cloud: CloudSyncController;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<AppData | null>(null);
  const [resolution, setResolution] = useState<'keep-local' | 'use-import'>('keep-local');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setConfirmed(false);
  }, [data.revision, incoming]);
  let previewError = '';
  let preview = incoming ? { added: 0, unchanged: 0, conflicts: [] as ReturnType<typeof previewImport>['conflicts'], settingsChanged: false } : null;
  if (incoming) {
    try { preview = previewImport(data, incoming); }
    catch (reason) { previewError = reason instanceof Error ? reason.message : '无法预览，请核对备份'; }
  }
  const settings = (patch: Partial<AppData['settings']>) =>
    void mutate((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  return (
    <>
      <BodyMetrics data={data} writable={writable} mutate={mutate} retry={retry} notify={notify} />
      <div className="settings-grid">
        <InstallApp />
        <AppReadiness />
        <CloudSyncPanel cloud={cloud} writable={writable} />
        <section className="card">
          <h2>按自己的方式练。</h2>
          <label className="setting-row">
            <span>
              <strong>重量单位</strong>
              <small>只改变显示，原始重量始终以 kg 保存</small>
            </span>
            <select
              className="form-select"
              aria-label="重量单位"
              disabled={!writable}
              value={data.settings.unit}
              onChange={(e) => settings({ unit: e.target.value as 'kg' | 'lb' })}
            >
              <option value="kg">千克 kg</option>
              <option value="lb">磅 lb</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>界面主题</strong>
              <small>训练控制台 A</small>
            </span>
            <select
              className="form-select"
              aria-label="界面主题"
              disabled={!writable}
              value={data.settings.theme}
              onChange={(e) => settings({ theme: e.target.value as 'dark' | 'light' })}
            >
              <option value="dark">深石墨</option>
              <option value="light">清新浅色</option>
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>自由训练默认休息</strong>
              <small>模板训练采用模板中的休息设置</small>
            </span>
            <select
              className="form-select"
              aria-label="默认休息"
              disabled={!writable}
              value={data.settings.defaultRest}
              onChange={(e) => settings({ defaultRest: Number(e.target.value) })}
            >
              {[0, 30, 60, 90, 120, 180].map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? '不自动计时' : `${s} 秒`}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-row">
            <span>
              <strong>完成一组自动开始休息</strong>
              <small>返回网页时按截止时间重新计算</small>
            </span>
            <input
              aria-label="自动休息"
              type="checkbox"
              checked={data.settings.autoRest}
              disabled={!writable}
              onChange={(e) => settings({ autoRest: e.target.checked })}
            />
          </label>
          <label className="setting-row"><span><strong>显示主观用力 RPE</strong><small>可选6–10，支持半档；关闭显示保留已填记录</small></span>
            <input aria-label="显示主观用力 RPE" type="checkbox" checked={data.settings.showRpe} disabled={!writable}
              onChange={event => settings({ showRpe: event.target.checked })} />
          </label>
        </section>
        <section className="card">
          <h2>把记录，留在自己手里。</h2>
          <p className="muted">
            {isIos() ? '记录保存在本机应用，可选择加密云同步。请定期导出备份，在系统分享中保存到“文件”或其他位置。' : '数据先保存在当前浏览器、当前站点。可选择上方云同步，换设备后使用同步密钥连接；请仍定期导出备份。'}
          </p>
          <div className="setting-row">
            <span>
              <strong>本地数据</strong>
              <small>
                {data.sessions.filter((s) => s.status === 'completed').length} 场已完成训练 ·{' '}
                {data.templates.filter((t) => !t.archived).length} 个模板 · {data.exercises.length} 个动作 · {data.bodyMetrics.length} 条身体记录
              </small>
            </span>
            <span className="tag">本机使用</span>
          </div>
          <div className="setting-row">
            <span>
              <strong>最近导出</strong>
              <small>
                {data.settings.lastExportAt
                  ? new Date(data.settings.lastExportAt).toLocaleString('zh-CN')
                  : '尚未导出备份'}
              </small>
            </span>
            <Icon name="download" />
          </div>
          <div className="data-actions">
            <button
              className="btn btn-primary"
              onClick={async () => {
                setError('');
                try {
                  const result = await downloadBackup(data);
                  if (result === 'cancelled' || result === 'busy') { notify(result === 'cancelled' ? '已取消分享，记录仍保存在本机' : '请先完成当前分享'); return; }
                  if (writable) settings({ lastExportAt: new Date().toISOString() });
                  notify(result === 'shared' ? '备份已交给系统分享，请确认保存到所选位置' : '备份文件已生成，请确认文件下载完成并妥善保存');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Icon name="download" />
              导出备份
            </button>
            <button
              className="btn btn-secondary"
              disabled={!writable}
              onClick={() => {
                setError('');
                fileInput.current?.click();
              }}
            >
              <Icon name="upload" />
              导入备份
            </button>
          </div>
          <input
            ref={fileInput}
            className="sr-only"
            type="file"
            tabIndex={-1}
            accept=".json,application/json"
            aria-label="选择健力宝备份文件"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              if (file.size > 10 * 1024 * 1024) {
                setError('备份文件不能超过 10 MB');
                return;
              }
              try {
                const imported = parseBackup(await file.text());
                setIncoming(imported);
                setResolution('keep-local');
                setConfirmed(false);
                setError('');
              } catch (reason) {
                setError((reason as Error).message);
              }
            }}
          />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <p className="notice">
            备份包含动作、模板、全部训练、身体数据和偏好。导入合并动作、模板、训练与身体记录，保留本机的主题、显示单位和其他设置；原始 kg
            数据不变。备份不包含云同步密钥和离线素材，请单独保存密钥。备份导入导出在本机处理；已开启云同步时，共享记录也会随后同步。
          </p>
        </section>
        <section className="card">
          <h3>关于健力宝</h3>
          <p className="muted">
            {isIos() ? '当前版本专注个人训练记录，支持本机保存和可选加密云同步。健康平台和手表暂未接入。' : '当前版本专注个人训练记录，支持浏览器本机保存和可选加密云同步。原生版本另行交付。'}
          </p>
          <span className="tag">{isIos() ? '健力宝 iOS 0.4.0 · 本机记录与可选云同步' : '健力宝 Web 0.4.0 · 本地记录与可选云同步'}</span>
        </section>
      </div>
      <Presence>
        {incoming && preview && (
          <Modal
            title="预览导入备份"
            onClose={() => setIncoming(null)}
            footer={
              <>
                <button className="btn btn-secondary" disabled={busy} onClick={() => setIncoming(null)}>
                  取消导入
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!writable || busy || !!previewError || (preview.conflicts.length > 0 && !confirmed)}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      mergeImport(data, incoming, resolution);
                      const expectedRevision = data.revision;
                      const ok = await mutate((latest) => {
                        if (latest.revision !== expectedRevision) {
                          const message = '本地数据已变化，请重新查看预览并确认';
                          setError(message);
                          setConfirmed(false);
                          throw new Error(message);
                        }
                        return mergeImport(latest, incoming, resolution);
                      });
                      if (ok) {
                        setIncoming(null);
                        notify(isIos() ? '备份已合并并保存到本机应用' : '备份已合并并保存到此浏览器');
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    }
                    setBusy(false);
                  }}
                >
                  确认导入
                </button>
              </>
            }
          >
            <div className="import-summary">
              <p>
                <strong>{preview.added}</strong> 条新增 · <strong>{preview.unchanged}</strong> 条相同 ·{' '}
                <strong>{preview.conflicts.length}</strong> 条冲突
              </p>
              <p className="muted">只有确认后才写入。同 ID 相同内容不会重复添加；身体记录按同一日期核对。导入不会删除本机独有的记录。</p>
              {previewError && <p className="error-text" role="alert">{previewError}</p>}
            </div>
            {preview.conflicts.length > 0 && (
              <>
                <div className="conflict-list">
                  {preview.conflicts.map((c) => (
                    <div key={`${c.collection}-${c.id}`}>
                      <span className="tag">
                        {c.collection === 'sessions' ? '训练' : c.collection === 'templates' ? '模板' : c.collection === 'bodyMetrics' ? '身体数据' : '动作'}
                      </span>{' '}
                      {c.name}
                    </div>
                  ))}
                </div>
                <label className="field">
                  冲突处理
                  <select
                    className="form-select"
                    aria-label="冲突处理"
                    value={resolution}
                    onChange={(e) => {
                      setResolution(e.target.value as typeof resolution);
                      setConfirmed(false);
                    }}
                  >
                    <option value="keep-local">冲突项保留本机内容</option>
                    <option value="use-import">冲突项使用备份内容</option>
                  </select>
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  我已查看冲突项，确认按所选方式合并
                </label>
              </>
            )}
            <p className="notice">保留本机偏好。若备份与本机各有一场未完成训练，需先完成或取消本机草稿再合并。</p>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </Modal>
        )}
      </Presence>
    </>
  );
}
