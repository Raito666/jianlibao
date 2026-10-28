import { isWorkSet } from './domain/sets';
import Presence from './motion/Presence';
import AppShell from './app/AppShell';
import { flushSync } from 'react-dom';
import { withViewTransition } from './motion/transition';
import { seedExercise } from './features/workout/performance';
import { useRestReminder } from './features/workout/useRestReminder';
import Toast from './components/Toast';
import { getPage, type Page } from './app/navigation';
import TodayPage from './features/today/TodayPage';
import PlansPage from './features/plans/PlansPage';
import LoadingSkeleton from './components/LoadingSkeleton';
import { useEffect, useRef, useState } from 'react';
import type { AppData, Exercise, Session, WorkoutTemplate } from './domain/types';
import {
  completeSession,
  createSession,
  createSessionExercise,
  reviewSession,
  sessionStats,
  uid,
} from './domain/training';
import { useWorkspace } from './hooks/useWorkspace';
import { useCloudSync } from './sync/useCloudSync';
import Icon from './components/Icon';
import Modal from './components/Modal';
import { ExerciseEditor, TemplateEditor } from './features/Editors';
import Workout, { ExerciseInfo } from './features/Workout';
import History, { localDate } from './features/History';
import ExerciseLibrary from './features/ExerciseLibrary';
import BackupSettings, { downloadBackup } from './features/BackupSettings';
import { useNativeInterface } from './platform/useNativeInterface';

const isDraft = (s: Session) => ['active', 'paused', 'review'].includes(s.status);

