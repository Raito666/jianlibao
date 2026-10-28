import { muscleLabel } from '../../content/body-map';
import type { Session } from '../../domain/types';
import { sessionStats } from '../../domain/training';
import Icon from '../../components/Icon';
import { useRef } from 'react';
import { useListMotion } from '../../motion/presentation';

export default function SessionList({
  list,
  sessions,
  setSelected,
  volume,
  setSearch,
  setDate,
  setHistoryExercise,
  setAllHistory,
  onTrain,
}: {
  list: Session[];
  sessions: Session[];
  setSelected: (session: Session) => void;
  volume: (kg: number) => string;
  setSearch: (value: string) => void;
  setDate: (value: string) => void;
  setHistoryExercise: (value: string) => void;
  setAllHistory: (value: boolean) => void;
  onTrain: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useListMotion(ref, list.map((session) => session.id).join('|'), ':scope > .session-card');
  return list.length ? (
    <div className="session-timeline" ref={ref}>
      {list.map((s) => {
        const stat = sessionStats(s);
        return (
          <button
            key={s.id}
            className="session-card"
            aria-label={`查看${s.name} ${s.date}训练明细，${stat.completedSets}组，${Math.floor(stat.activeSeconds / 60)}分钟`}
            onClick={() => setSelected(s)}
          >
            <span className="session-date">
              <strong>{s.date.slice(8)}</strong>
              <small>{s.date.slice(0, 7)}</small>
            </span>
            <span className="session-card-body">
              <span className="session-card-title">
                <strong className="truncate" title={s.name}>{s.name}</strong>
                <Icon name="arrow" size={16} />
              </span>
              <span className="session-muscle-tags">
                {[
                  ...new Set(
                    s.exercises
                      .filter((ex) => ex.sets.some((set) => set.status === 'completed'))
                      .map((ex) => muscleLabel(ex.exercise)),
                  ),
                ]
                  .slice(0, 4)
                  .map((m) => (
                    <i key={m} className="truncate" title={m}>{m}</i>
                  ))}
              </span>
              <span className="session-card-numbers">
                <span>
                  <Icon name="clock" size={16} />
                  {Math.floor(stat.activeSeconds / 60)} 分钟
                </span>
                <span>{stat.completedSets} 组</span>
                <span>
                  {stat.volumeKg
                    ? volume(stat.volumeKg)
                    : s.exercises.some((ex) => ex.exercise.kind === 'weight-reps')
                      ? volume(0)
                      : '次数 / 时长训练'}
                </span>
              </span>
              {s.note && <span className="session-note truncate">“{s.note}”</span>}
            </span>
          </button>
        );
      })}
    </div>
  ) : (
    <section className="card empty-state">
      <Icon name="calendar" size={24} />
      <h2>{sessions.length ? '这次筛选还没有训练记录' : '第一场训练，从今天开始。'}</h2>
      <p>
        {sessions.length
          ? '换一个日期或关键词，继续寻找自己的训练足迹。'
          : '完成并保存后，训练明细与统计会自动出现在这里。'}
      </p>
      <button
        className="btn btn-primary"
        onClick={
          sessions.length
            ? () => {
                setSearch('');
                setDate('');
                setHistoryExercise('all');
                setAllHistory(true);
              }
            : onTrain
        }
      >
        {sessions.length ? '查看全部记录' : '去开始训练'}
      </button>
    </section>
  );
}
