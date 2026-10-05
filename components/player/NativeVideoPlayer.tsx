"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { UnifiedPlayerRef, VideoPlayerProps } from "./types";
import Hls from "hls.js";

export const NativeVideoPlayer = forwardRef<UnifiedPlayerRef, VideoPlayerProps>(
  function NativeVideoPlayer(
    { src, videoType, isHost = true, canControl, localSrc, onAutoplayBlocked, dataSaver = false, onFragmentBytes, onPlayerEvent, onReady, subtitleTrackUrl, subtitleSize = "m" },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryNonce, setRetryNonce] = useState(0);
    // Stable ref: fragment handler is registered once per source, while the
    // meter callback may be re-created by the parent.
    const fragmentBytesRef = useRef(onFragmentBytes);
    useEffect(() => {
      fragmentBytesRef.current = onFragmentBytes;
    });

    // "My Files" rooms play a per-device blob: URL; the shared `src` is just
    // a `localfile:<fpId>` pointer and must never be assigned to <video>.
    const effectiveSrc = videoType === "localfile" ? (localSrc ?? "") : src;
    const controlsAllowed = canControl ?? isHost;

    useImperativeHandle(
      ref,
      () => ({
        play: async () => {
          if (videoRef.current) {
            try {
              await videoRef.current.play();
            } catch (err) {
              console.warn("Autoplay / play blocked:", err);
              // Autoplay-policy blocks surface as NotAllowedError; tell the
              // room so it can show a tap-to-play overlay (iOS Safari needs
              // a real user gesture for playback with sound).
              if (
                err instanceof DOMException &&
                err.name === "NotAllowedError"
              ) {
                onAutoplayBlocked?.();
              }
            }
          }
        },
        pause: () => {
          if (videoRef.current) {
            videoRef.current.pause();
          }
        },
        seek: (seconds: number) => {
          if (videoRef.current) {
            videoRef.current.currentTime = seconds;
          }
        },
        getCurrentTime: () => {
          return videoRef.current?.currentTime || 0;
        },
        getDuration: () => {
          return videoRef.current?.duration || 0;
        },
        isPaused: () => {
          return videoRef.current?.paused ?? true;
        },
        getVideoElement: () => videoRef.current,
        setPlaybackRate: (rate: number) => {
          const video = videoRef.current;
          if (!video || !Number.isFinite(rate)) return;
          try {
            video.playbackRate = Math.min(1.25, Math.max(0.75, rate));
          } catch {
            // read-only on some embedded players — seeking covers it
          }
        },
        requestFullscreen: () => {
          const video = videoRef.current;
          if (!video) return;
          const safariVideo = video as HTMLVideoElement & {
            webkitEnterFullscreen?: () => void;
          };
          // iPhone Safari has no element fullscreen API — the native video
          // fullscreen method is the only path. Elsewhere, prefer the
          // standard API and fall back to webkit.
          if (typeof video.requestFullscreen === "function") {
            video.requestFullscreen().catch(() => {
              safariVideo.webkitEnterFullscreen?.();
            });
          } else {
            safariVideo.webkitEnterFullscreen?.();
          }
        },
      }),
      [onAutoplayBlocked]
    );

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !effectiveSrc) return;

      setIsLoaded(false);
      setLoadError(null);

      const markReady = () => {
        setIsLoaded(true);
        setLoadError(null);
        onReady?.();
      };
      const markError = () => {
        // Most common causes: expiring googlevideo signature, hotlink
        // protection, or a wrong URL (HTML page instead of a video file).
        setLoadError(
          videoType === "mp4"
            ? "This video file could not be loaded. It may have expired (YouTube-extracted MP4 links expire fast), block hotlinking, or need an exact .mp4 URL."
            : "This stream could not be loaded. Check the URL and try again."
        );
      };

      if (videoType === "hls") {
        if (Hls.isSupported()) {
          if (hlsRef.current) {
            hlsRef.current.destroy();
          }
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
          });
          hlsRef.current = hls;

          hls.loadSource(effectiveSrc);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setIsLoaded(true);
            onReady?.();
          });

          // Report exact downloaded bytes for the session data meter.
          hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
            try {
              const loaded = data?.frag?.stats?.loaded;
              if (typeof loaded === "number" && loaded > 0) {
                fragmentBytesRef.current?.(loaded);
              }
            } catch {
              // meter is best-effort
            }
          });

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  hls.recoverMediaError();
                  break;
                default:
                  setLoadError(
                    "This stream could not be loaded. Check the URL and try again."
                  );
                  hls.destroy();
                  break;
              }
            }
          });
          video.addEventListener("error", markError);
          return () => {
            video.removeEventListener("error", markError);
            if (hlsRef.current) {
              hlsRef.current.destroy();
              hlsRef.current = null;
            }
          };
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // Native Safari HLS
          video.src = effectiveSrc;
          try {
            video.load();
          } catch {
            // older Safari — src assignment is enough
          }
          video.addEventListener("loadedmetadata", markReady);
          video.addEventListener("loadeddata", markReady);
          video.addEventListener("error", markError);
          return () => {
            video.removeEventListener("loadedmetadata", markReady);
            video.removeEventListener("loadeddata", markReady);
            video.removeEventListener("error", markError);
          };
        }
      } else {
        // Direct MP4 / WebM / local blob: URL. Assign + explicit load() so
        // the element actually fetches (some browsers stall on src alone),
        // and surface errors instead of a forever-black frame.
        video.src = effectiveSrc;
        try {
          video.load();
        } catch {
          // load() unsupported — src assignment still plays
        }
        video.addEventListener("loadedmetadata", markReady);
        video.addEventListener("loadeddata", markReady);
        video.addEventListener("canplay", markReady);
        video.addEventListener("error", markError);
        return () => {
          video.removeEventListener("loadedmetadata", markReady);
          video.removeEventListener("loadeddata", markReady);
          video.removeEventListener("canplay", markReady);
          video.removeEventListener("error", markError);
        };
      }

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }, [effectiveSrc, videoType, retryNonce]);

    // Data Saver: pin HLS to its lowest rendition instead of letting ABR
    // climb. Separate from the load effect so toggling never remounts the
    // stream — exact savings surface through FRAG_LOADED byte reports.
    useEffect(() => {
      if (!dataSaver || videoType !== "hls" || !isLoaded) return;
      const hls = hlsRef.current;
      if (!hls || !hls.levels || hls.levels.length < 2) return;
      try {
        if (hls.currentLevel !== 0) hls.currentLevel = 0;
      } catch {
        // keep auto level selection
      }
    }, [dataSaver, videoType, isLoaded]);

    // Handle HTML5 video events
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handlePlay = () => {
        onPlayerEvent?.({
          type: "play",
          position: video.currentTime,
          serverTimestamp: Date.now(),
        });
      };

      const handlePause = () => {
        onPlayerEvent?.({
          type: "pause",
          position: video.currentTime,
          serverTimestamp: Date.now(),
        });
      };

      const handleSeeked = () => {
        onPlayerEvent?.({
          type: "seek",
          position: video.currentTime,
          serverTimestamp: Date.now(),
        });
      };

      const handleWaiting = () => {
        onPlayerEvent?.({
          type: "buffering",
          position: video.currentTime,
          serverTimestamp: Date.now(),
        });
      };

      const handleEnded = () => {
        onPlayerEvent?.({
          type: "ended",
          position: video.currentTime,
          serverTimestamp: Date.now(),
        });
      };

      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      video.addEventListener("seeked", handleSeeked);
      video.addEventListener("waiting", handleWaiting);
      video.addEventListener("ended", handleEnded);

      return () => {
        video.removeEventListener("play", handlePlay);
        video.removeEventListener("pause", handlePause);
        video.removeEventListener("seeked", handleSeeked);
        video.removeEventListener("waiting", handleWaiting);
        video.removeEventListener("ended", handleEnded);
      };
    }, [onPlayerEvent]);

    // No local copy selected yet (My Files rooms): placeholder instead of a
    // broken player. The room renders the file picker gate above this.
    if (videoType === "localfile" && !localSrc) {
      return (
        <div className="relative h-full w-full bg-black flex flex-col items-center justify-center gap-2 p-6 text-center">
          <span className="text-3xl" aria-hidden>📁</span>
          <p className="text-xs sm:text-sm font-medium text-zinc-200">
            No local file selected
          </p>
          <p className="text-[11px] sm:text-xs text-zinc-400 max-w-xs">
            Pick the same movie file on this device to join synced playback.
          </p>
        </div>
      );
    }

    return (
      <div className="relative h-full w-full bg-black flex items-center justify-center">
        {/* Per-user caption size. ::cue must live in document CSS (not the
            shadow DOM) — one tiny style tag, same render path on iPhone
            Safari and Android Chrome. */}
        <style>{`video.syncme-subs::cue{font-size:${subtitleSize === "s" ? "14px" : subtitleSize === "l" ? "24px" : "18px"};line-height:1.35;color:#fff;background:rgba(0,0,0,.65);text-shadow:0 1px 2px rgba(0,0,0,.8);}`}</style>
        <video
          ref={videoRef}
          controls={controlsAllowed}
          playsInline
          preload="auto"
          // crossOrigin is ONLY safe when we attach a <track> (subtitles).
          // Setting it unconditionally breaks plain MP4 hosts that don't
          // send CORS headers — the video loads but never plays (black
          // frame). Local blob: URLs never need it either.
          {...(subtitleTrackUrl ? { crossOrigin: "anonymous" as const } : {})}
          className="h-full w-full object-contain syncme-subs"
        >
          {/* Keyed track: swapping languages remounts only the track node —
              the video element (and synced playback position) is untouched. */}
          {subtitleTrackUrl && (
            <track
              key={subtitleTrackUrl}
              kind="subtitles"
              src={subtitleTrackUrl}
              default
            />
          )}
        </video>
        {/* Loading spinner while the file/stream opens */}
        {!isLoaded && !loadError && effectiveSrc && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 p-6 text-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" aria-hidden />
            <p className="text-[11px] text-zinc-300">Loading video…</p>
          </div>
        )}
        {/* Visible error + retry instead of a forever-black frame */}
        {loadError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-6 text-center">
            <p className="max-w-sm text-xs font-medium text-zinc-100">
              Video failed to load
            </p>
            <p className="max-w-sm text-[11px] leading-relaxed text-zinc-400">
              {loadError}
            </p>
            <button
              type="button"
              onClick={() => setRetryNonce((n) => n + 1)}
              className="mt-1 min-h-11 rounded-lg border border-white/20 bg-white/10 px-4 text-xs font-semibold text-white"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    );
  }
);
