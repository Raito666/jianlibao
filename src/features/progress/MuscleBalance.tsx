import type { muscleBalance } from '../../domain/analytics';
import Icon from '../../components/Icon';

export default function MuscleBalance({
  muscles,
  muscleSets,
}: {
  muscles: ReturnType<typeof muscleBalance>;
  muscleSets: number;
}) {
  return (
    <section className="card muscle-balance">
      <h3>努力，落在哪些部位。</h3>
      {muscles.length ? (
        <div className="muscle-bars">
          {muscles.map((m) => (
            <div key={m.name}>
              <span>
                <strong>{m.name}</strong>
                <small>
                  {m.sets} 组 · {Math.round((m.sets / muscleSets) * 100)}%
                </small>
              </span>
              <div>
                <i style={{ width: `${(m.sets / Math.max(...muscles.map((x) => x.sets))) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="chart-empty">
          <Icon name="target" size={24} />
          <p>完成正式组后显示部位分布</p>
        </div>
      )}
      <p className="chart-caption">每组只归入一个主要肌群；这是组数分布，不代表刺激或恢复程度。</p>
      {muscles.some(m => m.name === '未细分') && <p className="chart-caption">旧自定义动作的宽泛部位保留为「未细分」，组数仍计入总量。</p>}
    </section>
  );
}
