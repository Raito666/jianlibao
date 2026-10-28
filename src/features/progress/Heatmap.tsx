import type { Session } from '../../domain/types';
import { trainingStreak, dailyActivity, shiftDate, monday } from '../../domain/analytics';

export default function Heatmap({
  sessions,
  today,
  onDate,
}: {
  sessions: Session[];
  today: string;
  onDate: (date: string) => void;
}) {
  return (
    <section className="card heatmap-panel">
      <div className="section-heading">
        <div>
          <h3>最近 12 周的训练节奏</h3>
        </div>
        <span className="tag">连续 {trainingStreak(sessions, today)} 周有训练</span>
      </div>
      <div className="heatmap-scroller">
        <div className="activity-heatmap">
          {dailyActivity(sessions, shiftDate(monday(today), -77), shiftDate(monday(today), 6)).map((day) => (
            <button
              key={day.date}
              disabled={day.date > today}
              className={`heat-cell level-${Math.min(3, day.sessions)}`}
              aria-label={`${day.date}，${day.sessions}场训练`}
              title={`${day.date} · ${day.sessions} 场`}
              onClick={() => onDate(day.date)}
            >
              {day.sessions > 0 ? day.sessions : null}
            </button>
          ))}
        </div>
      </div>
      <div className="heatmap-legend">
        <span>12 周前</span>
        <span>
          少 <i className="level-0" />
          <i className="level-1" />
          <i className="level-2" />
          <i className="level-3" /> 多
        </span>
        <span>本周</span>
      </div>
    </section>
  );
}
