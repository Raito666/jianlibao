import { useState } from 'react';
import Modal from '../components/Modal';
import { createSecret } from '../sync/crypto';
import type { Decisions } from '../sync/engine';
import type { CloudSyncController } from '../sync/useCloudSync';
import { exportTextFile, isIos } from '../platform/native';

const labels: Record<string, string> = {
  name: '名称', date: '日期', weightKg: '重量（kg）', bodyFatPct: '体脂率（%）', measurements: '围度（cm）',
  chest: '胸围', waist: '腰围', hip: '臀围', arm: '臂围', thigh: '腿围', note: '备注', description: '讲解 / 描述',
  muscle: '肌群', equipment: '器械', kind: '记录方式', sets: '训练组', reps: '次数', durationSeconds: '时长（秒）',
  rpe: '主观用力', type: '组类型', status: '状态', exercises: '训练动作', exercise: '动作', items: '模板动作',
  startedAt: '开始时间', finishedAt: '结束时间', updatedAt: '更新时间', restSeconds: '组间休息（秒）', archived: '已归档',
};
const words: Record<string, string> = { completed: '已完成', cancelled: '已取消', pending: '未完成', skipped: '已跳过', warmup: '热身组', work: '正式组', drop: '递减组', failure: '力竭组', 'weight-reps': '重量和次数', reps: '次数', duration: '时长' };
function readable(value: unknown, indent = ''): string {
  if (value === null) return '已删除';
  if (Array.isArray(value)) return value.map((v, i) => `${indent}${i + 1}. ${readable(v, indent + '  ')}`).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).filter(([k]) => labels[k]).map(([k, v]) => `${indent}${labels[k]}：${readable(v, indent + '  ')}`).join('\n');
  if (typeof value === 'boolean') return value ? '是' : '否';
  return typeof value === 'string' ? words[value] ?? value : String(value ?? '未填写');
}

