import type { AppData } from '../../domain/types';
import type { totals } from '../../domain/analytics';
import { displayWeight } from '../../domain/units';

export default function MetricsRow({
  summary,
  previous,
  unit,
}: {
  summary: ReturnType<typeof totals>;
  previous: ReturnType<typeof totals> | null;
  unit: AppData['settings']['unit'];
}) {
  return (
    <section className="analytics-overview" aria-label="训练概况">
      <h2>训练概况</h2>
      <div className="analytics-metrics">
        <Metric
          label="完成训练"
          value={String(summary.sessions)}
          unit="场"
          current={summary.sessions}
          previous={previous?.sessions}
        />
        <Metric
          label="正式组重量容量"
          value={displayWeight(summary.volumeKg, unit).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
          unit={`${unit}·次`}
          current={summary.volumeKg}
          previous={previous?.volumeKg}
        />
        <Metric
          label="累计训练时长"
          value={String(Math.floor(summary.seconds / 60))}
          unit="分钟"
          current={summary.seconds}
          previous={previous?.seconds}
        />
        <Metric
          label="实际训练天数"
          value={String(summary.days)}
          unit="天"
          current={summary.days}
          previous={previous?.days}
        />
      </div>
    </section>
  );
}
function Metric({
  label,
  value,
  unit,
  current,
  previous,
}: {
  label: string;
  value: string;
  unit: string;
  current: number;
  previous?: number;
}) {
  const delta =
    previous === undefined
      ? null
      : previous === 0
        ? current
          ? '本期开始有记录'
          : '上期也暂无记录'
        : `${current >= previous ? '+' : ''}${Math.round(((current - previous) / previous) * 100)}% 较上期`;
  return (
    <section className="analytics-metric">
      <p className="truncate" title={label}>{label}</p>
      <strong>
        <span className="metric-number">{value}</span>
        <small>{unit}</small>
      </strong>
      <span>{delta ?? '全部历史累计'}</span>
    </section>
  );
}
