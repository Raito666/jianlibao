import type { AppData } from '../../domain/types';
import type { PersonalRecord } from '../../domain/analytics';
import { displayWeight } from '../../domain/units';
import Icon from '../../components/Icon';

export default function RecordsList({
  records,
  recordLimit,
  setExerciseId,
  setExerciseMetric,
  onView,
  setRecordLimit,
  unit,
}: {
  records: PersonalRecord[];
  recordLimit: number;
  setExerciseId: (value: string) => void;
  setExerciseMetric: (value: string) => void;
  onView: (view: string) => void;
  setRecordLimit: (value: number) => void;
  unit: AppData['settings']['unit'];
}) {
  return (
    <section className="card personal-records">
      <div className="section-heading">
        <div>
          <h3>属于你的纪录</h3>
        </div>
        <span className="tag">所选周期 {records.length} 项</span>
      </div>
      {records.length ? (
        <div className="records-list">
          {records.slice(0, recordLimit).map((r) => (
            <button
              key={`${r.exercise.id}-${r.metric}`}
              onClick={() => {
                setExerciseId(r.exercise.id);
                setExerciseMetric('weight');
                onView('exercise');
              }}
            >
              <span className="record-icon">
                <Icon name="target" size={20} />
              </span>
              <span>
                <strong className="truncate" title={r.exercise.name}>{r.exercise.name}</strong>
                <small className="truncate">
                  {r.date} ·{' '}
                  {r.metric === 'weight' ? '最高正式组重量' : r.metric === 'duration' ? '最长单组保持' : '最多单组次数'}
                </small>
              </span>
              <b className="wrap-cjk">
                {r.metric === 'weight'
                  ? `${displayWeight(r.value, unit)} ${unit}`
                  : r.metric === 'duration'
                    ? `${r.value} 秒`
                    : `${r.value} 次`}
              </b>
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <p>所选周期没有刷新当前个人最佳。持续记录，让进步有据可查。</p>
        </div>
      )}
      <>
        {records.length > recordLimit && (
          <button className="text-button" onClick={() => setRecordLimit(records.length)}>
            查看全部 {records.length} 项纪录
          </button>
        )}
        {recordLimit > 3 && records.length > 3 && (
          <button className="text-button" onClick={() => setRecordLimit(3)}>收起纪录</button>
        )}
      </>
      <p className="chart-caption">截至目前仍保持的个人最佳，历史修正和删除后自动重算。</p>
    </section>
  );
}
