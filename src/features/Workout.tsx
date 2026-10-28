import { isCompactViewport } from '../platform/compact-layout';
import { muscleLabel } from '../content/body-map';
import Presence from '../motion/Presence';
import RestPanel from './workout/RestPanel';
import ExerciseNav from './workout/ExerciseNav';
import SessionReview from './workout/SessionReview';
import SetTable from './workout/SetTable';
import { formatClock, useNow } from './workout/clock';
import type { Update } from './workout/types';
export { default as SetTable } from './workout/SetTable';
export { default as Summary } from './workout/Summary';
export { formatClock, useNow } from './workout/clock';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppData, Exercise, Session } from '../domain/types';
import {
  createSessionExercise,
  pauseSession,
  resumeSession,
  reviewSession,
  sessionStats,
  uid,
} from '../domain/training';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import ExerciseDetails from './ExerciseDetails';
import { displayWeight } from '../domain/units';
import { lastWorkSet, seedExercise, nextSuggestedSet } from './workout/performance';
import type { useRestReminder } from './workout/useRestReminder';
export { displayWeight, fromWeight } from '../domain/units';

export default function Workout({
  data,
  session,
  update,
  finish,
  cancel,
  writable,
  goHome,
  restReminder,
}: {
  data: AppData;
  session: Session;
  update: Update;
  finish: () => Promise<boolean>;
  cancel: () => Promise<boolean>;
  writable: boolean;
  goHome: () => void;
  restReminder: ReturnType<typeof useRestReminder>;
}) {
  const now = useNow();
  const [current, setCurrent] = useState(0);
  const [detail, setDetail] = useState<Exercise | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(data.exercises[0]?.id ?? '');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restCollapsed, setRestCollapsed] = useState(true);
  const view = useRef<HTMLDivElement>(null);
  const stats = sessionStats(session, now);
  const count = session.exercises.reduce((n, e) => n + e.sets.length, 0);
  const disabled = !writable || session.status === 'paused' || session.status === 'review';
  const rest = session.restUntil ? Math.max(0, Math.ceil((session.restUntil - now) / 1000)) : 0;
  useEffect(() => {
    setCurrent((index) => Math.max(0, Math.min(index, session.exercises.length - 1)));
  }, [session.exercises.length]);
  const item = session.exercises[current];
  const previousSet = item ? lastWorkSet(data.sessions, item.exercise, session.date, session.id) : undefined;
  const resting = rest > 0;
  useEffect(() => {
    setRestCollapsed(!resting || window.innerHeight < 600);
  }, [resting]);
  useLayoutEffect(() => {
    const root = view.current;
    if (!root) return;
    const panels = [...root.querySelectorAll<HTMLElement>('.rest-panel,.workout-footer')];
    const measure = () => {
      const mobile = isCompactViewport();
      const footer = root.querySelector<HTMLElement>('.workout-footer')?.offsetHeight ?? 0;
      const restPanel = root.querySelector<HTMLElement>('.rest-panel')?.offsetHeight ?? 0;
      root.style.setProperty('--workout-action-height', `${Math.ceil(footer / 4) * 4}px`);
      root.style.setProperty(
        '--workout-dock-height',
        `${mobile && (footer || restPanel) ? Math.ceil((footer + restPanel + 32) / 4) * 4 : 0}px`,
      );
      root
        .closest<HTMLElement>('.app-shell')
        ?.style.setProperty('--training-dock-height', root.style.getPropertyValue('--workout-dock-height'));
    };
    measure();
    const observer = new ResizeObserver(measure);
    panels.forEach((panel) => observer.observe(panel));
    const resize = () => {
      if (isCompactViewport() && (window.visualViewport?.height ?? innerHeight) < 600)
        setRestCollapsed(true);
      measure();
    };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      root.closest<HTMLElement>('.app-shell')?.style.removeProperty('--training-dock-height');
    };
  }, [session.status, item?.id]);
  useEffect(() => {
    view.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [item?.id]);
  const pending = item?.sets.findIndex((set) => set.status === 'pending') ?? -1;
  const nextGroup = item
    ? `${item.exercise.name} · ${pending >= 0 ? `第${pending + 1}组` : '当前动作已记录完毕'}`
    : '先加入一个动作';
  const setNote = (note: string) => void update((s) => ({ ...s, note, updatedAt: new Date().toISOString() }));
  return (
    <div
      className="workout-view"
      data-ios-input-scope=""
      ref={view}
      onFocusCapture={(event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement ||
          event.target instanceof HTMLTextAreaElement
        )
          setRestCollapsed(true);
      }}
    >
      <div className="workout-header">
        <div>
          <h1 className={session.status === 'review' ? 'wrap-cjk' : 'truncate'} title={session.name}>{session.status === 'review' ? '把今天的努力留下来。' : session.name}</h1>
          <p className="muted">
            {session.date} ·{' '}
            {session.status === 'paused' ? '已暂停' : session.status === 'review' ? '待归档' : '训练中'} ·{' '}
            {formatClock(stats.activeSeconds)}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={goHome}>
          <Icon name="back" />
          <span className="workout-return-label">返回今天</span>
        </button>
      </div>
      {session.status === 'review' ? (
        <SessionReview
          data={data}
          session={session}
          now={now}
          stats={stats}
          writable={writable}
          busy={busy}
          setBusy={setBusy}
          update={update}
          finish={finish}
          setNote={setNote}
        />
      ) : (
        <>
          <div className="section-heading">
            <p className="muted">
              已完成 {stats.completedSets} / {count} 组
            </p>
            <span className="tag">
              {!session.exercises.some((ex) => ex.exercise.kind === 'weight-reps')
                ? '重量容量不适用'
                : stats.volumeKg.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' kg·次'}
            </span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="训练完成进度"
            aria-valuenow={stats.completedSets}
            aria-valuemin={0}
            aria-valuemax={count || 1}
          >
            <div
              className="progress-fill"
              style={{ transform: `scaleX(${count ? stats.completedSets / count : 0})` }}
            />
          </div>
          <div className="workout-grid">
            <div className="workout-main">
              {session.status === 'paused' && (
                <div className="notice">
                  <strong>训练已暂停</strong>
                  <p>暂停时间不计入训练时长。点击继续后记录。</p>
                  <button
                    className="btn btn-primary"
                    disabled={!writable}
                    onClick={() => void update((s) => resumeSession(s))}
                  >
                    继续训练
                  </button>
                </div>
              )}
              {item ? (
                <section className="card exercise-card current">
                  <div className="exercise-heading">
                    <div>
                      <p className="exercise-position truncate">
                        动作 {current + 1} / {session.exercises.length} · {muscleLabel(item.exercise)}
                      </p>
                      <h2 className="line-clamp-2 wrap-cjk" title={item.exercise.name}>{item.exercise.name}</h2>
                      <p className="muted">
                        {item.exercise.equipment} ·{' '}
                        {item.exercise.kind === 'weight-reps'
                          ? '总外部负重；双哑铃两只合计'
                          : item.exercise.kind === 'duration'
                            ? '按实际秒数记录'
                            : '按次数记录，不估算有效负重'}
                      </p>
                    </div>
                    <button className="btn btn-ghost" onClick={() => setDetail(item.exercise)}>
                      动作说明 ↗
                    </button>
                  </div>
                  {previousSet && (
                    <div className="previous-result">
                      <Icon name="history" />
                      <span>
                        上次完成：
                        {item.exercise.kind === 'weight-reps'
                          ? `${displayWeight(previousSet.weightKg, data.settings.unit)} ${data.settings.unit} × ${previousSet.reps} 次`
                          : item.exercise.kind === 'duration'
                            ? `${previousSet.durationSeconds} 秒`
                            : `${previousSet.reps} 次`}
                      </span>
                    </div>
                  )}
                  <SetTable
                    session={session}
                    exerciseIndex={current}
                    unit={data.settings.unit}
                    update={update}
                    disabled={disabled}
                    autoRest={data.settings.autoRest}
                    showRpe={data.settings.showRpe}
                  />
                  <p className="set-help">待完成组为建议值，确认后才计入记录。</p>
                  {data.settings.showRpe && <p className="set-help">递减、力竭计入工作组，热身不计容量。RPE 为可选主观用力：6 较轻松，10 已尽力。</p>}
                  <div className="row wrap">
                    <button
                      className="btn btn-ghost"
                      disabled={disabled || item.sets.length >= 30}
                      onClick={() =>
                        void update((s) => ({
                          ...s,
                          exercises: s.exercises.map((ex) =>
                            ex.id === item.id
                              ? {
                                  ...ex,
                                  sets: [...ex.sets, nextSuggestedSet(ex, data.sessions, uid(), s.date, s.id)],
                                }
                              : ex,
                          ),
                          updatedAt: new Date().toISOString(),
                        }))
                      }
                    >
                      <Icon name="plus" />
                      增加一组
                    </button>
                    <button
                      className="btn btn-ghost"
                      disabled={disabled}
                      onClick={() => {
                        setSelected(item.exercise.id);
                        setAdding(true);
                      }}
                    >
                      添加 / 替换动作
                    </button>
                  </div>
                  <label className="field">
                    动作备注
                    <input
                      className="form-input"
                      maxLength={1000}
                      value={item.note}
                      disabled={disabled}
                      onChange={(e) => {
                        const value = e.target.value;
                        void update((s) => ({
                          ...s,
                          exercises: s.exercises.map((ex) => (ex.id === item.id ? { ...ex, note: value } : ex)),
                          updatedAt: new Date().toISOString(),
                        }));
                      }}
                      placeholder="器械档位、个人提示…"
                    />
                  </label>
                  <div className="workout-footer">
                    <button className="btn btn-secondary" disabled={!current} onClick={() => setCurrent((n) => n - 1)}>
                      上一动作
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        if (current < session.exercises.length - 1) setCurrent((n) => n + 1);
                        else void update((s) => reviewSession(s));
                      }}
                      disabled={!writable || session.status === 'paused'}
                    >
                      {current < session.exercises.length - 1 ? '下一动作' : '完成并回顾'}
                      <Icon name="arrow" />
                    </button>
                  </div>
                </section>
              ) : (
                <section className="card empty-state">
                  <Icon name="dumbbell" size={24} />
                  <h2>按自己的节奏，开始自由训练。</h2>
                  <p>加入第一个动作，记录今天的第一组。</p>
                  <button className="btn btn-primary" disabled={disabled} onClick={() => setAdding(true)}>
                    添加动作
                  </button>
                </section>
              )}
            </div>
            <aside className="workout-side">
              <RestPanel
                rest={rest}
                disabled={disabled}
                update={update}
                reminder={restReminder}
                collapsed={restCollapsed}
                setCollapsed={setRestCollapsed}
                nextGroup={nextGroup}
              />
              <ExerciseNav session={session} current={current} setCurrent={setCurrent} />
              <div className="row wrap">
                <button
                  className="btn btn-secondary"
                  disabled={disabled}
                  onClick={() => void update((s) => pauseSession(s))}
                >
                  <Icon name="pause" />
                  暂停训练
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!writable}
                  onClick={() => void update((s) => reviewSession(s))}
                >
                  提前回顾
                </button>
              </div>
            </aside>
          </div>
        </>
      )}
      <button className="btn btn-ghost danger-text" disabled={!writable} onClick={() => setConfirmCancel(true)}>
        取消这场训练
      </button>
      <Presence interruptKey={item?.id}>
        {detail && <ExerciseInfo exercise={detail} data={data} onClose={() => setDetail(null)} />}
      </Presence>
      <Presence interruptKey={item?.id}>
        {adding && (
          <Modal
            title="加入训练的动作"
            onClose={() => setAdding(false)}
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => setAdding(false)}>
                  取消
                </button>
                {item && (
                  <button
                    className="btn btn-secondary"
                    disabled={disabled}
                    onClick={() => {
                      const exercise = data.exercises.find((e) => e.id === selected)!;
                      void update((s) => ({
                        ...s,
                        exercises: s.exercises.map((ex) =>
                          ex.id === item.id
                            ? seedExercise(createSessionExercise(exercise), data.sessions, s.date, s.id)
                            : ex,
                        ),
                        updatedAt: new Date().toISOString(),
                      }));
                      setAdding(false);
                    }}
                  >
                    替换当前动作
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  disabled={disabled || session.exercises.length >= 30}
                  onClick={() => {
                    const exercise = data.exercises.find((e) => e.id === selected)!;
                    void update((s) => ({
                      ...s,
                      exercises: [
                        ...s.exercises,
                        seedExercise(createSessionExercise(exercise), data.sessions, s.date, s.id),
                      ],
                      updatedAt: new Date().toISOString(),
                    }));
                    setCurrent(session.exercises.length);
                    setAdding(false);
                  }}
                >
                  加入训练
                </button>
              </>
            }
          >
            <label className="field">
              选择动作
              <select className="form-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
                {data.exercises.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} · {muscleLabel(ex)}
                  </option>
                ))}
              </select>
            </label>
            <p className="notice">替换只影响本场训练，原模板与历史不会改变。替换会移除当前动作在本场的组记录。</p>
          </Modal>
        )}
      </Presence>
      <Presence interruptKey={item?.id}>
        {confirmCancel && (
          <Modal
            title="取消这场训练？"
            onClose={() => setConfirmCancel(false)}
            footer={
              <>
                <button className="btn btn-secondary" onClick={() => setConfirmCancel(false)}>
                  继续保留
                </button>
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    if (await cancel()) setConfirmCancel(false);
                  }}
                >
                  确认取消训练
                </button>
              </>
            }
          >
            <p>这场草稿会标为已取消，不计入完成历史。已归档的其他训练不受影响。</p>
          </Modal>
        )}
      </Presence>
    </div>
  );
}

export function ExerciseInfo(props: { exercise: Exercise; data?: AppData; onClose: () => void }) {
  return <ExerciseDetails {...props} />;
}