export default function App() {
  useNativeInterface();
  const workspace = useWorkspace();
  const cloud = useCloudSync(workspace);
  const { data, status, error, writable, mutate } = workspace;
  const [page, setPage] = useState<Page>(getPage);
  const [pageMotion, setPageMotion] = useState<'native' | 'fallback'>('native');
  const intendedPage = useRef(page);
  const mainRef = useRef<HTMLElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    if (previousPage.current !== page) {
      previousPage.current = page;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [page]);
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [templateEditor, setTemplateEditor] = useState<WorkoutTemplate | 'new' | null>(null);
  const [exerciseEditor, setExerciseEditor] = useState(false);
  const [exerciseInfo, setExerciseInfo] = useState<Exercise | null>(null);
  const [startTemplate, setStartTemplate] = useState<WorkoutTemplate | 'free' | null>(null);
  const [archiveTemplate, setArchiveTemplate] = useState<WorkoutTemplate | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const notify = (message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 4500);
  };
  const restReminder = useRestReminder(data?.sessions.find(isDraft), writable, () =>
    notify('休息结束，可以开始下一组。'),
  );
  const go = (next: Page) => {
    location.hash = `/${next}`;
    navigate(next);
  };
  function navigate(next: Page) {
    if (intendedPage.current === next) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    intendedPage.current = next;
    let motion: 'native' | 'fallback' = 'native';
    withViewTransition(
      () => {
        // Select entry roles against the destination's first viewport, also in the synchronous fallback.
        window.scrollTo({ top: 0, behavior: 'instant' });
        flushSync(() => {
          setPageMotion(motion);
          setPage(next);
        });
      },
      () => {
        motion = 'fallback';
      },
    );
  }
  useEffect(() => {
    const change = () => {
      navigate(getPage());
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (data) {
      document.documentElement.dataset.theme = data.settings.theme;
      document
        .querySelector('meta[name=theme-color]')
        ?.setAttribute('content', data.settings.theme === 'dark' ? '#0A0C0A' : '#FAFAF9');
    }
  }, [data?.settings.theme]);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const change = () => setOnline(navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);

  if (!data)
    return (
      <main className="main loading-screen" aria-busy={status === 'loading'}>
        <span className="brand-mark">
          <Icon name="dumbbell" />
        </span>
        <h1>健力宝</h1>
        {status === 'loading' ? (
          <>
            <p className="muted" role="status">
              正在打开本机训练记录…
            </p>
            <LoadingSkeleton />
          </>
        ) : (
          <>
            <p role="alert" className="error-text">
              {error}
            </p>
            <p>未改动现有数据。请确认浏览器允许本地存储后重试。</p>
            <button className="btn btn-primary" onClick={() => void workspace.reload()}>
              重新打开本地数据
            </button>
          </>
        )}
      </main>
    );
  const active = data.sessions.find(isDraft);
  const completed = data.sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const templates = data.templates.filter((t) => !t.archived);
  const date = new Date();
  const monthSessions = completed.filter((s) => s.date.startsWith(localDate(date).slice(0, 7)));
  const monthlySeconds = monthSessions.reduce((n, s) => n + sessionStats(s).activeSeconds, 0);
  const monthlySets = monthSessions.reduce((n, s) => n + sessionStats(s).completedSets, 0);
  const updateSession = (fn: (session: Session) => Session) =>
    mutate((d) => {
      const latest = d.sessions.find((s) => s.id === active?.id);
      if (!latest || !isDraft(latest)) throw new Error('这场训练已归档，请到历史查看');
      return { ...d, sessions: d.sessions.map((s) => (s.id === latest.id ? fn(s) : s)) };
    });
  const begin = async () => {
    if (!startTemplate) return;
    if (active) {
      setStartTemplate(null);
      go('workout');
      return;
    }
    const template = startTemplate === 'free' ? null : startTemplate;
    const ok = await mutate((d) => {
      if (d.sessions.some(isDraft)) throw new Error('请先继续已有草稿');
      const session = createSession(template, d.exercises);
      session.exercises = session.exercises.map((item) => seedExercise(item, d.sessions, session.date, session.id));
      if (!template) session.restDuration = d.settings.defaultRest;
      return { ...d, onboarded: true, sessions: [...d.sessions, session] };
    });
    setStartTemplate(null);
    if (ok) go('workout');
  };
  const exportCurrent = async () => {
    try {
      const result = await downloadBackup(data);
      if (result === 'cancelled' || result === 'busy') { notify(result === 'cancelled' ? '已取消分享，记录仍保存在本机' : '请先完成当前分享'); return; }
      if (result === 'shared') { notify('备份已交给系统分享，请确认保存到所选位置'); return; }
      notify(
        status === 'error' || status === 'conflict'
          ? '当前页面记录已导出，请确认下载完成'
          : '备份已生成，请确认下载完成',
      );
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const openStart = (t: WorkoutTemplate | 'free') => {
    setToast('');
    setStartTemplate(t);
  };
  function useExercise(exercise: Exercise) {
    if (active) {
      if (active.status !== 'active') {
        go('workout');
        notify('先恢复或归档当前训练，再加入动作');
        return;
      }
      if (active.exercises.length >= 30) {
        notify('单场最多30个动作，请先完成当前训练');
        return;
      }
      void updateSession((s) => ({
        ...s,
        exercises: [...s.exercises, seedExercise(createSessionExercise(exercise), data!.sessions, s.date, s.id)],
        updatedAt: new Date().toISOString(),
      }));
      go('workout');
      return;
    }
    openStart({
      id: uid(),
      name: exercise.name,
      description: '从这个动作开始，可继续添加其他动作。',
      restSeconds: data!.settings.defaultRest,
      updatedAt: new Date().toISOString(),
      items: [{ id: uid(), exerciseId: exercise.id, sets: 3, weightKg: 0, reps: 10, durationSeconds: 30 }],
    });
  }
  async function repeatSession(session: Session) {
    if (active) {
      setStartTemplate('free');
      return;
    }
    const items = session.exercises.filter((ex) => ex.sets.some((s) => s.status === 'completed'));
    const snapshots = [...new Map(items.map((ex) => [ex.exercise.id, ex.exercise])).values()];
    if (items.some((ex) => !data!.exercises.some((e) => e.id === ex.exercise.id))) {
      const ok = await mutate((d) => ({
        ...d,
        exercises: [...d.exercises, ...snapshots.filter((ex) => !d.exercises.some((e) => e.id === ex.id))],
      }));
      if (!ok) return;
    }
    openStart({
      id: uid(),
      name: `${session.name.slice(0, 100)} · 复练`,
      description: `来自 ${session.date}，上次结果作为待确认目标，不会自动算成已完成。`,
      restSeconds: session.restDuration,
      updatedAt: new Date().toISOString(),
      items: items.map((ex) => {
        const sets = ex.sets.filter((s) => s.status === 'completed' && isWorkSet(s));
        const last = sets.at(-1) ?? ex.sets.find((s) => s.status === 'completed')!;
        return {
          id: uid(),
          exerciseId: ex.exercise.id,
          sets: Math.min(30, Math.max(1, sets.length)),
          weightKg: last.weightKg,
          reps: last.reps || 10,
          durationSeconds: last.durationSeconds || 30,
        };
      }),
    });
  }

  return (
    <AppShell
      pageMotion={pageMotion}
      page={page}
      active={active}
      data={data}
      online={online}
      workspace={workspace}
      mainRef={mainRef}
      go={go}
      exportCurrent={exportCurrent}
      onReload={() => setConfirmReload(true)}
      overlays={
        <>
          <Presence interruptKey={page}>
            {startTemplate && (
              <Modal
                title={active ? '继续已有训练' : startTemplate === 'free' ? '开始自由训练' : startTemplate.name}
                onClose={() => setStartTemplate(null)}
                footer={
                  <>
                    <button className="btn btn-secondary" onClick={() => setStartTemplate(null)}>
                      暂不开始
                    </button>
                    <button className="btn btn-primary" disabled={!writable} onClick={() => void begin()}>
                      {active ? '继续已有训练' : '确认开始训练'}
                      <Icon name="arrow" />
                    </button>
                  </>
                }
              >
                {active ? (
                  <p>本机有未完成的“{active.name}”。先继续、归档或明确取消它，再开始另一场。</p>
                ) : startTemplate === 'free' ? (
                  <p>自由加入动作，按实际情况记录。有效修改会自动保存到本机。</p>
                ) : (
                  <>
                    <p className="muted">{startTemplate.description}</p>
                    <div className="exercise-list">
                      {startTemplate.items.map((item) => (
                        <div className="exercise-row" key={item.id}>
                          <strong>{data.exercises.find((e) => e.id === item.exerciseId)?.name}</strong>
                          <span>{item.sets} 组</span>
                        </div>
                      ))}
                    </div>
                    <p className="notice">
                      模板是起点：训练中可以临时调整动作、组数与重量。请按自己的实际能力记录，目标不会自动算成完成。
                    </p>
                  </>
                )}
              </Modal>
            )}
          </Presence>
          <Presence interruptKey={page}>
            {templateEditor && (
              <TemplateEditor
                data={data}
                template={templateEditor === 'new' ? undefined : templateEditor}
                onClose={() => setTemplateEditor(null)}
                onSave={(t) =>
                  mutate((d) => ({
                    ...d,
                    templates: d.templates.some((x) => x.id === t.id)
                      ? d.templates.map((x) => (x.id === t.id ? t : x))
                      : [...d.templates, t],
                  }))
                }
              />
            )}
          </Presence>
          <Presence interruptKey={page}>
            {exerciseEditor && (
              <ExerciseEditor
                onClose={() => setExerciseEditor(false)}
                onSave={(ex) => {
                  if (data.exercises.some((e) => e.name.toLowerCase() === ex.name.toLowerCase())) {
                    notify('已有同名动作，请用器械或动作形式区分名称');
                    return Promise.resolve(false);
                  }
                  return mutate((d) => ({ ...d, exercises: [...d.exercises, ex] }));
                }}
              />
            )}
          </Presence>
          <Presence interruptKey={page}>
            {exerciseInfo && <ExerciseInfo exercise={exerciseInfo} data={data} onClose={() => setExerciseInfo(null)} />}
          </Presence>
          <Presence interruptKey={page}>
            {archiveTemplate && (
              <Modal
                title="归档这个模板？"
                onClose={() => setArchiveTemplate(null)}
                footer={
                  <>
                    <button className="btn btn-secondary" onClick={() => setArchiveTemplate(null)}>
                      取消
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={async () => {
                        if (
                          await mutate((d) => ({
                            ...d,
                            templates: d.templates.map((t) =>
                              t.id === archiveTemplate.id
                                ? { ...t, archived: true, updatedAt: new Date().toISOString() }
                                : t,
                            ),
                          }))
                        )
                          setArchiveTemplate(null);
                      }}
                    >
                      确认归档模板
                    </button>
                  </>
                }
              >
                <p>从可选训练中移除“{archiveTemplate.name}”。已有历史和本场训练不受影响，可从“已归档模板”恢复。</p>
              </Modal>
            )}
          </Presence>
          <Presence interruptKey={page}>
            {confirmReload && (
              <Modal
                title="载入已保存版本？"
                onClose={() => setConfirmReload(false)}
                footer={
                  <>
                    <button className="btn btn-secondary" onClick={() => setConfirmReload(false)}>
                      返回并保留当前输入
                    </button>
                    <button className="btn btn-secondary" onClick={exportCurrent}>
                      先导出当前记录
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={async () => {
                        await workspace.reload();
                        setConfirmReload(false);
                      }}
                    >
                      确认载入
                    </button>
                  </>
                }
              >
                <p>当前页面中尚未成功写入的修改会被替换。建议先导出当前记录，再载入本机最近成功保存的版本。</p>
              </Modal>
            )}
          </Presence>
          <Toast message={toast} />
        </>
      }
    >
      {page === 'today' && (
        <TodayPage
          data={data}
          active={active}
          completed={completed}
          templates={templates}
          monthSessions={monthSessions}
          monthlySeconds={monthlySeconds}
          monthlySets={monthlySets}
          writable={writable}
          go={go}
          openStart={openStart}
          setTemplateEditor={setTemplateEditor}
        />
      )}
      {page === 'plans' && (
        <PlansPage
          data={data}
          templates={templates}
          showArchived={showArchived}
          writable={writable}
          mutate={mutate}
          openStart={openStart}
          setTemplateEditor={setTemplateEditor}
          setArchiveTemplate={setArchiveTemplate}
          setShowArchived={setShowArchived}
        />
      )}
      {page === 'exercises' && (
        <ExerciseLibrary
          data={data}
          writable={writable}
          mutate={mutate}
          onCreate={() => setExerciseEditor(true)}
          onUse={useExercise}
        />
      )}
      {page === 'progress' && (
        <History
          data={data}
          writable={writable}
          notify={notify}
          mutate={mutate}
          onRepeat={repeatSession}
          onTrain={() => go('plans')}
          onExercise={setExerciseInfo}
        />
      )}
      {page === 'settings' && <BackupSettings data={data} writable={writable} mutate={mutate} retry={workspace.retry} notify={notify} cloud={cloud} />}
      {page === 'workout' &&
        (active ? (
          <Workout
            restReminder={restReminder}
            key={`${active.id}-${workspace.loadEpoch}`}
            data={data}
            session={active}
            writable={writable}
            update={updateSession}
            goHome={() => go('today')}
            finish={async () => {
              const ok = await updateSession((s) => completeSession(s));
              if (ok) {
                go('progress');
                notify('训练已保存到本机，历史与统计已更新');
              }
              return ok;
            }}
            cancel={async () => {
              const ok = await updateSession((s) => {
                return { ...reviewSession(s), status: 'cancelled' };
              });
              if (ok) {
                go('today');
                notify('训练已取消，其他历史记录保留');
              }
              return ok;
            }}
          />
        ) : (
          <section className="card empty-state">
            <h2>还没有进行中的训练</h2>
            <p>选择模板，或从自由训练开始。</p>
            <button className="btn btn-primary" onClick={() => go('plans')}>
              选择训练
            </button>
          </section>
        ))}
    </AppShell>
  );
}
