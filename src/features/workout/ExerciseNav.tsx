import type { Session } from '../../domain/types';
import Icon from '../../components/Icon';
export default function ExerciseNav({
  session,
  current,
  setCurrent,
}: {
  session: Session;
  current: number;
  setCurrent: (index: number) => void;
}) {
  return (
    <section className="card">
      <div className="section-heading">
        <h3>训练清单</h3>
        <span className="muted">{session.exercises.length} 个动作</span>
      </div>
      <div className="session-exercise-list">
        {session.exercises.map((ex, index) => (
          <button
            className={`session-exercise ${index === current ? 'active' : ''}`}
            key={ex.id}
            onClick={() => setCurrent(index)}
          >
            <span>{index + 1}</span>
            <span>
              <span className="truncate" title={ex.exercise.name}>{ex.exercise.name}</span>
              <small>
                {ex.sets.filter((s) => s.status === 'completed').length} / {ex.sets.length} 组
              </small>
            </span>
            <Icon name="arrow" size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}
