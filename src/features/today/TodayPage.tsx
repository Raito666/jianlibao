import { muscleLabel } from '../../content/body-map';
import type { AppData, Session, WorkoutTemplate } from '../../domain/types';
import { sessionStats } from '../../domain/training';
import { localDate } from '../History';
import type { Page } from '../../app/navigation';
import Icon from '../../components/Icon';
type Props = {
  data: AppData;
  active?: Session;
  completed: Session[];
  templates: WorkoutTemplate[];
  monthSessions: Session[];
  monthlySeconds: number;
  monthlySets: number;
  writable: boolean;
  go: (page: Page) => void;
  openStart: (template: WorkoutTemplate | 'free') => void;
  setTemplateEditor: (template: WorkoutTemplate | 'new') => void;
};
export default function TodayPage({
  data,
  active,
  completed,
  templates,
  monthSessions,
  monthlySeconds,
  monthlySets,
  writable,
  go,
  openStart,
  setTemplateEditor,
}: Props) {
  return (
    <>
      {active && (
        <div className="recovery-banner">
          <div>
            <span className="tag">未完成训练</span>
            <h2 className="truncate" title={active.name}>{active.name}</h2>
            <p>
              {sessionStats(active).completedSets} 组已完成 · 上次更新{' '}
              {new Date(active.updatedAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => go('workout')}>
            继续训练
            <Icon name="arrow" />
          </button>
        </div>
      )}
      <div className="home-grid">
        <div className="home-main">
          <section className="hero">
            <div className="hero-copy">
              <h2>{active ? '把这一场练好。' : '把今天练好。'}</h2>
              <p className="truncate">
                {active
                  ? `${active.name} · 记录还在，随时继续`
                  : templates[0]
                    ? `${templates[0].name} · ${templates[0].items.length} 个动作`
                    : '从自由训练开始，留下第一组。'}
              </p>
              <button
                className="btn btn-primary"
                disabled={!writable}
                onClick={() => (active ? go('workout') : openStart(templates[0] ?? 'free'))}
              >
                {active ? '继续未完成训练' : templates[0] ? '开始今天的训练' : '开始自由训练'}
                <Icon name="arrow" />
              </button>
              <button className="hero-link" onClick={() => go('plans')}>
                查看 / 调整训练模板 ↗
              </button>
            </div>
            <div className="hero-art" aria-hidden="true">
              <span className="barbell" />
            </div>
          </section>
          <section className="stats" aria-label="本月训练概览">
            <div className="stat">
              <strong className="stat-value">
                {monthSessions.length}
                <small>次</small>
              </strong>
              <span className="stat-label truncate" title="本月完成训练">本月完成训练</span>
            </div>
            <div className="stat">
              <strong className="stat-value">
                {Math.round(monthlySeconds / 360) / 10}
                <small>小时</small>
              </strong>
              <span className="stat-label truncate" title="实际训练时长">实际训练时长</span>
            </div>
            <div className="stat">
              <strong className="stat-value">
                {monthlySets}
                <small>组</small>
              </strong>
              <span className="stat-label truncate" title="本月完成组">本月完成组</span>
            </div>
          </section>
          <section className="card">
            <div className="section-heading">
              <h2 className="truncate">{templates[0]?.name ?? '我的第一份模板'}</h2>
              <button className="btn btn-ghost" onClick={() => go('plans')}>
                更换模板 ↗
              </button>
            </div>
            {templates[0]?.items.map((item) => {
              const ex = data.exercises.find((e) => e.id === item.exerciseId)!;
              return (
                <div className="exercise-row" key={item.id}>
                  <span className="exercise-icon">
                    <Icon name="dumbbell" />
                  </span>
                  <div>
                    <strong className="line-clamp-2 wrap-cjk" title={ex.name}>{ex.name}</strong>
                    <small className="truncate">
                      {muscleLabel(ex)} · {ex.equipment}
                    </small>
                  </div>
                  <span className="exercise-meta">
                    {item.sets} 组 × {ex.kind === 'duration' ? `${item.durationSeconds} 秒` : `${item.reps} 次`}
                  </span>
                </div>
              );
            }) ?? (
              <div className="empty-state">
                <p>先创建一份适合自己的训练日模板。</p>
                <button className="btn btn-secondary" disabled={!writable} onClick={() => setTemplateEditor('new')}>
                  新建模板
                </button>
              </div>
            )}
          </section>
        </div>
        <aside className="home-side">
          <button className="home-atlas-link" onClick={() => go('exercises')}>
            <Icon name="target" size={24} />
            <span>
              <strong>按身体部位找动作</strong>
              <small>点选肌群 · 查看要点 · 加入训练</small>
            </span>
            <Icon name="arrow" size={16} />
          </button>
          <Week sessions={completed} />
          <section className="card">
            <h3>一点一点，变强。</h3>
            {completed[0] ? (
              <>
                <p className="latest-date">{completed[0].date}</p>
                <h2 className="truncate" title={completed[0].name}>{completed[0].name}</h2>
                <p className="muted">
                  {sessionStats(completed[0]).completedSets} 组 ·{' '}
                  {Math.floor(sessionStats(completed[0]).activeSeconds / 60)} 分钟
                </p>
                <button className="btn btn-ghost" onClick={() => go('progress')}>
                  回看训练记录 ↗
                </button>
              </>
            ) : (
              <div className="empty-state compact">
                <Icon name="chart" size={24} />
                <p>
                  还没有归档训练。
                  <br />
                  从第一组开始，记录自己的节奏。
                </p>
              </div>
            )}
          </section>
          <div className="notice">
            <Icon name="shield" />
            <div>
              <strong>本机保存，数据可带走。</strong>
              <p>无需账号。完成训练后，可以在“我”中导出备份。</p>
              <button className="btn btn-ghost" onClick={() => go('settings')}>
                数据与备份 ↗
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
function Week({ sessions }: { sessions: Session[] }) {
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return day;
  });
  const count = sessions.filter((s) => s.date >= localDate(days[0]) && s.date <= localDate(days[6])).length;
  return (
    <section className="card">
      <div className="section-heading">
        <h3>本周节奏</h3>
        <span className="tag">
          {days[0].getMonth() + 1}.{days[0].getDate()} — {days[6].getMonth() + 1}.{days[6].getDate()}
        </span>
      </div>
      <div className="week-grid">
        {days.map((day, i) => (
          <div
            className={`week-day ${localDate(day) === localDate(today) ? 'active' : ''} ${sessions.some((s) => s.date === localDate(day)) ? 'done' : ''}`}
            key={i}
          >
            <span>{'一二三四五六日'[i]}</span>
            <strong>{day.getDate()}</strong>
          </div>
        ))}
      </div>
      <div className="section-heading section-spacer">
        <span className="muted">本周已完成</span>
        <strong>{count} 场训练</strong>
      </div>
    </section>
  );
}
