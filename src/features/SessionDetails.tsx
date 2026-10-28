import { muscleLabel } from '../content/body-map';
import { isWorkSet, setTypeLabels } from '../domain/sets';
import RpeSelect from '../components/RpeSelect';
import { useState } from 'react';
import type { AppData, Session } from '../domain/types';
import { sessionStats, uid } from '../domain/training';
import { displayWeight, fromWeight } from '../domain/units';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { Summary } from './Workout';

export default function SessionDetails({
  session,
  data,
  writable,
  mutate,
  onClose,
  onRepeat,
  notify,
}: {
  session: Session;
  data: AppData;
  writable: boolean;
  mutate: (fn: (d: AppData) => AppData) => Promise<boolean>;
  onClose: () => void;
  onRepeat: (s: Session) => void;
  notify: (s: string) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(session));
  const [editing, setEditing] = useState(false);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  function modify(exId: string, setId: string, key: string, value: string) {
    setDraft((s) => ({
      ...s,
      exercises: s.exercises.map((ex) =>
        ex.id === exId
          ? {
              ...ex,
              sets: ex.sets.map((set) =>
                set.id === setId
                  ? {
                      ...set,
                      [key]:
                        key === 'rpe' && value === '' ? undefined : key === 'weightKg'
                          ? fromWeight(Number(value), data.settings.unit)
                          : key === 'status' || key === 'type'
                            ? value
                            : Number(value),
                    }
                  : set,
              ),
            }
          : ex,
      ),
    }));
  }
  function assertCurrent(d: AppData) {
    if (d.sessions.find((s) => s.id === session.id)?.updatedAt !== session.updatedAt)
      throw new Error('这场记录已变化，请关闭后重新查看再修改');
  }
  async function save() {
    if (!sessionStats(draft).completedSets) {
      notify('至少保留一组完成结果');
      return;
    }
    setBusy(true);
    const ok = await mutate((d) => {
      assertCurrent(d);
      return {
        ...d,
        sessions: d.sessions.map((s) => (s.id === session.id ? { ...draft, updatedAt: new Date().toISOString() } : s)),
      };
    });
    setBusy(false);
    if (ok) {
      notify('历史记录已修正，统计已重新计算');
      onClose();
    }
  }
  async function makeTemplate() {
    const ok = await mutate((d) => {
      const exercises = [...d.exercises];
      for (const ex of session.exercises)
        if (!exercises.some((e) => e.id === ex.exercise.id)) exercises.push(ex.exercise);
      return {
        ...d,
        exercises,
        templates: [
          ...d.templates,
          {
            id: uid(),
            name: `${session.name.slice(0, 100)} · 复练`,
            description: `根据 ${session.date} 的实际记录创建，可在计划中继续调整。`,
            restSeconds: session.restDuration,
            updatedAt: new Date().toISOString(),
            items: session.exercises
              .filter((ex) => ex.sets.some((s) => s.status === 'completed'))
              .map((ex) => {
                const sets = ex.sets.filter((s) => s.status === 'completed' && isWorkSet(s));
                const last = sets.at(-1) ?? ex.sets.find((s) => s.status === 'completed')!;
                return {
                  id: uid(),
                  exerciseId: ex.exercise.id,
                  sets: Math.max(1, sets.length),
                  weightKg: last.weightKg,
                  reps: last.reps || 10,
                  durationSeconds: last.durationSeconds || 30,
                };
              }),
          },
        ],
      };
    });
    if (ok) notify('已存为复练模板，可在计划页调整');
  }
  return (
    <Modal
      title={remove ? '删除这场历史？' : editing ? '修正历史记录' : session.name}
      wide
      onClose={onClose}
      footer={
        remove ? (
          <>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setRemove(false)}>
              保留记录
            </button>
            <button
              className="btn btn-danger"
              disabled={!writable || busy}
              onClick={async () => {
                setBusy(true);
                const ok = await mutate((d) => {
                  assertCurrent(d);
                  return { ...d, sessions: d.sessions.filter((s) => s.id !== session.id) };
                });
                setBusy(false);
                if (ok) {
                  notify('历史已删除，相关统计已重新计算');
                  onClose();
                }
              }}
            >
              确认删除这场历史
            </button>
          </>
        ) : editing ? undefined : (
          <>
            <button className="btn btn-ghost danger-text" disabled={!writable} onClick={() => setRemove(true)}>
              <Icon name="trash" size={16} />
              删除
            </button>
            <button className="btn btn-secondary" disabled={!writable} onClick={() => setEditing(true)}>
              修正记录
            </button>
            <button className="btn btn-secondary" disabled={!writable} onClick={() => void makeTemplate()}>
              存为模板
            </button>
            <button
              className="btn btn-primary"
              disabled={!writable}
              onClick={() => {
                onRepeat(session);
                onClose();
              }}
            >
              <Icon name="refresh" size={16} />
              再练一次
            </button>
          </>
        )
      }
    >
      {remove ? (
        <div className="delete-record-copy">
          <Icon name="alert" size={24} />
          <h3>
            {session.date} · {session.name}
          </h3>
          <p>这会移除本场记录，并重新计算趋势和个人纪录。模板及其他训练保留。删除不能撤销，建议先在“我”导出备份。</p>
        </div>
      ) : (
        <>
          <p className="muted">
            {session.date} · {session.timeZone} ·{' '}
            {session.recordedManually
              ? '手动补录'
              : new Date(session.startedAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: session.timeZone,
                }) + ' 开始'}
          </p>
          <Summary session={draft} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            {draft.exercises.map((ex) => (
              <section className="history-exercise" key={ex.id}>
                <div className="section-heading">
                  <h3 className="wrap-cjk">{ex.exercise.name}</h3>
                  <span className="tag">
                    {muscleLabel(ex.exercise)} · {ex.exercise.equipment}
                  </span>
                </div>
                <div className="table-scroll">
                  <table className="set-table">
                    <thead>
                      <tr>
                        <th>组</th>
                        <th>类型</th>
                        {ex.exercise.kind === 'weight-reps' && <th>{data.settings.unit}</th>}
                        <th>{ex.exercise.kind === 'duration' ? '秒' : '次数'}</th>
                        {(data.settings.showRpe || ex.sets.some(set => set.rpe !== undefined)) && <th>RPE</th>}
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ex.sets.map((set, i) => (
                        <tr key={set.id}>
                          <td>{i + 1}</td>
                          <td>
                            {editing ? (
                              <select
                                className="set-type"
                                aria-label={`修正${ex.exercise.name}第${i + 1}组类型`}
                                disabled={!writable}
                                value={set.type}
                                onChange={(e) => modify(ex.id, set.id, 'type', e.target.value)}
                              >
                                <option value="work">正式</option>
                                <option value="warmup">热身</option>
                                <option value="drop">递减</option>
                                <option value="failure">力竭</option>
                              </select>
                            ) : setTypeLabels[set.type]}
                          </td>
                          {ex.exercise.kind === 'weight-reps' && (
                            <td>
                              {editing ? (
                                <input
                                  className="number-input"
                                  aria-label={`修正${ex.exercise.name}第${i + 1}组重量`}
                                  type="number"
                                  inputMode="decimal"
                                  enterKeyHint="next"
                                  min={0}
                                  max={data.settings.unit === 'kg' ? 1000 : 2204.62}
                                  step="any"
                                  required
                                  disabled={!writable}
                                  value={displayWeight(set.weightKg, data.settings.unit)}
                                  onChange={(e) => modify(ex.id, set.id, 'weightKg', e.target.value)}
                                />
                              ) : (
                                displayWeight(set.weightKg, data.settings.unit)
                              )}
                            </td>
                          )}
                          <td>
                            {editing ? (
                              <input
                                className="number-input"
                                type="number"
                                inputMode="numeric"
                                enterKeyHint="next"
                                aria-label={`修正${ex.exercise.name}第${i + 1}组结果`}
                                min={1}
                                max={ex.exercise.kind === 'duration' ? 86400 : 1000}
                                step={1}
                                required
                                disabled={!writable}
                                value={ex.exercise.kind === 'duration' ? set.durationSeconds : set.reps}
                                onChange={(e) =>
                                  modify(
                                    ex.id,
                                    set.id,
                                    ex.exercise.kind === 'duration' ? 'durationSeconds' : 'reps',
                                    e.target.value,
                                  )
                                }
                              />
                            ) : ex.exercise.kind === 'duration' ? (
                              set.durationSeconds
                            ) : (
                              set.reps
                            )}
                          </td>
                          {(data.settings.showRpe || ex.sets.some(s => s.rpe !== undefined)) && <td>
                            {editing ? <RpeSelect value={set.rpe} disabled={!writable}
                              label={`修正${ex.exercise.name}第${i + 1}组RPE`}
                              onChange={rpe => modify(ex.id, set.id, 'rpe', rpe === undefined ? '' : String(rpe))} /> : (set.rpe ?? '未记录')}
                          </td>}
                          <td>
                            {editing ? (
                              <select
                                className="set-type"
                                aria-label={`修正${ex.exercise.name}第${i + 1}组状态`}
                                value={set.status}
                                disabled={!writable}
                                onChange={(e) => modify(ex.id, set.id, 'status', e.target.value)}
                              >
                                <option value="completed">完成</option>
                                <option value="pending">未完成</option>
                                <option value="skipped">跳过</option>
                              </select>
                            ) : set.status === 'completed' ? (
                              <span className="result-completed">
                                <Icon name="check" size={16} />
                                完成
                              </span>
                            ) : set.status === 'skipped' ? (
                              '跳过'
                            ) : (
                              '未完成'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {ex.note && <p className="muted">动作备注：{ex.note}</p>}
              </section>
            ))}
            <label className="field">
              训练备注
              <textarea
                className="form-textarea"
                maxLength={2000}
                readOnly={!editing || !writable}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="这场训练的感受与下次调整…"
              />
            </label>
            {editing && (
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setDraft(structuredClone(session));
                    setEditing(false);
                  }}
                >
                  取消修改
                </button>
                <button className="btn btn-primary" disabled={!writable || busy}>
                  保存修正
                </button>
              </div>
            )}
          </form>
        </>
      )}
    </Modal>
  );
}
