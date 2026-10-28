import { useState } from 'react';
import type { AppData } from '../domain/types';
import { dayKey } from '../domain/analytics';
import { createSession, createSessionExercise, sessionStats } from '../domain/training';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { SetTable } from './Workout';

export default function ManualSession({
  data,
  writable,
  mutate,
  onClose,
  notify,
}: {
  data: AppData;
  writable: boolean;
  mutate: (fn: (d: AppData) => AppData) => Promise<boolean>;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const today = dayKey(new Date());
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState('45');
  const [templateId, setTemplateId] = useState('');
  const [draft, setDraft] = useState(() => createSession(null, data.exercises));
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const completed = sessionStats(draft).completedSets;
  async function save() {
    setError('');
    if (!completed) {
      setError('请先完成至少一组实际记录；未完成组不会自动计入。');
      return;
    }
    const start = new Date(`${date}T00:00:00`).getTime();
    const duration = Number(minutes) * 60000;
    if (
      !Number.isFinite(start) ||
      date > today ||
      date < '1970-01-01' ||
      !Number.isInteger(Number(minutes)) ||
      duration < 60000 ||
      duration > 86400000
    ) {
      setError('请检查训练日期和1–1440分钟的时长。');
      return;
    }
    if (start + duration > Date.now()) {
      setError('所填时长超出该日期已经过的时间，请核对日期或时长。');
      return;
    }
    setBusy(true);
    const ok = await mutate((d) => {
      if (d.sessions.some((s) => s.id === draft.id)) throw new Error('这场记录已经保存');
      return {
        ...d,
        onboarded: true,
        sessions: [
          ...d.sessions,
          {
            ...draft,
            name: draft.name.trim() || '补记训练',
            date,
            startedAt: new Date(start).toISOString(),
            finishedAt: new Date(start + duration).toISOString(),
            updatedAt: new Date().toISOString(),
            pausedMs: 0,
            status: 'completed',
            restUntil: null,
            recordedManually: true,
          },
        ],
      };
    });
    setBusy(false);
    if (ok) {
      notify('补记训练已保存，历史与统计已更新');
      onClose();
    }
  }
  return (
    <Modal
      title="补记一场训练"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="manual-completed">已完成 {completed} 组</span>
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>
            取消补记
          </button>
          <button className="btn btn-primary" disabled={!writable || busy || !completed} onClick={() => void save()}>
            保存补记训练
          </button>
        </>
      }
    >
      <p className="muted">
        把忘记记录的训练补回来。填写实际结果，逐组点完成，确认后一次保存；不会影响正在进行的训练。
      </p>
      <div className="form-grid section-spacer">
        <label className="field">
          训练日期
          <input
            className="form-input"
            type="date"
            min="1970-01-01"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="field">
          实际时长（分钟）
          <input
            className="form-input"
            type="number"
            inputMode="numeric"
            enterKeyHint="next"
            min={1}
            max={1440}
            step={1}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        训练名称
        <input
          className="form-input"
          maxLength={120}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <label className="field">
        从模板填入动作（更换会重置本次未保存内容）
        <select
          className="form-select"
          value={templateId}
          disabled={!!completed}
          onChange={(e) => {
            const id = e.target.value;
            setTemplateId(id);
            const t = data.templates.find((t) => t.id === id);
            setDraft(createSession(t ?? null, data.exercises));
          }}
        >
          <option value="">自由选择动作</option>
          {data.templates
            .filter((t) => !t.archived)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </label>
      <div className="manual-picker">
        <label className="field">
          搜索补录动作
          <input
            className="form-input"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setChosen('');
            }}
            placeholder="按动作名称查找…"
          />
        </label>
        <div className="row">
          <select
            aria-label="选择补录动作"
            className="form-select"
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
          >
            <option value="">选择一个动作</option>
            {data.exercises
              .filter((ex) => ex.name.includes(query.trim()))
              .map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name} · {ex.equipment}
                </option>
              ))}
          </select>
          <button
            className="btn btn-secondary"
            disabled={!chosen || draft.exercises.length >= 30}
            onClick={() => {
              const ex = data.exercises.find((ex) => ex.id === chosen)!;
              setDraft({ ...draft, exercises: [...draft.exercises, createSessionExercise(ex)] });
            }}
          >
            <Icon name="plus" size={16} />
            加入
          </button>
        </div>
      </div>
      {draft.exercises.map((ex, i) => (
        <section className="manual-exercise" key={ex.id}>
          <div className="section-heading">
            <h3 className="line-clamp-2 wrap-cjk" title={ex.exercise.name}>{ex.exercise.name}</h3>
            <button
              className="icon-button danger-text"
              aria-label={`移除补录${ex.exercise.name}`}
              onClick={() => setDraft({ ...draft, exercises: draft.exercises.filter((x) => x.id !== ex.id) })}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <SetTable
            session={draft}
            exerciseIndex={i}
            unit={data.settings.unit}
            disabled={!writable}
            autoRest={false}
            showRpe={data.settings.showRpe}
            update={async (fn) => {
              try {
                setDraft(fn(draft));
                return true;
              } catch (e) {
                setError(e instanceof Error ? e.message : '本组输入无效');
                return false;
              }
            }}
          />
        </section>
      ))}
      <label className="field section-spacer">
        训练备注
        <textarea
          className="form-textarea"
          maxLength={2000}
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </label>
      <p className="inline-note">补记保存所填日期与时长，不把系统记账时间显示为真实开练时间。</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
