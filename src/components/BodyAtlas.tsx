import { isCompactViewport } from '../platform/compact-layout';
import { useState, type KeyboardEvent } from 'react';
import type { Exercise } from '../domain/types';
import {
  jointGroups,
  muscleGroups,
  matchesBodyTarget,
  targetLabel,
  type BodySide,
  type BodyTarget,
  type MuscleId,
  type JointId,
} from '../content/body-map';

// Independently authored, symmetrical navigation diagram. Not a clinical anatomy plate.
const regions: Record<BodySide, Partial<Record<MuscleId, string>>> = {
  front: {
    chest: 'M116 103 Q98 89 78 100 L69 124 Q90 141 116 124Z',
    delts: 'M76 96 Q55 96 51 121 L60 136 70 123Z',
    biceps: 'M51 127 Q39 145 39 164 L49 171 Q59 153 59 139Z',
    forearms: 'M38 170 Q30 187 25 214 L34 220 Q46 199 48 176Z',
    abs: 'M118 135 L101 140 104 197 118 214Z',
    obliques: 'M97 139 L78 132 84 174 96 200 101 193Z',
    quads: 'M86 230 Q72 256 82 306 L94 318 Q107 291 112 259 L112 239Z',
    adductors: 'M114 239 L101 232 Q110 249 104 278 L114 303 118 260Z',
    calves: 'M83 333 Q76 359 87 391 L90 434 99 434 101 390 98 334Z',
  },
  back: {
    upperback: 'M116 84 L97 95 79 100 97 129 116 142Z',
    reardelts: 'M77 99 Q56 98 51 121 L62 136 73 122 90 111Z',
    triceps: 'M52 130 Q38 146 40 166 L50 172 Q63 154 60 139Z',
    forearms: 'M38 174 Q29 191 25 214 L34 220 Q46 199 48 178Z',
    lats: 'M78 122 L95 134 113 153 110 192 94 197 85 174Z',
    lowerback: 'M117 156 L110 161 108 195 100 209 117 222Z',
    glutes: 'M96 210 Q78 215 80 242 94 260 115 249 L117 225Z',
    hamstrings: 'M81 254 Q76 285 84 318 L99 323 Q108 297 113 258 L102 262Z',
    calves: 'M84 335 Q73 351 84 380 L93 391 103 374 100 335Z',
  },
};
const jointPositions: Record<JointId, [number, number]> = {
  shoulders: [66, 116],
  elbows: [44, 170],
  wrists: [28, 221],
  hips: [96, 231],
  knees: [92, 326],
  ankles: [95, 436],
};
const outline =
  'M108 76 L106 89 Q89 93 72 98 Q53 97 48 123 L32 165 18 216 15 233 20 243 28 232 34 217 53 179 64 148 77 171 81 202 Q72 226 74 253 L73 285 80 324 77 353 85 397 85 436 78 450 Q89 458 103 452 L104 434 111 385 108 353 110 330 118 286 120 262 122 286 130 330 132 353 129 385 136 434 137 452 Q151 458 162 450 L155 436 155 397 163 353 160 324 167 285 166 253 Q168 226 159 202 L163 171 176 148 187 179 206 217 212 232 220 243 225 233 222 216 208 165 192 123 Q187 97 168 98 Q151 93 134 89 L132 76';

