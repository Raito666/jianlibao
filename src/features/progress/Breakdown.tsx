import type { totals } from '../../domain/analytics';

export default function Breakdown({ summary }: { summary: ReturnType<typeof totals> }) {
  return (
    <section className="card training-breakdown">
      <h3>不同训练，各有记录。</h3>
      <div>
        <span>正式组</span>
        <strong>
          {summary.sets}
          <small>组</small>
        </strong>
      </div>
      <div>
        <span>自重 / 次数类</span>
        <strong>
          {summary.bodyweightReps}
          <small>次</small>
        </strong>
      </div>
      <div>
        <span>计时类完成量</span>
        <strong>
          {summary.durationSeconds}
          <small>秒</small>
        </strong>
      </div>
      <div>
        <span>平均每场用时</span>
        <strong>
          {summary.sessions ? Math.round(summary.seconds / summary.sessions / 60) : 0}
          <small>分钟</small>
        </strong>
      </div>
      <p className="chart-caption">次数与时长独立展示，不换算为负重容量或热量。</p>
    </section>
  );
}
