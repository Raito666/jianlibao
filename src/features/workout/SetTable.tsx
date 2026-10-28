import type { Session, SetRecord } from '../../domain/types';
import { toggleSet } from '../../domain/training';
import { displayWeight, fromWeight } from '../../domain/units';
import CompletionMark from '../../components/CompletionMark';
import NumericStepper from '../../components/NumericStepper';
import { adjustWeight, adjustCount, copyPrevious } from './performance';
import type { Update } from './types';
import { nativeFeedback } from '../../platform/native';
import RpeSelect from '../../components/RpeSelect';
export default function SetTable({
  session,
  exerciseIndex,
  unit,
  update,
  disabled = false,
  readOnly = false,
  autoRest = true,
  showRpe = false,
}: {
  session: Session;
  exerciseIndex: number;
  unit: 'kg' | 'lb';
  update: Update;
  disabled?: boolean;
  readOnly?: boolean;
  autoRest?: boolean;
  showRpe?: boolean;
}) {
  const item = session.exercises[exerciseIndex];
  const displayRpe = showRpe || (readOnly && item.sets.some(set => set.rpe !== undefined));
  function change(setId: string, patch: Partial<SetRecord>) {
    void update((s) => ({
      ...s,
      updatedAt: new Date().toISOString(),
      exercises: s.exercises.map((ex) =>
        ex.id !== item.id ? ex : { ...ex, sets: ex.sets.map((set) => (set.id === setId ? { ...set, ...patch } : set)) },
      ),
    }));
  }
  function adjust(setId: string, field: 'weightKg' | 'reps' | 'durationSeconds', direction: 1 | -1) {
    if (disabled || readOnly) return;
    void update((s) => ({
      ...s,
      updatedAt: new Date().toISOString(),
      exercises: s.exercises.map((ex) =>
        ex.id !== item.id
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((set) =>
                set.id !== setId || set.status === 'completed'
                  ? set
                  : {
                      ...set,
                      [field]:
                        field === 'weightKg'
                          ? adjustWeight(set.weightKg, unit, direction)
                          : adjustCount(set[field], direction, field === 'reps' ? 1000 : 86400),
                    },
              ),
            },
      ),
    }));
  }
  return (
    <div className="table-scroll">
      <table className="set-table set-entry-table">
        <thead>
          <tr>
            <th>组</th>
            <th>类型</th>
            {item.exercise.kind === 'weight-reps' && <th>总重量 {unit}</th>}
            <th>{item.exercise.kind === 'duration' ? '时长 秒' : '次数'}</th>
            {displayRpe && <th>RPE</th>}
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {item.sets.map((set, i) => (
            <tr key={`${set.id}-${unit}`} className={`set-row ${set.status}`}>
              <td data-label="组">
                {i + 1}
                <span className="set-number-label">组</span>
              </td>
              <td data-label="类型">
                <select
                  aria-label={`${item.exercise.name}第${i + 1}组类型`}
                  className="set-type"
                  value={set.type}
                  disabled={disabled || readOnly}
                  onChange={(e) => change(set.id, { type: e.target.value as SetRecord['type'] })}
                >
                  <option value="work">正式</option>
                  <option value="warmup">热身</option>
                  <option value="drop">递减</option>
                  <option value="failure">力竭</option>
                </select>
              </td>
              {item.exercise.kind === 'weight-reps' && (
                <td data-field="weight" data-label={`总重量 ${unit}`}>
                  <NumericStepper
                    label={`${item.exercise.name}第${i + 1}组总重量`}
                    value={displayWeight(set.weightKg, unit)}
                    max={unit === 'kg' ? 1000 : 2204.62}
                    disabled={disabled || readOnly || set.status === 'completed'}
                    onChange={(n) => change(set.id, { weightKg: fromWeight(n, unit) })}
                    onStep={(direction) => adjust(set.id, 'weightKg', direction)}
                  />
                </td>
              )}
              <td data-field="count" data-label={item.exercise.kind === 'duration' ? '时长 秒' : '次数'}>
                <NumericStepper
                  label={`${item.exercise.name}第${i + 1}组${item.exercise.kind === 'duration' ? '时长' : '次数'}`}
                  value={item.exercise.kind === 'duration' ? set.durationSeconds : set.reps}
                  min={1}
                  max={item.exercise.kind === 'duration' ? 86400 : 1000}
                  step={1}
                  disabled={disabled || readOnly || set.status === 'completed'}
                  onChange={(n) =>
                    change(set.id, item.exercise.kind === 'duration' ? { durationSeconds: n } : { reps: n })
                  }
                  onStep={(direction) =>
                    adjust(set.id, item.exercise.kind === 'duration' ? 'durationSeconds' : 'reps', direction)
                  }
                />
              </td>
              {displayRpe && <td data-field="rpe" data-label="主观用力 RPE">
                {readOnly ? (set.rpe ?? '未记录') : <RpeSelect value={set.rpe} disabled={disabled}
                  label={`${item.exercise.name}第${i + 1}组RPE`} onChange={rpe => change(set.id, { rpe })} />}
              </td>}
              <td>
                {readOnly ? (
                  <span>{set.status === 'completed' ? '完成' : set.status === 'skipped' ? '跳过' : '未完成'}</span>
                ) : (
                  <div className="set-actions">
                    <div className="set-state-actions">
                      <button
                        type="button"
                        className={`complete-btn ${set.status === 'completed' ? 'completed' : ''}`}
                        disabled={disabled}
                        aria-pressed={set.status === 'completed'}
                        aria-label={`${set.status === 'completed' ? '撤销' : '完成'}${item.exercise.name}第${i + 1}组`}
                        onClick={(e) => {
                          if (e.detail > 1) return;
                          const inputs = Array.from(e.currentTarget.closest('tr')!.querySelectorAll('input'));
                          if (inputs.some((input) => !input.reportValidity())) return;
                          void update((s) => {
                            const next = toggleSet(s, item.id, set.id);
                            return autoRest ? next : { ...next, restUntil: null };
                          }).then(ok => { if (ok) void nativeFeedback('impact'); });
                        }}
                      >
                        <CompletionMark completed={set.status === 'completed'} />
                        <span>{set.status === 'completed' ? '已完成' : '完成本组'}</span>
                      </button>
                      <button
                        className="skip-btn"
                        disabled={disabled}
                        aria-label={`${set.status === 'skipped' ? '恢复' : '跳过'}${item.exercise.name}第${i + 1}组`}
                        onClick={() => change(set.id, { status: set.status === 'skipped' ? 'pending' : 'skipped' })}
                      >
                        {set.status === 'skipped' ? '恢复' : '跳过'}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost set-copy"
                      disabled={disabled || i === 0 || set.status === 'completed'}
                      aria-label={`复制${item.exercise.name}第${i}组到第${i + 1}组`}
                      onClick={() => {
                        if (disabled || readOnly) return;
                        void update((s) => ({
                          ...s,
                          updatedAt: new Date().toISOString(),
                          exercises: s.exercises.map((ex) => (ex.id === item.id ? copyPrevious(ex, set.id) : ex)),
                        }));
                      }}
                    >
                      复制上一组
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
