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
    { src, videoType, isHost = true, canControl, localSrc, onAutoplayBlocked, dataSaver = false, onFragmentBytes, onPlayerEvent, onReady },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
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
                  hls.destroy();
                  break;
              }
            }
          });
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          // Native Safari HLS
          video.src = effectiveSrc;
          video.addEventListener("loadedmetadata", () => {
            setIsLoaded(true);
            onReady?.();
          });
        }
      } else {
        // Direct MP4 / WebM / local blob: URL
        video.src = effectiveSrc;
        const handleLoaded = () => {
          setIsLoaded(true);
          onReady?.();
        };
        video.addEventListener("loadedmetadata", handleLoaded);
        return () => {
          video.removeEventListener("loadedmetadata", handleLoaded);
        };
      }

      return () => {
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }, [effectiveSrc, videoType]);

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
        <video
          ref={videoRef}
          controls={controlsAllowed}
          playsInline
          className="h-full w-full object-contain"
        />
      </div>
    );
  }
);
