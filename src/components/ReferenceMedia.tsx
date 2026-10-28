import { useCallback, useEffect, useRef, useState } from "react";
import {
  referenceMediaFor,
  type ReferenceEntry,
} from "../content/reference-media";
import {
  referenceCacheState,
  saveReferenceMedia,
  referenceOfflineAvailable,
} from "../content/reference-cache";

export default function ReferenceMedia({ exerciseId }: { exerciseId: string }) {
  const reference = referenceMediaFor(exerciseId);
  const [open, setOpen] = useState(false),
    [cached, setCached] = useState(0);
  const [state, setState] = useState<
    "idle" | "checking" | "saving" | "ready" | "error"
  >("idle");
  const [error, setError] = useState(""),
    [unavailable, setUnavailable] = useState<string[]>([]);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [offlineSupported, setOfflineSupported] = useState(false);
  const [attempts, setAttempts] = useState<Record<string, number>>({});
  const abort = useRef<AbortController | null>(null),
    version = useRef(0),
    video = useRef<HTMLVideoElement>(null);
  const storage = typeof caches === "undefined" ? undefined : caches;

  const checkCache = useCallback(() => {
    // Foreground/network events must not replace an explicit save's progress
    // or invalidate its completion. A newer check/save supersedes old results.
    if (!reference || abort.current) return;
    const request = ++version.current;
    setState("checking");
    void Promise.all([
      referenceCacheState(reference.assets, storage),
      referenceOfflineAvailable(undefined, undefined, reference.assets),
    ])
      .then(([result, supported]) => {
        if (version.current !== request) return;
        setCached(result.cached);
        setOfflineSupported(supported);
        setState(result.ready ? "ready" : "idle");
        setError(
          result.available
            ? ""
            : "当前环境无法保存离线示范，仍可在线查看与使用原SVG图解。",
        );
      })
      .catch(() => {
        if (version.current === request) {
          setState("error");
          setError("离线缓存暂不可用，示范可在线查看，原SVG图解不受影响。");
        }
      });
  }, [reference, storage]);

  useEffect(() => {
    if (!open || !reference) return;
    checkCache();
    const foreground = () => {
      if (!document.hidden) checkCache();
    };
    window.addEventListener("focus", foreground);
    window.addEventListener("online", checkCache);
    window.addEventListener("offline", checkCache);
    document.addEventListener("visibilitychange", foreground);
    navigator.serviceWorker?.addEventListener("controllerchange", checkCache);
    return () => {
      window.removeEventListener("focus", foreground);
      window.removeEventListener("online", checkCache);
      window.removeEventListener("offline", checkCache);
      document.removeEventListener("visibilitychange", foreground);
      navigator.serviceWorker?.removeEventListener(
        "controllerchange",
        checkCache,
      );
      ++version.current;
      const controller = abort.current;
      abort.current = null;
      controller?.abort();
      video.current?.pause();
    };
  }, [open, reference, checkCache]);

  useEffect(() => {
    const pause = () => {
      if (document.hidden) video.current?.pause();
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      video.current?.pause();
    };
  }, []);

  if (!reference) return null;
  const name = reference.name ?? "杠铃卧推";
  const images = reference.assets.filter((asset) => asset.kind === "image"),
    movie = reference.assets.find((asset) => asset.kind === "video");
  const totalMB = (
    reference.assets.reduce((sum, asset) => sum + asset.bytes, 0) / 1_000_000
  ).toFixed(1);

  async function save() {
    if (!reference || state === "saving") return;
    const request = ++version.current,
      controller = new AbortController();
    abort.current = controller;
    setState("saving");
    setError("");
    try {
      await saveReferenceMedia(reference.assets, {
        storage,
        signal: controller.signal,
        onProgress: (count) => {
          if (version.current === request) setCached(count);
        },
      });
      // A file checked earlier in the save may have been evicted while a later
      // download was pending. Verify the whole group before claiming readiness.
      const [result, supported] = await Promise.all([
        referenceCacheState(reference.assets, storage),
        referenceOfflineAvailable(undefined, undefined, reference.assets),
      ]);
      if (version.current === request) {
        setCached(result.cached);
        setOfflineSupported(supported);
        setState(result.ready ? "ready" : "idle");
        if (!result.ready)
          setError(
            "示范未完整保存。请保持本机服务运行并检查可用空间，然后重试；原SVG图解不受影响。",
          );
      }
    } catch (reason) {
      if (version.current !== request) return;
      setState(
        reason instanceof DOMException && reason.name === "AbortError"
          ? "idle"
          : "error",
      );
      if (!(reason instanceof DOMException && reason.name === "AbortError"))
        setError(
          "示范未完整保存。请保持本机服务运行并检查可用空间，然后重试；原SVG图解不受影响。",
        );
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  function failed(url: string) {
    setUnavailable((current) =>
      current.includes(url) ? current : [...current, url],
    );
    if (open) checkCache();
  }
  function retry(url: string) {
    setAttempts((current) => ({ ...current, [url]: (current[url] ?? 0) + 1 }));
    setUnavailable((current) => current.filter((item) => item !== url));
  }
  function loadUrl(url: string) {
    return attempts[url] ? `${url}?attempt=${attempts[url]}` : url;
  }
  function credit(asset: ReferenceEntry["assets"][number]) {
    return (
      <div className="reference-credit">
        <span>
          {asset.author} · {asset.license}
        </span>
        <span>
          <a href={asset.sourceUrl} target="_blank" rel="noreferrer">
            原始素材
          </a>
          <a href={asset.licenseUrl} target="_blank" rel="noreferrer">
            许可
          </a>
        </span>
      </div>
    );
  }

  return (
    <details
      className="reference-media wrap-cjk"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {images.length && movie
          ? "图片与视频示范"
          : images.length
            ? "图片示范"
            : "视频示范"}{" "}
        <small>
          {reference.exerciseId === "ex-bench"
            ? "卧推 · 约21秒"
            : `${name}${movie ? ` · 约${Math.round(movie.duration ?? 0)}秒` : ` · ${images.length}张`}`}
        </small>
      </summary>
      {open && (
        <div className="reference-media-body">
          <p>
            {reference.exerciseId === "ex-bench"
              ? "平凳自由杠铃卧推。两张姿势图与实拍短片补充上方讲解；镜头未展示全部站位细节，请结合中文要点观看。"
              : `${name}参考示范。${reference.note ?? ""}素材来自wger社区，请结合上方中文步骤和要点使用；镜头或静态图不展示全部技术细节。`}
          </p>
          {images.length > 0 && (
            <div className="reference-images">
              {images.map((asset) => (
                <figure
                  key={asset.url}
                  className={
                    asset.width / asset.height > 1.5
                      ? "reference-image-wide"
                      : undefined
                  }
                >
                  {unavailable.includes(asset.url) ? (
                    <div className="reference-unavailable">
                      <p>这张参考图暂不可用，仍可查看上方三帧图解。</p>
                      <button
                        className="btn btn-secondary"
                        onClick={() => retry(asset.url)}
                      >
                        重新加载参考图
                      </button>
                    </div>
                  ) : (
                    <img
                      src={loadUrl(asset.url)}
                      width={asset.width}
                      height={asset.height}
                      alt={`${name}${asset.label}参考图`}
                      loading="lazy"
                      onError={() => failed(asset.url)}
                    />
                  )}
                  <figcaption>
                    <strong>{asset.label}</strong>
                    {credit(asset)}
                    <p className="reference-file-note">
                      原图字节未改，按原许可使用。
                    </p>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {movie && (
            <section className="reference-video" aria-label={`${name}视频示范`}>
              <h3>
                {reference.exerciseId === "ex-bench"
                  ? "看一次完整的下放与推起"
                  : "观看动作过程"}
              </h3>
              {unavailable.includes(movie.url) ? (
                <div className="reference-unavailable">
                  <p>视频暂不可用，仍可查看上方三帧图解和中文讲解。</p>
                  <button
                    className="btn btn-secondary"
                    onClick={() => retry(movie.url)}
                  >
                    重新加载示范视频
                  </button>
                </div>
              ) : videoLoaded ? (
                <video
                  ref={video}
                  src={loadUrl(movie.url)}
                  poster={
                    reference.assets.find((asset) => asset.kind === "poster")
                      ?.url
                  }
                  width={movie.width}
                  height={movie.height}
                  style={{ aspectRatio: `${movie.width} / ${movie.height}` }}
                  controls
                  playsInline
                  muted
                  preload="metadata"
                  aria-label={`${name}实拍示范`}
                  onError={() => failed(movie.url)}
                />
              ) : (
                <button
                  className="btn btn-secondary reference-play"
                  onClick={() => setVideoLoaded(true)}
                >
                  {reference.exerciseId === "ex-bench"
                    ? "加载卧推视频 · 1.4 MB"
                    : `加载${name}视频 · ${(movie.bytes / 1_000_000).toFixed(1)} MB`}
                </button>
              )}
              {credit(movie)}
              <p className="reference-file-note">
                {reference.exerciseId === "ex-bench"
                  ? "原图片、视频画面与声音保持不变。素材来自wger社区，作者与许可见上方。"
                  : "视频已压缩为轻量版本，画面范围、播放速度及声音保留；封面取自片中。"}
              </p>
            </section>
          )}
          <div
            className="reference-offline"
            aria-busy={state === "saving" || state === "checking"}
          >
            <div className="row wrap">
              <button
                className="btn btn-secondary"
                disabled={
                  state === "saving" ||
                  state === "checking" ||
                  state === "ready" ||
                  !storage
                }
                onClick={() => void save()}
              >
                {state === "ready"
                  ? offlineSupported
                    ? "示范已完整保存，可离线查看"
                    : "示范文件已校验，离线服务未就绪"
                  : state === "saving"
                    ? `正在保存示范 ${cached} / ${reference.assets.length}`
                    : state === "checking"
                      ? "正在检查离线示范"
                      : "保存示范供离线使用"}
              </button>
              {state === "saving" && (
                <button
                  className="btn btn-ghost"
                  onClick={() => abort.current?.abort()}
                >
                  暂停保存示范
                </button>
              )}
            </div>
            <p aria-live="polite">
              {state === "ready"
                ? offlineSupported
                  ? `${images.length ? `${images.length}张图片` : ""}${images.length && movie ? "和" : ""}${movie ? "视频" : ""}均已校验。离线${movie ? "播放、拖动进度" : "查看"}可继续使用。`
                  : "文件已校验，但当前离线服务尚未就绪，请保持联网使用。确认训练已保存后关闭旧页面再打开，无需清除数据。"
                : `共约 ${totalMB} MB，单独保存，不影响原906张SVG图解。已校验 ${cached} / ${reference.assets.length}。`}
            </p>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </details>
  );
}
