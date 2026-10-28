import type { Session } from '../../domain/types';
import type { periodSeries } from '../../domain/analytics';
import TrendChart from '../../components/TrendChart';

export default function TrendPanel({
  selected,
  series,
  metric,
  setMetric,
  days,
  volume,
}: {
  selected: Session[];
  series: ReturnType<typeof periodSeries>;
  metric: string;
  setMetric: (value: string) => void;
  days: number;
  volume: (kg: number) => string;
}) {
  return (
    <section className="card analytics-trend">
      <div className="section-heading">
        <div>
          <h3>把训练，看成一条长线。</h3>
        </div>
        <select
          className="form-select"
          aria-label="训练趋势指标"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
        >
          <option value="volume">重量容量</option>
          <option value="sets">正式组数</option>
          <option value="sessions">训练次数</option>
          <option value="minutes">训练时长</option>
        </select>
      </div>
      <TrendChart
        title="训练趋势"
        points={(selected.length ? series : []).map((p) => ({
          date: p.date,
          value:
            metric === 'volume'
              ? p.volumeKg
              : metric === 'sets'
                ? p.sets
                : metric === 'sessions'
                  ? p.sessions
                  : p.seconds / 60,
        }))}
        format={(n) =>
          metric === 'volume'
            ? volume(n)
            : `${Math.round(n * 10) / 10} ${metric === 'sets' ? '组' : metric === 'sessions' ? '场' : '分钟'}`
        }
      />
      <p className="chart-caption">
        {days <= 31 ? '按天' : days <= 366 ? '每7天' : '按有记录的月份'}汇总 · 已归档训练 · 正式组容量不含热身
      </p>
    </section>
  );
}
