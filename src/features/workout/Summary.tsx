import type { Session } from '../../domain/types';
import { sessionStats } from '../../domain/training';
import { formatClock } from './clock';
export default function Summary({ session, now }: { session: Session; now?: number }) {
  const stats = sessionStats(session, now);
  return (
    <div className="summary-grid">
      <div className="stat">
        <strong className="stat-value">
          {stats.completedSets}
          <small>组</small>
        </strong>
        <span className="stat-label truncate" title="实际完成">实际完成</span>
      </div>
      <div className="stat">
        <strong className="stat-value">{formatClock(stats.activeSeconds)}</strong>
        <span className="stat-label truncate" title="训练时长">训练时长</span>
      </div>
      <div className="stat">
        <strong className="stat-value">
          {session.exercises.some((ex) => ex.exercise.kind === 'weight-reps') ? (
            <>
              {stats.volumeKg.toLocaleString('zh-CN', { maximumFractionDigits: 1 })}
              <small>kg·次</small>
            </>
          ) : (
            <span className="not-applicable">不适用</span>
          )}
        </strong>
        <span className="stat-label truncate" title="正式组重量容量">正式组重量容量</span>
      </div>
    </div>
  );
}
