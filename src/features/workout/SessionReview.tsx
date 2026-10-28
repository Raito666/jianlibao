import type { Dispatch, SetStateAction } from 'react';
import type { AppData, Session } from '../../domain/types';
import { resumeSession, type sessionStats } from '../../domain/training';
import Icon from '../../components/Icon';
import SetTable from './SetTable';
import Summary from './Summary';
import type { Update } from './types';
type Props = {
  data: AppData;
  session: Session;
  now: number;
  stats: ReturnType<typeof sessionStats>;
  writable: boolean;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  update: Update;
  finish: () => Promise<boolean>;
  setNote: (note: string) => void;
};
export default function SessionReview({
  data,
  session,
  now,
  stats,
  writable,
  busy,
  setBusy,
  update,
  finish,
  setNote,
}: Props) {
  return (
    <>
      <section className="card summary-card">
        <div className="summary-symbol">
          <Icon name="check" size={24} />
        </div>
        <h2>每一组，都算数。</h2>
        <p className="muted">{session.name} · 按实际完成结果归档</p>
        <Summary session={session} now={now} />
        <p className="notice">未完成与跳过的组不会计入完成量；热身不计重量容量。</p>
        <label className="field">
          训练感受 / 备注
          <textarea
            className="form-textarea"
            maxLength={2000}
            value={session.note}
            disabled={!writable}
            onChange={(e) => setNote(e.target.value)}
            placeholder="今天的状态、下次想调整的地方…"
          />
        </label>
        <div className="row">
          <button
            className="btn btn-secondary"
            disabled={!writable || busy}
            onClick={() => void update((s) => resumeSession(s))}
          >
            返回继续训练
          </button>
          <button
            className="btn btn-primary"
            disabled={!writable || busy || !stats.completedSets}
            onClick={async () => {
              setBusy(true);
              await finish();
              setBusy(false);
            }}
          >
            <Icon name="save" />
            保存训练
          </button>
        </div>
        {!stats.completedSets && <p className="error-text">尚未完成任何一组，可以返回继续训练，或取消这场草稿。</p>}
      </section>
      <div className="stack">
        {session.exercises.map((ex, index) => (
          <section className="card" key={ex.id}>
            <h3>{ex.exercise.name}</h3>
            <SetTable session={session} exerciseIndex={index} unit={data.settings.unit} update={update} showRpe={data.settings.showRpe} readOnly />
          </section>
        ))}
      </div>
    </>
  );
}
