import { useState } from 'react';
import Icon from './Icon';
export interface ChartPoint {
  date: string;
  value: number;
  label?: string;
}
export default function TrendChart({
  points,
  title,
  format,
  empty = '这段时间还没有可绘制的记录',
  emptyHint = '实际完成后，这里会留下第一条数据。',
}: {
  points: ChartPoint[];
  title: string;
  format: (value: number) => string;
  empty?: string;
  emptyHint?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  if (!points.length)
    return (
      <div className="chart-empty">
        <Icon name="chart" size={24} />
        <p>{empty}</p>
        <small>{emptyHint}</small>
      </div>
    );
  const index = Math.min(selected ?? points.length - 1, points.length - 1);
  const active = points[index];
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number) => (points.length === 1 ? 300 : 36 + (i / (points.length - 1)) * 528);
  const y = (v: number) => 160 - (v / max) * 124;
  const coords = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  return (
    <div className="interactive-chart">
      <div className="chart-readout">
        <div>
          <small className="truncate">{active.label ?? active.date}</small>
          <strong>{format(active.value)}</strong>
        </div>
        <div className="row">
          <button
            className="icon-button"
            aria-label={`${title}上一条`}
            disabled={!index}
            onClick={() => setSelected(index - 1)}
          >
            <Icon name="back" size={16} />
          </button>
          <button
            className="icon-button"
            aria-label={`${title}下一条`}
            disabled={index === points.length - 1}
            onClick={() => setSelected(index + 1)}
          >
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </div>
      <svg
        className="line-chart"
        viewBox="0 0 600 194"
        role="group"
        aria-label={`${title}，${points.length}个数据点，纵轴从0开始`}
      >
        {[0, 0.5, 1].map((v) => (
          <line key={v} x1="26" x2="574" y1={y(max * v)} y2={y(max * v)} className="chart-gridline" />
        ))}
        {points.length > 1 && (
          <>
            <polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </>
        )}
        {points.map((p, i) => (
          <circle
            key={`${p.date}-${i}`}
            cx={x(i)}
            cy={y(p.value)}
            r={i === index ? 6 : 4}
            className={`chart-point ${i === index ? 'selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${p.label ?? p.date}，${format(p.value)}`}
            aria-pressed={i === index}
            onClick={() => setSelected(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelected(i);
              }
            }}
          />
        ))}
        <text x="30" y="186">
          {points[0].date.slice(5)}
        </text>
        <text x="570" y="186" textAnchor="end">
          {points.at(-1)!.date.slice(5)}
        </text>
      </svg>
      <details className="chart-data">
        <summary>查看数据明细 · {points.length} 条</summary>
        <div className="chart-data-list">
          {points.map((p, i) => (
            <button key={`${p.date}-${i}`} className={index === i ? 'selected' : ''} onClick={() => setSelected(i)}>
              <span>{p.label ?? p.date}</span>
              <strong>{format(p.value)}</strong>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