export function BodyFigure({
  side,
  feminine = false,
  mode = 'muscles',
  selected,
  primary = [],
  secondary = [],
  onSelect,
}: {
  side: BodySide;
  feminine?: boolean;
  mode?: 'muscles' | 'joints';
  selected?: BodyTarget | null;
  primary?: MuscleId[];
  secondary?: MuscleId[];
  onSelect?: (target: BodyTarget) => void;
}) {
  function keySelect(event: KeyboardEvent<SVGGElement>, id: BodyTarget) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(id);
    }
  }
  const active = (id: MuscleId) =>
    selected === id || primary.includes(id) ? 'primary' : secondary.includes(id) ? 'secondary' : '';
  return (
    <svg
      className={`body-figure ${feminine ? 'feminine' : ''}`}
      viewBox="0 0 240 470"
      role="group"
      aria-label={`${side === 'front' ? '正面' : '背面'}身体${mode === 'joints' ? '关节' : '肌群'}图`}
    >
      <g className="body-outline" aria-hidden="true">
        <path
          d={
            feminine
              ? outline
                  .replace('77 171 81 202 Q72 226 74 253', '81 171 85 202 Q66 226 72 253')
                  .replace('166 253 Q168 226 159 202 L163 171', '168 253 Q174 226 155 202 L159 171')
              : outline
          }
        />
        <path d="M108 76 Q97 65 98 43 Q97 19 120 18 Q143 19 142 43 Q143 65 132 76 Q120 85 108 76Z" />
        {feminine && <path className="body-shape-line" d="M77 147 Q91 179 83 207 M163 147 Q149 179 157 207" />}
        <path
          className="body-shape-line"
          d={
            side === 'front'
              ? 'M108 88 Q120 96 132 88 M120 136v70 M105 153h30 M106 172h28 M108 191h24 M84 322q9 10 18 0 M138 322q9 10 18 0'
              : 'M120 96v119 M120 226v25 M85 325q9 8 17 0 M138 325q9 8 17 0'
          }
        />
      </g>
      {mode === 'muscles'
        ? Object.entries(regions[side]).map(([key, path]) => {
            const id = key as MuscleId;
            return (
              <g
                key={id}
                className={`body-region ${active(id)}`}
                data-region={id}
                role={onSelect ? 'button' : undefined}
                tabIndex={onSelect ? 0 : undefined}
                aria-label={`${onSelect ? '选择' : ''}${targetLabel(id)}`}
                aria-pressed={onSelect ? selected === id : undefined}
                onClick={() => onSelect?.(id)}
                onKeyDown={(event) => keySelect(event, id)}
              >
                <title>{targetLabel(id)}</title>
                <path d={path} />
                <path d={path} transform="translate(240 0) scale(-1 1)" />
              </g>
            );
          })
        : jointGroups.map((joint) => {
            const [x, y] = jointPositions[joint.id];
            return (
              <g
                key={joint.id}
                className={`body-joint ${selected === joint.id ? 'primary' : ''}`}
                data-region={joint.id}
                role="button"
                tabIndex={0}
                aria-label={`选择${joint.label}`}
                aria-pressed={selected === joint.id}
                onClick={() => onSelect?.(joint.id)}
                onKeyDown={(event) => keySelect(event, joint.id)}
              >
                <title>{joint.label}</title>
                {[x, 240 - x].map((cx) => (
                  <g key={cx}>
                    <circle className="joint-hit" cx={cx} cy={y} r="17" />
                    <circle cx={cx} cy={y} r="9" />
                    <path d={`M${cx - 4} ${y}h8 M${cx} ${y - 4}v8`} />
                  </g>
                ))}
              </g>
            );
          })}
    </svg>
  );
}

