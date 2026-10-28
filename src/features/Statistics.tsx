import { muscleLabel } from '../content/body-map';
import { useEffect, useState } from 'react';
import type { AppData, Session, Exercise } from '../domain/types';
import {
  dayKey,
  shiftDate,
  dateSpan,
  periodBounds,
  periodSeries,
  inPeriod,
  totals,
  muscleBalance,
  personalRecords,
  exercisePerformance,
  canEstimate1RM,
  type Period,
} from '../domain/analytics';
import { displayWeight } from '../domain/units';
import Icon from '../components/Icon';
import TrendChart from '../components/TrendChart';
import { downloadCsv } from './TrainingJournal';
import MetricsRow from './progress/MetricsRow';
import TrendPanel from './progress/TrendPanel';
import MuscleBalance from './progress/MuscleBalance';
import Heatmap from './progress/Heatmap';
import RecordsList from './progress/RecordsList';
import Breakdown from './progress/Breakdown';

export default function Statistics({
  data,
  view,
  sessions,
  trained,
  onSession,
  onDate,
  onExercise,
  onTrain,
  onView,
  notify,
}: {
  data: AppData;
  view: string;
  sessions: Session[];
  trained: Exercise[];
  onSession: (s: Session) => void;
  onDate: (date: string) => void;
  onExercise: (ex: Exercise) => void;
  onTrain: () => void;
  onView: (view: string) => void;
  notify: (message: string) => void;
}) {
  const today = dayKey(new Date());
  const [period, setPeriod] = useState<Period>('30');
  const [custom, setCustom] = useState({ from: shiftDate(today, -29), to: today });
  const [metric, setMetric] = useState('volume');
  const [recordLimit, setRecordLimit] = useState(3);
  useEffect(() => {
    setRecordLimit(3);
  }, [period, custom.from, custom.to]);
  const [exerciseId, setExerciseId] = useState('');
  const [exerciseMetric, setExerciseMetric] = useState('weight');
  const exercise = trained.find((ex) => ex.id === exerciseId) ?? trained[0];
  const bounds = periodBounds(period, today, sessions, custom);
  const invalid = !bounds.from || !bounds.to || bounds.from > bounds.to;
  const selected = invalid ? [] : inPeriod(sessions, bounds.from, bounds.to);
  const summary = totals(selected);
  const days = invalid ? 0 : dateSpan(bounds.from, bounds.to);
  const previous =
    period === 'all' || invalid
      ? null
      : totals(inPeriod(sessions, shiftDate(bounds.from, -days), shiftDate(bounds.from, -1)));
  const muscles = muscleBalance(selected);
  const muscleSets = muscles.reduce((n, m) => n + m.sets, 0);
  const records = personalRecords(sessions).filter((r) => r.date >= bounds.from && r.date <= bounds.to);
  const series = invalid ? [] : periodSeries(sessions, bounds.from, bounds.to);
  const unit = data.settings.unit;
  const volume = (kg: number) =>
    `${displayWeight(kg, unit).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ${unit}·次`;
  const performance = exercise ? exercisePerformance(selected, exercise.id, exercise.kind) : [];
  const value = (p: (typeof performance)[number]) =>
    exercise?.kind === 'duration'
      ? p.maxDuration
      : exercise?.kind === 'reps'
        ? p.maxReps
        : exerciseMetric === 'volume'
          ? p.volumeKg
          : exerciseMetric === 'e1rm'
            ? p.e1rmKg
            : p.maxWeightKg;
  const format = (n: number) =>
    exercise?.kind === 'duration'
      ? `${n} 秒`
      : exercise?.kind === 'reps'
        ? `${n} 次`
        : exerciseMetric === 'volume'
          ? volume(n)
          : `${displayWeight(n, unit)} ${unit}`;
  return (
    <div className="statistics-page">
      <div className="analytics-toolbar">
        <div className="period-options" role="group" aria-label="统计周期">
          {[
            ['7', '近7天'],
            ['30', '近30天'],
            ['90', '近90天'],
            ['365', '近一年'],
            ['all', '全部'],
            ['custom', '自定义'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={period === id ? 'active' : ''}
              aria-pressed={period === id}
              onClick={() => setPeriod(id as Period)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="period-caption">
        {bounds.from} — {bounds.to}
        {period !== 'all' ? ' · 与之前等长周期比较' : ' · 全部历史累计'}
      </p>
      {period === 'custom' && (
        <div className="custom-range">
          <label>
            开始日期
            <input
              type="date"
              className="form-input"
              value={custom.from}
              min="1970-01-01"
              max="2100-01-01"
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            />
          </label>
          <span>至</span>
          <label>
            结束日期
            <input
              type="date"
              className="form-input"
              value={custom.to}
              min="1970-01-01"
              max="2100-01-01"
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            />
          </label>
        </div>
      )}
      {invalid ? (
        <p className="notice error-text" role="alert">
          请选择有效的日期范围，开始日期不能晚于结束日期。
        </p>
      ) : view === 'stats' ? (
        <>
          <MetricsRow summary={summary} previous={previous} unit={unit} />
          <div className="progress-trend-section">
            <TrendPanel
              selected={selected}
              series={series}
              metric={metric}
              setMetric={setMetric}
              days={days}
              volume={volume}
            />
          </div>
          <div className="progress-distribution-section">
            <MuscleBalance muscles={muscles} muscleSets={muscleSets} />
            <Heatmap sessions={sessions} today={today} onDate={onDate} />
          </div>
          <div className="progress-records-section">
            <RecordsList
              records={records}
              recordLimit={recordLimit}
              setExerciseId={setExerciseId}
              setExerciseMetric={setExerciseMetric}
              onView={onView}
              setRecordLimit={setRecordLimit}
              unit={unit}
            />
          </div>
          <Breakdown summary={summary} />
        </>
      ) : (
        <section className="card exercise-analysis">
          <div className="exercise-analysis-heading">
            <div>
              <h3>追踪一个动作的变化。</h3>
            </div>
            <select
              className="form-select"
              aria-label="趋势动作"
              value={exercise?.id ?? ''}
              onChange={(e) => {
                setExerciseId(e.target.value);
                setExerciseMetric('weight');
              }}
            >
              {!trained.length && <option value="">还没有正式组记录</option>}
              {trained.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
          </div>
          {exercise ? (
            <>
              <div className="analysis-action-meta">
                <span className="tag">
                  {muscleLabel(exercise)} · {exercise.equipment}
                </span>
                <button className="text-button" onClick={() => onExercise(exercise)}>
                  查看动作讲解 ↗
                </button>
              </div>
              {exercise.kind === 'weight-reps' && !canEstimate1RM(exercise) && (
                <p className="chart-caption">此动作包含自重承重，仅追踪实际外部负重，不估算整体 1RM。</p>
              )}
              {exercise.kind === 'weight-reps' && (
                <div className="segmented analysis-metrics" role="group" aria-label="动作趋势指标">
                  {[
                    ['weight', '最高重量'],
                    ['volume', '每场容量'],
                    ['e1rm', '估算 1RM'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      aria-pressed={exerciseMetric === id}
                      disabled={id === 'e1rm' && !canEstimate1RM(exercise)}
                      className={exerciseMetric === id ? 'active' : ''}
                      onClick={() => setExerciseMetric(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <TrendChart
                title="单动作趋势"
                points={performance
                  .filter((p) => value(p) !== null)
                  .map((p) => ({ date: p.date, label: `${p.date} · ${p.name}`, value: value(p)! }))}
                format={format}
                empty="所选周期没有符合口径的正式组"
              />
              {exerciseMetric === 'e1rm' && exercise.kind === 'weight-reps' && (
                <p className="notice">
                  Epley 估算：重量 × (1 + 次数 / 30)，只采用 1–10 次正式组；1
                  次时取实际重量。只是趋势参考，不是测得的极限重量或下次训练处方。
                </p>
              )}
              <div className="performance-table">
                <table>
                  <caption>本周期实际完成记录</caption>
                  <thead>
                    <tr>
                      <th>日期 / 训练</th>
                      <th>正式组</th>
                      <th>
                        {exercise.kind === 'weight-reps'
                          ? '最高重量'
                          : exercise.kind === 'duration'
                            ? '最长单组'
                            : '最多单组'}
                      </th>
                      {exercise.kind === 'weight-reps' && <th>场次容量</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {[...performance].reverse().map((p) => (
                      <tr key={p.sessionId}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => onSession(sessions.find((s) => s.id === p.sessionId)!)}
                          >
                            {p.date}
                            <small>{p.name}</small>
                          </button>
                        </td>
                        <td>{p.sets}</td>
                        <td>
                          {exercise.kind === 'weight-reps'
                            ? `${displayWeight(p.maxWeightKg, unit)} ${unit}`
                            : exercise.kind === 'duration'
                              ? `${p.maxDuration} 秒`
                              : `${p.maxReps} 次`}
                        </td>
                        {exercise.kind === 'weight-reps' && <td>{volume(p.volumeKg)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <Icon name="chart" size={24} />
              <h2>先留下第一条正式组记录。</h2>
              <p>重量、次数和时长分别追踪，不混在一起比较。</p>
              <button className="btn btn-primary" onClick={onTrain}>
                去开始训练
              </button>
            </div>
          )}
        </section>
      )}
      <div className="statistics-export">
        <button
          className="btn btn-ghost"
          disabled={!selected.length}
          onClick={async () => {
            try {
              const result = await downloadCsv(selected);
              if (result !== 'downloaded')
                notify(
                  result === 'shared'
                    ? '训练明细已交给系统分享，请确认保存到所选位置'
                    : result === 'cancelled'
                      ? '已取消分享，记录仍保存在本机'
                      : '请先完成当前分享',
                );
            } catch (error) {
              notify(error instanceof Error ? error.message : '导出失败，请重试');
            }
          }}
        >
          <Icon name="download" size={16} />
          导出本期 CSV
        </button>
      </div>
    </div>
  );
}
