import { COMPACT_LAYOUT_QUERY, isCompactViewport } from '../platform/compact-layout';
import Presence from '../motion/Presence';
import { useEffect, useRef, useState } from 'react';
import type { AppData, Exercise } from '../domain/types';
import { catalogEntries, guideFor, exerciseArt, mediaUrls, MEDIA_CACHE } from '../content/catalog';
import Icon from '../components/Icon';
import ExerciseDetails from './ExerciseDetails';
import { cachedArtUrls, fetchArt } from '../content/art-cache';
import BodyAtlas from '../components/BodyAtlas';
import { matchesBodyTarget, targetLabel, muscleLabel, type BodyTarget } from '../content/body-map';
import { useListMotion } from '../motion/presentation';

export default function ExerciseLibrary({
  data,
  writable,
  mutate,
  onCreate,
  onUse,
}: {
  data: AppData;
  writable: boolean;
  mutate: (fn: (data: AppData) => AppData) => Promise<boolean>;
  onCreate: () => void;
  onUse: (exercise: Exercise) => void;
}) {
  const [query, setQuery] = useState('');
  const offlinePanel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    let frame = 0;
    const openOffline = () => {
      if (new URLSearchParams(location.hash.split('?')[1] ?? '').get('offline') !== '1') return;
      frame = requestAnimationFrame(() => {
        if (!offlinePanel.current) return;
        offlinePanel.current.open = true;
        offlinePanel.current.scrollIntoView({ block: 'start', behavior: 'instant' });
        offlinePanel.current.querySelector('summary')?.focus({ preventScroll: true });
      });
    };
    openOffline(); window.addEventListener('hashchange', openOffline);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', openOffline); };
  }, []);
  const [bodyOpen, setBodyOpen] = useState(() => !isCompactViewport());
  useEffect(() => {
    const media = window.matchMedia(COMPACT_LAYOUT_QUERY);
    const resize = () => setBodyOpen(!media.matches);
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const [equipment, setEquipment] = useState('全部');
  const [kind, setKind] = useState('全部');
  const [view, setView] = useState('all');
  const [limit, setLimit] = useState(24);
  const [detail, setDetail] = useState<Exercise | null>(null);
  const [bodyTarget, setBodyTarget] = useState<BodyTarget | null>(null);
  const [includeSecondary, setIncludeSecondary] = useState(false);
  const [level, setLevel] = useState('全部');
  const results = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [cached, setCached] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [cacheError, setCacheError] = useState('');
  const [checkingCache, setCheckingCache] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const favorites = data.settings.favoriteExerciseIds ?? [];
  const recent = new Set(
    data.sessions
      .filter((s) => s.status === 'completed')
      .flatMap((s) =>
        s.exercises.filter((ex) => ex.sets.some((set) => set.status === 'completed')).map((ex) => ex.exercise.id),
      ),
  );
  useEffect(() => {
    setLimit(24);
  }, [query, equipment, kind, view, bodyTarget, includeSecondary, level]);
  useEffect(() => {
    let alive = true;
    if ('caches' in window)
      void caches
        .open(MEDIA_CACHE)
        .then(cachedArtUrls)
        .then((valid) => {
          if (alive) {
            setCached(valid.size);
            setCheckingCache(false);
            if (valid.size < mediaUrls.length) void cacheAll();
          }
        })
        .catch(() => {
          if (alive) setCacheError('暂时无法检查离线图解，可继续阅读文字或重试保存。');
        })
        .finally(() => {
          if (alive) setCheckingCache(false);
        });
    else setCheckingCache(false);
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);
  function favorite(id: string) {
    void mutate((d) => {
      const ids = d.settings.favoriteExerciseIds ?? [];
      return {
        ...d,
        settings: { ...d.settings, favoriteExerciseIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] },
      };
    });
  }
  const filtered = data.exercises.filter((ex) => {
    const guide = guideFor(ex);
    const text =
      `${ex.name} ${ex.muscle} ${muscleLabel(ex)} ${ex.equipment} ${guide?.english ?? ''} ${guide?.primary ?? ''} ${guide?.title ?? ''}`.toLowerCase();
    return (
      (!query.trim() ||
        query
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .every((q) => text.includes(q))) &&
      (equipment === '全部' || ex.equipment === equipment) &&
      (kind === '全部' || ex.kind === kind) &&
      (level === '全部' || guide?.level === level) &&
      (view === 'all' ||
        (view === 'favorites' && favorites.includes(ex.id)) ||
        (view === 'recent' && recent.has(ex.id)) ||
        (view === 'custom' && !guide))
    );
  });
  const matches = bodyTarget ? filtered.filter((ex) => matchesBodyTarget(ex, bodyTarget, includeSecondary)) : filtered;
  const equipmentGroups = new Map<string, { equipment: string; total: number; exercises: Exercise[] }>();
  matches.forEach((exercise, index) => {
    let group = equipmentGroups.get(exercise.equipment);
    if (!group) {
      group = { equipment: exercise.equipment, total: 0, exercises: [] };
      equipmentGroups.set(exercise.equipment, group);
    }
    group.total++;
    if (index < limit) group.exercises.push(exercise);
  });
  useListMotion(
    list,
    JSON.stringify([
      query,
      equipment,
      kind,
      view,
      bodyTarget,
      includeSecondary,
      level,
      limit,
      matches.slice(0, limit).map((exercise) => exercise.id),
    ]),
    ':scope > .equipment-group > .equipment-grid > .movement-card',
  );
  async function cacheAll() {
    if (!('caches' in window)) {
      setCacheError('当前浏览器不支持图解缓存，文字讲解仍可使用。');
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setDownloading(true);
    setCacheError('');
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const valid = await cachedArtUrls(cache);
      let next = 0;
      let done = valid.size;
      setCached(done);
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          while (next < mediaUrls.length && !controller.signal.aborted) {
            const url = mediaUrls[next++];
            if (!valid.has(url)) {
              const response = await fetchArt(url, controller.signal);
              await cache.put(url, response);
              done++;
              if (!controller.signal.aborted && (done % 6 === 0 || done === mediaUrls.length)) setCached(done);
            }
          }
        }),
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        controller.abort();
        setCacheError(error instanceof Error ? error.message : '缓存未完成，请重试');
      }
    } finally {
      setDownloading(false);
      abort.current = null;
    }
  }
  const reset = () => {
    setQuery('');
    setEquipment('全部');
    setKind('全部');
    setView('all');
    setBodyTarget(null);
    setLevel('全部');
    setIncludeSecondary(false);
  };
  return (
    <div className="library-page">
      <section className="library-intro">
        <div>
          <p>
            {catalogEntries.length} 个图解动作<span className="library-intro-detail"> · 步骤、要点与详细讲解</span>
          </p>
        </div>
        <button className="btn btn-secondary" disabled={!writable} onClick={onCreate}>
          <Icon name="plus" size={16} />
          自定义动作
        </button>
      </section>
      <div className="library-toolbar">
        <label className="library-search">
          <Icon name="search" size={20} />
          <span className="sr-only">搜索动作</span>
          <input
            aria-label="搜索动作"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索动作、英文名或目标肌群…"
            type="search"
          />
        </label>
        <div className="segmented" role="group" aria-label="动作收藏筛选">
          {[
            ['all', '全部'],
            ['favorites', '收藏'],
            ['recent', '练过'],
            ['custom', '自定义'],
          ].map(([id, label]) => (
            <button
              key={id}
              className={view === id ? 'active' : ''}
              aria-pressed={view === id}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <section className="body-filter">
        <button
          className="body-filter-toggle"
          aria-expanded={bodyOpen}
          aria-controls="library-body-filter"
          onClick={() => setBodyOpen((open) => !open)}
        >
          <span className="truncate">按身体部位筛选{bodyTarget ? ` · ${targetLabel(bodyTarget)}` : ''}</span>
          <Icon name={bodyOpen ? 'up' : 'down'} size={16} />
        </button>
        <div id="library-body-filter" hidden={!bodyOpen}>
          <BodyAtlas
            exercises={filtered}
            selected={bodyTarget}
            includeSecondary={includeSecondary}
            onSelect={(id) => {
              setBodyTarget(id);
            }}
            onSecondary={setIncludeSecondary}
            onResults={() => {
              results.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
              results.current?.focus({ preventScroll: true });
            }}
          />
        </div>
      </section>
      <div ref={results} tabIndex={-1} className="library-filter-line">
        <p aria-live="polite">
          <strong>{matches.length}</strong> 个动作
          {bodyTarget && <span className="selected-body-label"> · {targetLabel(bodyTarget)}</span>}
          {(query || equipment !== '全部' || kind !== '全部' || view !== 'all' || bodyTarget || level !== '全部') && (
            <button className="text-button" onClick={reset}>
              重置筛选
            </button>
          )}
        </p>
        <div className="row">
          <select
            className="form-select"
            aria-label="器械筛选"
            value={equipment}
            onChange={(e) => setEquipment(e.target.value)}
          >
            <option value="全部">全部器械</option>
            {[...new Set(data.exercises.map((ex) => ex.equipment))].map((eq) => (
              <option key={eq}>{eq}</option>
            ))}
          </select>
          <select
            className="form-select"
            aria-label="难度筛选"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
          >
            <option value="全部">全部难度</option>
            {[...new Set(catalogEntries.map((entry) => entry.level))].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select
            className="form-select"
            aria-label="记录类型筛选"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="全部">全部类型</option>
            <option value="weight-reps">重量与次数</option>
            <option value="reps">次数</option>
            <option value="duration">时长</option>
          </select>
        </div>
      </div>
      {matches.length ? (
        <>
          <div className="movement-grid movement-groups" ref={list}>
            {[...equipmentGroups.values()]
              .filter((group) => group.exercises.length > 0)
              .map((group) => (
                <section className="equipment-group" aria-label={`${group.equipment}动作分组`} key={group.equipment}>
                  <div className="equipment-heading">
                    <h2 className="wrap-cjk">{group.equipment}</h2>
                    <span className="equipment-count">
                      {group.exercises.length < group.total
                        ? `已显示 ${group.exercises.length} / ${group.total}`
                        : `${group.total} 个动作`}
                    </span>
                  </div>
                  <div className="equipment-grid">
                    {group.exercises.map((ex) => {
                      const guide = guideFor(ex);
                      return (
                        <article className="movement-card" key={ex.id}>
                          <button
                            className="movement-open"
                            aria-label={`查看${ex.name}讲解`}
                            onClick={() => setDetail(ex)}
                          >
                            <div className={`movement-art ${!guide ? 'custom' : ''}`}>
                              {guide ? (
                                <img src={exerciseArt(ex.id, 2)} alt="" loading="lazy" width="256" height="256" />
                              ) : (
                                <Icon name="dumbbell" size={24} />
                              )}
                              <span className="movement-kind">
                                {ex.kind === 'weight-reps'
                                  ? '力量'
                                  : guide?.stretch
                                    ? '舒展'
                                    : ex.kind === 'duration'
                                      ? '时长'
                                      : '自重'}
                              </span>
                              {guide && (
                                <span className="movement-guide-badge" aria-hidden="true">
                                  讲解
                                </span>
                              )}
                            </div>
                            <div className="movement-info">
                              <h3 className="line-clamp-2 wrap-cjk" title={ex.name}>
                                {ex.name}
                              </h3>
                              <p className="truncate">{guide?.english ?? '个人动作'}</p>
                              <span>
                                <span className="truncate" title={muscleLabel(ex)}>
                                  {muscleLabel(ex)}
                                </span>
                                <i />
                                <span className="truncate" title={ex.equipment}>
                                  {ex.equipment}
                                </span>
                              </span>
                            </div>
                          </button>
                          {guide && (
                            <details className="movement-quick">
                              <summary>要点速查</summary>
                              <ol className="wrap-cjk">
                                {guide.quickSteps.map((step) => (
                                  <li key={step}>{step}</li>
                                ))}
                              </ol>
                              <button className="text-button" onClick={() => setDetail(ex)}>
                                查看完整讲解
                              </button>
                            </details>
                          )}
                          <button
                            className={`favorite-button ${favorites.includes(ex.id) ? 'active' : ''}`}
                            disabled={!writable}
                            aria-label={`${favorites.includes(ex.id) ? '取消收藏' : '收藏'}${ex.name}`}
                            aria-pressed={favorites.includes(ex.id)}
                            onClick={() => favorite(ex.id)}
                          >
                            <Icon name="heart" size={20} />
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
          </div>
          {limit < matches.length && (
            <div className="load-more">
              <button className="btn btn-secondary" onClick={() => setLimit((n) => n + 24)}>
                继续浏览 · 还有 {matches.length - limit} 个动作
                <Icon name="down" size={16} />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="card empty-state">
          <Icon name="search" size={24} />
          <h2>
            {view === 'favorites'
              ? '把常练的动作放在这里。'
              : view === 'recent'
                ? '你的动作足迹，从第一组开始。'
                : '没有找到这个动作'}
          </h2>
          <p>调整部位或器械，或创建自己的动作。</p>
          <div className="row">
            <button className="btn btn-secondary" onClick={reset}>
              清空筛选
            </button>
            <button className="btn btn-primary" disabled={!writable} onClick={onCreate}>
              自定义动作
            </button>
          </div>
        </div>
      )}

      <details className="offline-library" ref={offlinePanel}>
        <summary>
          <span>
            <Icon name="download" size={16} />
            离线图解准备
          </span>
          <small>
            {checkingCache
              ? '正在检查缓存…'
              : cacheError
                ? `准备未完成 · ${cached} / ${mediaUrls.length}`
                : cached >= mediaUrls.length
                  ? '全部图解已校验'
                  : `${cached} / ${mediaUrls.length} 张已校验`}
          </small>
        </summary>
        <p>
          进入动作页后自动准备全部906张图解，约26
          MB，可暂停和继续。显示全部就绪后，三帧都能离线查看；缓存由当前浏览器管理。
        </p>
        <div className="row wrap">
          <button
            className="btn btn-secondary"
            disabled={checkingCache || downloading || cached >= mediaUrls.length}
            onClick={() => void cacheAll()}
          >
            {downloading
              ? `正在保存 ${cached} / ${mediaUrls.length}`
              : cached >= mediaUrls.length
                ? '全部图解已就绪'
                : '保存全部图解供离线使用'}
          </button>
          {downloading && (
            <button className="btn btn-ghost" onClick={() => abort.current?.abort()}>
              暂停下载
            </button>
          )}
        </div>
        {cacheError && (
          <p role="alert" className="error-text">
            {cacheError}
          </p>
        )}
      </details>

      <Presence>
        {detail && (
          <ExerciseDetails
            exercise={detail}
            data={data}
            onClose={() => setDetail(null)}
            onFavorite={writable ? () => favorite(detail.id) : undefined}
            favorite={favorites.includes(detail.id)}
            onUse={
              writable
                ? () => {
                    onUse(detail);
                    setDetail(null);
                  }
                : undefined
            }
          />
        )}
      </Presence>
    </div>
  );
}
