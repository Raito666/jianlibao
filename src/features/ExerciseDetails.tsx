import { muscleLabel } from '../content/body-map';
import { useRef, useState, type KeyboardEvent } from 'react';
import type { AppData, Exercise } from '../domain/types';
import { guideFor } from '../content/catalog';
import { exercisePerformance } from '../domain/analytics';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import TrendChart from '../components/TrendChart';
import { displayWeight } from '../domain/units';
import ExerciseArtPlayer, { type ArtPlaybackPreferences } from '../components/ExerciseArtPlayer';
import { artworkSource } from '../content/media-source';
import { textSource } from '../content/external-guidance';
import { textLicense } from '../content/text-license';
import { BodyFigure } from '../components/BodyAtlas';
import { exerciseMuscles } from '../content/body-map';
import ReferenceMedia from '../components/ReferenceMedia';

export function recordingText(exercise: Exercise) {
  return exercise.kind === 'weight-reps'
    ? '填写总外部负重与实际次数。双哑铃同时做时两只合计，单侧左右分别记组；不自动乘2。器械配重只在同一设备条件下比较。'
    : exercise.kind === 'reps'
      ? '记录实际完成次数。自重、辅助器械配重不计入重量容量；左右分别练习时各记一组。'
      : '按秒记录实际持续时长，独立于重量容量。有氧动作当前按时长记录，不从时间推算距离或热量。';
}
type View = 'brief' | 'detailed' | 'history';
export default function ExerciseDetails({
  exercise,
  data,
  onClose,
  onUse,
  onFavorite,
  favorite = false,
}: {
  exercise: Exercise;
  data?: AppData;
  onClose: () => void;
  onUse?: () => void;
  onFavorite?: () => void;
  favorite?: boolean;
}) {
  const guide = guideFor(exercise);
  const [tab, setTab] = useState<View>('brief');
  const [artPreferences, setArtPreferences] = useState<ArtPlaybackPreferences>({ frame: 1, speed: 1, loop: true });
  const panel = useRef<HTMLDivElement>(null);
  const performance = data ? exercisePerformance(data.sessions, exercise.id, exercise.kind) : [];
  const muscles = exerciseMuscles(exercise);
  const format = (n: number) =>
    exercise.kind === 'weight-reps'
      ? `${displayWeight(n, data?.settings.unit ?? 'kg')} ${data?.settings.unit ?? 'kg'}`
      : exercise.kind === 'duration'
        ? `${n} 秒`
        : `${n} 次`;
  const changeView = (next: View) => {
    setTab(next);
    panel.current?.closest('.modal-body')?.scrollTo({ top: 0 });
    document.getElementById(`exercise-tab-${next}`)?.focus();
  };
  const tabs: [View, string][] = [
    ['brief', '简洁讲解'],
    ['detailed', '详细讲解'],
    ['history', '我的表现'],
  ];
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    changeView(tabs[next][0]);
  }
  return (
    <Modal
      title={exercise.name}
      onClose={onClose}
      wide
      footer={
        <>
          {onFavorite && (
            <button className="btn btn-secondary" aria-pressed={favorite} onClick={onFavorite}>
              <Icon name="heart" />
              {favorite ? '已收藏' : '收藏动作'}
            </button>
          )}
          {onUse && (
            <button className="btn btn-primary" onClick={onUse}>
              <Icon name="plus" />
              {data?.sessions.some((s) => ['active', 'paused', 'review'].includes(s.status))
                ? '加入当前训练'
                : '从这个动作开练'}
            </button>
          )}
        </>
      }
    >
      <div className="detail-meta">
        <span className="truncate" title={muscleLabel(exercise)}>
          {muscleLabel(exercise)}
        </span>
        <span className="truncate" title={exercise.equipment}>
          {exercise.equipment}
        </span>
        {guide && (
          <span className="truncate">
            {guide.level} · {guide.stretch ? '拉伸与活动度' : guide.title}
          </span>
        )}
      </div>
      {guide && <p className="exercise-english wrap-cjk">{guide.english}</p>}
      <div className="explanation-tabs" role="tablist" aria-label="动作详情视图">
        {tabs.map(([id, label], index) => (
          <button
            id={`exercise-tab-${id}`}
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls="exercise-panel"
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(event) => tabKey(event, index)}
            onClick={() => changeView(id)}
          >
            {label}
            {id === 'history' && performance.length > 0 && <small>{performance.length}</small>}
          </button>
        ))}
      </div>
      <div
        ref={panel}
        id="exercise-panel"
        className={`explanation-panel ${tab}`}
        role="tabpanel"
        aria-labelledby={`exercise-tab-${tab}`}
        tabIndex={0}
      >
        {tab !== 'history' ? (
          guide ? (
            <>
              <div className="technique-layout">
                <ExerciseArtPlayer
                  key={exercise.id}
                  exerciseId={exercise.id}
                  name={exercise.name}
                  view={tab}
                  initial={artPreferences}
                  onPreferencesChange={setArtPreferences}
                />
                <section className="technique-steps wrap-cjk">
                  <h3>{tab === 'brief' ? '三个要点，开始练习' : '动作步骤'}</h3>
                  {tab === 'detailed' && <p className="technique-variation">{guide.variation}</p>}
                  <ol>
                    {(tab === 'brief' ? guide.quickSteps : guide.steps).map((step, i) => (
                      <li key={step}>
                        <b>{['准备', '动作', '控制'][i] ?? i + 1}</b>
                        <p>{step}</p>
                      </li>
                    ))}
                  </ol>
                  {tab === 'brief' && (
                    <p className="brief-form-note">
                      <Icon name="target" size={16} />
                      {guide.cues[0]}
                    </p>
                  )}
                  {tab === 'detailed' && guide.supplement && (
                    <details className="supplement-guidance">
                      <summary>补充练习提示</summary>
                      <ul>
                        {guide.supplement.hints.map((hint) => (
                          <li key={hint}>{hint}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>
              </div>
              {tab === 'brief' ? (
                <div className="brief-reference wrap-cjk">
                  <section>
                    <h3>发力与呼吸</h3>
                    <p>{guide.breathing}</p>
                  </section>
                  <section>
                    <h3>常见错误</h3>
                    <p>{guide.mistakes[0]}</p>
                  </section>
                  <button className="explanation-more" onClick={() => changeView('detailed')}>
                    查看详细讲解与记录方式
                    <Icon name="arrow" size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <section className="muscle-reference" aria-label="动作参与肌群">
                    <h3>参与部位</h3>
                    <div className="muscle-reference-layout">
                      <div className="muscle-reference-diagram">
                        <BodyFigure side="front" primary={muscles.primary} secondary={muscles.secondary} />
                        <BodyFigure side="back" primary={muscles.primary} secondary={muscles.secondary} />
                      </div>
                      <div className="muscle-reference-copy wrap-cjk">
                        <p>
                          <strong>主要：</strong>
                          {guide.primary}
                        </p>
                        <p>
                          <strong>协同：</strong>
                          {guide.secondary.join('、') || '依动作姿势与个人控制而定'}
                        </p>
                        <small className="muted">实色为主要部位，虚线为协同部位。区域为导航示意。</small>
                      </div>
                    </div>
                  </section>
                  <div className="guide-grid wrap-cjk">
                    <section>
                      <h3>
                        <Icon name="target" size={16} />
                        发力与呼吸
                      </h3>
                      <p>{guide.breathing}</p>
                      <ul>
                        {guide.cues.map((cue) => (
                          <li key={cue}>{cue}</li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h3>
                        <Icon name="alert" size={16} />
                        常见错误
                      </h3>
                      <ul>
                        {guide.mistakes.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h3>如何记录</h3>
                      <p>{recordingText(exercise)}</p>
                    </section>
                  </div>
                  <ReferenceMedia key={exercise.id} exerciseId={exercise.id} />
                  <details className="content-credit wrap-cjk">
                    <summary>图解来源与内容说明</summary>
                    <p>
                      图解：{artworkSource.author}，部分基础姿势源自 Everkinetic，CC BY-SA
                      4.0。中文步骤为健力宝独立整理；帕洛夫抗旋推使用健力宝另绘示意，同许可提供。上游原始文件保持不变，展示时通过
                      CSS 反相适配浅底。图解仅为姿势示意。
                    </p>
                    <p>
                      <a href={artworkSource.sourceUrl} target="_blank" rel="noreferrer">
                        原始图解目录
                      </a>{' '}
                      ·{' '}
                      <a href={artworkSource.licenseUrl} target="_blank" rel="noreferrer">
                        图解许可
                      </a>{' '}
                      ·{' '}
                      <a href={artworkSource.attributionUrl} target="_blank" rel="noreferrer">
                        完整署名与修改记录
                      </a>
                      {guide.artSource && (
                        <>
                          {' '}
                          ·{' '}
                          <a href={guide.artSource} target="_blank" rel="noreferrer">
                            基础姿势来源
                          </a>
                        </>
                      )}
                    </p>
                    {guide.supplement && (
                      <>
                        <p>
                          补充练习提示参考 Hasan Emir Yıldırım / exercises-dataset（MIT），条目{' '}
                          {guide.supplement.sourceId}。{textSource.changes}
                        </p>
                        <p>
                          <a
                            href={`${textSource.repository}/blob/${textSource.revision}/${textSource.path}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            文字原始来源
                          </a>
                        </p>
                        <details>
                          <summary>第三方文字许可全文</summary>
                          <p className="text-license">{textLicense}</p>
                        </details>
                      </>
                    )}
                  </details>
                </>
              )}
            </>
          ) : (
            <div className="custom-exercise-guide wrap-cjk">
              <Icon name="book" size={24} />
              <h3>你的个人动作</h3>
              <p>{exercise.description || '尚未填写个人说明，可在训练中添加自己的动作提示。'}</p>
              {tab === 'detailed' && (
                <>
                  <h3>记录方式</h3>
                  <p>{recordingText(exercise)}</p>
                  <p>自定义动作使用你填写的说明，不自动套用其他动作的教学。</p>
                </>
              )}
            </div>
          )
        ) : (
          <>
            {performance.length ? (
              <>
                <TrendChart
                  title={`${exercise.name}表现`}
                  points={performance.map((p) => ({
                    date: p.date,
                    label: `${p.date} · ${p.name}`,
                    value:
                      exercise.kind === 'weight-reps'
                        ? p.maxWeightKg
                        : exercise.kind === 'duration'
                          ? p.maxDuration
                          : p.maxReps,
                  }))}
                  format={format}
                />
                <div className="exercise-log">
                  {[...performance].reverse().map((p) => (
                    <div key={p.sessionId}>
                      <span>
                        <strong>{p.date}</strong>
                        <small className="truncate">
                          {p.name} · {p.sets} 个正式组
                        </small>
                      </span>
                      <b>
                        {format(
                          exercise.kind === 'weight-reps'
                            ? p.maxWeightKg
                            : exercise.kind === 'duration'
                              ? p.maxDuration
                              : p.maxReps,
                        )}
                      </b>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="exercise-performance-empty">
                <Icon name="chart" size={24} />
                <h3>还没有这个动作的训练记录</h3>
                <p>完成并保存训练后，这里会显示正式组的表现趋势。</p>
                <button className="btn btn-secondary" onClick={() => changeView('brief')}>
                  返回动作讲解
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