export default function BodyAtlas({
  exercises,
  selected,
  includeSecondary,
  onSelect,
  onSecondary,
  onResults,
}: {
  exercises: Exercise[];
  selected: BodyTarget | null;
  includeSecondary: boolean;
  onSelect: (id: BodyTarget | null) => void;
  onSecondary: (value: boolean) => void;
  onResults: () => void;
}) {
  const [side, setSide] = useState<BodySide>('front');
  const [feminine, setFeminine] = useState(false);
  const [mode, setMode] = useState<'muscles' | 'joints'>('muscles');
  const [namesOpen, setNamesOpen] = useState(() => !isCompactViewport());
  const groups = mode === 'muscles' ? muscleGroups : jointGroups;
  const current = groups.find((group) => group.id === selected);
  const count = selected
    ? exercises.filter((ex) => matchesBodyTarget(ex, selected, includeSecondary)).length
    : exercises.length;
  function choose(id: BodyTarget | null) {
    onSelect(id);
    const group = muscleGroups.find((g) => g.id === id);
    if (group?.side === 'back' || group?.side === 'front') setSide(group.side);
  }
  function switchMode(next: 'muscles' | 'joints') {
    setMode(next);
    onSelect(null);
  }
  return (
    <section className="body-atlas" aria-label="按身体找动作">
      <div className="atlas-heading">
        <div>
          <h3>今天想练哪里？</h3>
          <p>点选部位，查看动作与要点。</p>
        </div>
        <div className="segmented" role="group" aria-label="身体图模式">
          <button
            aria-pressed={mode === 'muscles'}
            className={mode === 'muscles' ? 'active' : ''}
            onClick={() => switchMode('muscles')}
          >
            肌群
          </button>
          <button
            aria-pressed={mode === 'joints'}
            className={mode === 'joints' ? 'active' : ''}
            onClick={() => switchMode('joints')}
          >
            关节
          </button>
        </div>
      </div>
      <div className="atlas-layout">
        <div className="atlas-visual">
          <div className="atlas-view-controls">
            <div className="segmented" role="group" aria-label="身体图外形">
              <button aria-pressed={!feminine} className={!feminine ? 'active' : ''} onClick={() => setFeminine(false)}>
                男性
              </button>
              <button aria-pressed={feminine} className={feminine ? 'active' : ''} onClick={() => setFeminine(true)}>
                女性
              </button>
            </div>
            <div className="segmented atlas-side-control" role="group" aria-label="身体图朝向">
              <button
                aria-pressed={side === 'front'}
                className={side === 'front' ? 'active' : ''}
                onClick={() => setSide('front')}
              >
                正面
              </button>
              <button
                aria-pressed={side === 'back'}
                className={side === 'back' ? 'active' : ''}
                onClick={() => setSide('back')}
              >
                背面
              </button>
            </div>
          </div>
          <div className="atlas-figures">
            {(['front', 'back'] as const).map((view) => (
              <figure className={side === view ? 'shown' : ''} key={view}>
                <BodyFigure side={view} feminine={feminine} mode={mode} selected={selected} onSelect={choose} />
                <figcaption>{view === 'front' ? '正面' : '背面'}</figcaption>
              </figure>
            ))}
          </div>
          <p className="atlas-diagram-note">部位导航示意 · 外形切换共用同一动作库</p>
        </div>
        <div className="atlas-selection">
          <div className="atlas-selection-copy" aria-live="polite">
            <span>{current ? (mode === 'muscles' ? '已选肌群' : '已选关节') : '选择一个部位'}</span>
            <h4>{current?.label ?? '从身体出发，找到动作'}</h4>
            <p>
              {current?.hint ??
                (mode === 'muscles'
                  ? '可以点选身体图，也可以直接选择下面的部位名称。'
                  : '按明显活动关节整理动作，不包含仅负责稳定的关节。')}
            </p>
          </div>
          <details
            className="atlas-region-picker"
            open={namesOpen}
            onToggle={(event) => setNamesOpen(event.currentTarget.open)}
          >
            <summary>按名称选择部位</summary>
            <div className="atlas-region-list" role="group" aria-label="身体部位名称">
              <button className={!selected ? 'active' : ''} aria-pressed={!selected} onClick={() => choose(null)}>
                全身<span>{exercises.length}</span>
              </button>
              {groups.map((group) => (
                <button
                  key={group.id}
                  className={selected === group.id ? 'active' : ''}
                  aria-pressed={selected === group.id}
                  onClick={() => choose(group.id)}
                >
                  {group.label}
                  <span>{exercises.filter((ex) => matchesBodyTarget(ex, group.id, includeSecondary)).length}</span>
                </button>
              ))}
            </div>
          </details>
          {mode === 'muscles' && (
            <label className="atlas-secondary">
              <input
                type="checkbox"
                checked={includeSecondary}
                onChange={(event) => onSecondary(event.target.checked)}
              />
              包含协同参与的动作
            </label>
          )}
          <div className="atlas-result-action">
            <button className="btn btn-primary" onClick={onResults}>
              查看{count}个部位相关动作
            </button>
            {selected && (
              <button className="text-button" onClick={() => choose(null)}>
                取消部位选择
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
