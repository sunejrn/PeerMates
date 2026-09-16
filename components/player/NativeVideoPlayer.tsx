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
    { src, videoType, isHost = true, onPlayerEvent, onReady },
    ref
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        play: async () => {
          if (videoRef.current) {
            try {
              await videoRef.current.play();
            } catch (err) {
              console.warn("Autoplay / play blocked:", err);
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
      }),
      []
    );

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !src) return;

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

          hls.loadSource(src);
          hls.attachMedia(video);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setIsLoaded(true);
            onReady?.();
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
          video.src = src;
          video.addEventListener("loadedmetadata", () => {
            setIsLoaded(true);
            onReady?.();
          });
        }
      } else {
        // Direct MP4 / WebM
        video.src = src;
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
    }, [src, videoType]);

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

    return (
      <div className="relative h-full w-full bg-black flex items-center justify-center">
        <video
          ref={videoRef}
          controls={isHost}
          playsInline
          className="h-full w-full object-contain"
        />
      </div>
    );
  }
);