export default function CloudSyncPanel({ cloud, writable }: { cloud: CloudSyncController; writable: boolean }) {
  const [mode, setMode] = useState<'create' | 'join' | 'key' | 'disconnect' | null>(null);
  const [key, setKey] = useState(''), [savedKey, setSavedKey] = useState(false), [message, setMessage] = useState('');
  const [decisions, setDecisions] = useState<Decisions>({});
  const locked = cloud.busy || !writable || !cloud.ready;
  const open = (next: typeof mode) => {
    setMessage(''); setSavedKey(false); setMode(next);
    setKey(next === 'create' ? createSecret() : next === 'key' ? cloud.secret : '');
  };
  const downloadKey = async () => {
    try {
      const result = await exportTextFile({ text: `健力宝个人同步密钥\n\n${key}\n\n在另一设备打开健力宝 → 我 → 云同步 → 连接已有同步。\n此密钥可以读取和修改你的云端记录，请私下保存。普通备份不含密钥；遗失后服务器无法恢复。`, name: '健力宝同步密钥.txt', type: 'text/plain;charset=utf-8' });
      setMessage(result === 'cancelled' || result === 'busy' ? '保存未完成，请重试' : '密钥文件已生成，请确认已保存到安全位置');
    } catch { setMessage('密钥文件未保存，请手动复制到安全位置'); }
  };
  return <section className="card cloud-sync" aria-labelledby="cloud-sync-heading">
    <div className="cloud-heading"><h2 id="cloud-sync-heading">云同步</h2><span className="tag">{cloud.connected ? '已连接' : '可选开启'}</span></div>
    <p className="muted">训练先保存在本机，联网后同步归档训练、身体记录、动作和模板。训练草稿、界面偏好与图片视频留在各自设备。</p>
    <p className="cloud-status" role="status" aria-atomic="true">{cloud.busy ? '正在加密并同步…' : cloud.conflicts.length ? `有 ${cloud.conflicts.length} 条记录需要选择版本` : cloud.lastSuccess ? `最近同步：${new Date(cloud.lastSuccess).toLocaleString('zh-CN')}` : cloud.connected ? '已连接，等待首次同步' : '未开启，本地记录正常保存'}</p>
    {!cloud.connected ? <div className="data-actions">
      <button className="btn btn-primary" disabled={locked} onClick={() => open('create')}>创建加密同步</button>
      <button className="btn btn-secondary" disabled={locked} onClick={() => open('join')}>连接已有同步</button>
    </div> : <div className="data-actions">
      <button className="btn btn-primary" disabled={locked} onClick={() => void cloud.sync()}>立即同步</button>
      <button className="btn btn-secondary" disabled={cloud.busy} onClick={() => open('key')}>查看同步密钥</button>
      <button className="btn btn-secondary" disabled={locked} onClick={() => open('disconnect')}>断开本机同步</button>
    </div>}
    {cloud.error && <p className="error-text wrap-cjk" role="alert">{cloud.error}</p>}
    {cloud.conflicts.length > 0 && <div className="cloud-conflicts">
      <p>同一条记录在两处有不同修改。未作选择前，两边都保留原记录。</p>
      {cloud.conflicts.map(conflict => <div className="cloud-conflict" key={conflict.key}>
        <strong className="wrap-cjk">{conflict.name}</strong>
        <div className="cloud-versions">{(['local', 'remote'] as const).map(side => <details key={side}><summary>{side === 'local' ? '本机版本' : '云端版本'}</summary><pre>{readable(conflict[side])}</pre></details>)}</div>
        <label className="field">保留的版本<select className="form-select" aria-label={`${conflict.name} 保留版本`} value={decisions[conflict.key]?.choice ?? ''} onChange={event => {
          const choice = event.target.value;
          setDecisions(d => { const next = { ...d }; if (!choice) delete next[conflict.key]; else next[conflict.key] = { choice: choice as 'local' | 'remote', local: conflict.local, remote: conflict.remote }; return next; });
        }}><option value="">请选择</option><option value="local">保留本机版本</option><option value="remote">保留云端版本</option></select></label>
      </div>)}
      <button className="btn btn-primary" disabled={locked || cloud.conflicts.some(c => !decisions[c.key])} onClick={() => void cloud.sync(decisions)}>合并并同步</button>
    </div>}
    <p className="notice">密钥相当于密码：持有人可访问这个同步空间，请私下保存。云端仅存加密记录；普通备份不含密钥。采用现有免费托管，不因闲置一周自动暂停，免费额度耗尽时仍可能暂时不可用。</p>
    {isIos() && <p className="notice">本机记录保存在应用数据库，密钥由此设备的系统钥匙串保管。切回前台会重新同步；草稿留在本机。换机或卸载前请分别保存备份和同步密钥。</p>}
    {mode && <Modal title={mode === 'create' ? '创建加密同步' : mode === 'join' ? '连接已有同步' : mode === 'key' ? '保存同步密钥' : '断开本机同步'} onClose={() => { if (!cloud.busy) setMode(null); }} footer={<>
      <button className="btn btn-secondary" disabled={cloud.busy} onClick={() => setMode(null)}>{mode === 'key' ? '关闭' : '取消'}</button>
      {mode === 'disconnect' ? <button className="btn btn-primary" disabled={locked} onClick={async () => { await cloud.disconnect(); setMode(null); }}>确认断开</button> : mode !== 'key' && <button className="btn btn-primary" disabled={locked || !key.trim() || (mode === 'create' && !savedKey)} onClick={async () => {
        if (await cloud.connect(key, mode === 'create')) { setMode(null); setKey(''); }
      }}>{mode === 'create' ? '开启同步' : '连接并合并'}</button>}
    </>}>
      {mode === 'disconnect' ? <p>只停止本机后续同步，保留本机全部记录和云端加密记录。再次连接需要同步密钥，请先保存。</p> : <>
        <p>{mode === 'join' ? '在已连接的设备选择“查看同步密钥”，将完整密钥私下粘贴到这里。连接会合并两边记录，冲突需选择版本。' : '请保存这份同步密钥，再在其他设备连接。同一个密钥对应同一个私人同步空间；遗失后无法从服务器找回。'}</p>
        <label className="field">同步密钥<input className="form-input cloud-key" aria-label="同步密钥" type={mode === 'join' ? 'password' : 'text'} readOnly={mode !== 'join'} value={key} onChange={e => setKey(e.target.value)} maxLength={48} autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="done" /></label>
        {mode !== 'join' && <button className="btn btn-secondary" onClick={() => void downloadKey()}>保存密钥文件</button>}
        {mode === 'create' && <label className="checkbox-label"><input type="checkbox" checked={savedKey} onChange={e => setSavedKey(e.target.checked)} />我已将同步密钥保存在安全位置</label>}
        {message && <p role="status" className="notice">{message}</p>}
        {cloud.error && <p className="error-text" role="alert">{cloud.error}</p>}
      </>}
    </Modal>}
  </section>;
}
