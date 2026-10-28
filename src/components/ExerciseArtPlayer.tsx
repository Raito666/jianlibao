import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { discardCachedArt } from '../content/art-cache';
import { mediaAssetFor } from '../content/media-source';
import { prefersReducedMotion, subscribeReducedMotion } from '../motion/reduced-motion';

async function decodedImage(url: string) {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();
}

export interface ArtPlaybackPreferences {
  frame: number;
  speed: number;
  loop: boolean;
}
export default function ExerciseArtPlayer({
  exerciseId,
  name,
  view,
  initial,
  onPreferencesChange,
}: {
  exerciseId: string;
  name: string;
  view: string;
  initial: ArtPlaybackPreferences;
  onPreferencesChange: (preferences: ArtPlaybackPreferences) => void;
}) {
  const asset = mediaAssetFor(exerciseId)!;
  const [current, setCurrent] = useState({ frame: initial.frame, url: asset.urls[initial.frame - 1] });
  const currentRef = useRef(current);
  const [previous, setPrevious] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(initial.speed);
  const [loop, setLoop] = useState(initial.loop);
  const [loading, setLoading] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const requestedFrame = useRef(initial.frame);
  const requestVersion = useRef(0);
  const mounted = useRef(true);
  const looping = useRef(loop);
  looping.current = loop;

  function pause() {
    requestVersion.current += 1;
    setPlaying(false);
    setLoading(false);
  }
  async function showFrame(frame: number, url = asset.urls[frame - 1]) {
    const version = ++requestVersion.current;
    requestedFrame.current = frame;
    setLoading(true);
    try {
      await decodedImage(url);
      if (!mounted.current || requestVersion.current !== version) return;
      const old = currentRef.current;
      setPrevious(old.url !== url && !prefersReducedMotion() ? old.url : null);
      currentRef.current = { frame, url };
      setCurrent(currentRef.current);
      setImageError(false);
      setLoading(false);
      if (!looping.current && frame === 3) setPlaying(false);
    } catch {
      if (!mounted.current || requestVersion.current !== version) return;
      setImageError(true);
      setLoading(false);
      setPlaying(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    // Warm all three small local SVGs. Only a successful decoded foreground request changes the visible frame.
    for (const url of asset.urls) {
      const image = new Image();
      image.src = url;
    }
    const unsubscribe = subscribeReducedMotion((reduced) => {
      if (reduced) pause();
    });
    const visibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false;
      requestVersion.current += 1;
      unsubscribe();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [exerciseId]);
  useEffect(() => {
    pause();
  }, [view]);
  useEffect(() => {
    onPreferencesChange({ frame: current.frame, speed, loop });
  }, [current.frame, speed, loop, onPreferencesChange]);
  useEffect(() => {
    if (!playing || loading || imageError) return;
    const timer = setTimeout(() => {
      if (current.frame === 3 && !loop) {
        setPlaying(false);
        return;
      }
      void showFrame((current.frame % 3) + 1);
    }, 1100 / speed);
    return () => clearTimeout(timer);
  }, [playing, loading, imageError, current.frame, speed, loop]);
  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), 100);
    return () => clearTimeout(timer);
  }, [previous, current.url]);

  async function retry() {
    const version = ++requestVersion.current;
    setRetrying(true);
    const frame = requestedFrame.current;
    const url = asset.urls[frame - 1];
    try {
      await discardCachedArt(url);
    } catch {
      /* Fresh query also recovers without Cache Storage. */
    }
    if (mounted.current && requestVersion.current === version) {
      await showFrame(frame, `${url}?retry=${Date.now()}`);
    }
    if (mounted.current) setRetrying(false);
  }
  function togglePlay() {
    if (playing) {
      pause();
      return;
    }
    if (current.frame === 3 && !loop) void showFrame(1);
    setPlaying(true);
  }

  return (
    <section className="technique-art" aria-label="分步图解" aria-busy={loading || retrying}>
      {imageError ? (
        <div className="art-unavailable" role="status">
          <Icon name="book" size={24} />
          <strong>这张图解暂不可用</strong>
          <p>文字仍可查看。请重试加载，或返回动作页准备完整的离线图解。</p>
          <button className="btn btn-secondary" disabled={retrying} onClick={() => void retry()}>
            {retrying ? '正在重试…' : '重新加载图解'}
          </button>
        </div>
      ) : (
        <>
          {previous && (
            <div className="art-previous" aria-hidden="true" style={{ backgroundImage: `url("${previous}")` }} />
          )}
          <img
            key={current.url}
            src={current.url}
            alt={`${name}第${current.frame}幅动作图解`}
            width="512"
            height="512"
            onError={() => {
              requestedFrame.current = current.frame;
              setImageError(true);
              pause();
            }}
          />
        </>
      )}
      <div className="frame-controls">
        <div className="row">
          {[1, 2, 3].map((frame) => (
            <button
              key={frame}
              aria-label={`查看第${frame}幅图解`}
              aria-pressed={current.frame === frame}
              className={current.frame === frame ? 'active' : ''}
              onClick={() => {
                pause();
                void showFrame(frame);
              }}
            >
              {frame}
            </button>
          ))}
        </div>
        <button
          className="icon-button"
          aria-label={playing ? '暂停图解播放' : '播放分步图解'}
          disabled={imageError}
          onClick={togglePlay}
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
      </div>
      <div className="art-playback-options">
        <label>
          速度
          <select aria-label="图解播放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
          </select>
        </label>
        <label className="art-loop-control">
          <input
            type="checkbox"
            aria-label="循环播放图解"
            checked={loop}
            onChange={(event) => setLoop(event.target.checked)}
          />
          循环
        </label>
      </div>
      <small>{loading ? `正在准备第${requestedFrame.current}幅图解…` : '三帧姿势示意 · 暂停时保持当前帧'}</small>
    </section>
  );
}
