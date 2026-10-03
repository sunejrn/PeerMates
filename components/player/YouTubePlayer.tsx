"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { UnifiedPlayerRef, VideoPlayerProps } from "./types";
import { extractYouTubeId } from "@/lib/video/detector";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

export const YouTubePlayer = forwardRef<UnifiedPlayerRef, VideoPlayerProps>(
  function YouTubePlayer(
    { src, isHost = true, onPlayerEvent, onReady },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<any>(null);
    const [isPlayerReady, setIsPlayerReady] = useState(false);
    const videoId = extractYouTubeId(src);
    const lastReportedTime = useRef(0);

    // Imperative controller methods exposed to parent
    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          if (playerRef.current && isPlayerReady && playerRef.current.playVideo) {
            playerRef.current.playVideo();
          }
        },
        pause: () => {
          if (playerRef.current && isPlayerReady && playerRef.current.pauseVideo) {
            playerRef.current.pauseVideo();
          }
        },
        seek: (seconds: number) => {
          if (playerRef.current && isPlayerReady && playerRef.current.seekTo) {
            playerRef.current.seekTo(seconds, true);
          }
        },
        getCurrentTime: () => {
          if (
            playerRef.current &&
            isPlayerReady &&
            playerRef.current.getCurrentTime
          ) {
            return playerRef.current.getCurrentTime() || 0;
          }
          return 0;
        },
        getDuration: () => {
          if (
            playerRef.current &&
            isPlayerReady &&
            playerRef.current.getDuration
          ) {
            return playerRef.current.getDuration() || 0;
          }
          return 0;
        },
        isPaused: () => {
          if (
            playerRef.current &&
            isPlayerReady &&
            playerRef.current.getPlayerState
          ) {
            const state = playerRef.current.getPlayerState();
            return state !== 1; // 1 is playing
          }
          return true;
        },
        getVideoElement: () => null, // iframe-based: no media element to share
        requestFullscreen: () => {
          // Fullscreen the player container (works on desktop + Android
          // Chrome; iPhone Safari has no element fullscreen for iframes).
          try {
            const p = containerRef.current?.requestFullscreen?.() as
              | Promise<void>
              | undefined;
            p?.catch(() => {});
          } catch {
            // unsupported — the room's tap-to-play/tips cover iOS instead
          }
        },
      }),
      [isPlayerReady]
    );

    useEffect(() => {
      if (!videoId) return;

      let isMounted = true;

      const initPlayer = () => {
        if (!containerRef.current || !window.YT || !window.YT.Player) return;

        // Clean existing iframe if any
        containerRef.current.innerHTML = "";
        const playerDiv = document.createElement("div");
        containerRef.current.appendChild(playerDiv);

        playerRef.current = new window.YT.Player(playerDiv, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 0,
            controls: isHost ? 1 : 0, // Only host gets native controls if desired
            disablekb: isHost ? 0 : 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            enablejsapi: 1,
            origin: typeof window !== "undefined" ? window.location.origin : "",
          },
          events: {
            onReady: () => {
              if (!isMounted) return;
              setIsPlayerReady(true);
              onReady?.();
            },
            onStateChange: (event: any) => {
              if (!isMounted) return;
              const ytState = event.data;
              const currentTime =
                playerRef.current?.getCurrentTime() || 0;

              // 1 = PLAYING
              if (ytState === 1) {
                lastReportedTime.current = currentTime;
                onPlayerEvent?.({
                  type: "play",
                  position: currentTime,
                  serverTimestamp: Date.now(),
                });
              }
              // 2 = PAUSED
              else if (ytState === 2) {
                lastReportedTime.current = currentTime;
                onPlayerEvent?.({
                  type: "pause",
                  position: currentTime,
                  serverTimestamp: Date.now(),
                });
              }
              // 3 = BUFFERING
              else if (ytState === 3) {
                onPlayerEvent?.({
                  type: "buffering",
                  position: currentTime,
                  serverTimestamp: Date.now(),
                });
              }
              // 0 = ENDED
              else if (ytState === 0) {
                onPlayerEvent?.({
                  type: "ended",
                  position: currentTime,
                  serverTimestamp: Date.now(),
                });
              }
            },
          },
        });
      };

      if (window.YT && window.YT.Player) {
        initPlayer();
      } else {
        // Load YouTube IFrame API script
        const existingScript = document.getElementById("yt-iframe-api");
        if (!existingScript) {
          const tag = document.createElement("script");
          tag.id = "yt-iframe-api";
          tag.src = "https://www.youtube.com/iframe_api";
          const firstScriptTag = document.getElementsByTagName("script")[0];
          firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
        }

        const prevOnReady = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          prevOnReady?.();
          initPlayer();
        };
      }

      return () => {
        isMounted = false;
        if (playerRef.current && playerRef.current.destroy) {
          try {
            playerRef.current.destroy();
          } catch {}
        }
      };
    }, [videoId, isHost]);

    if (!videoId) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-zinc-400">
          Invalid YouTube Video URL
        </div>
      );
    }

    return (
      <div className="relative h-full w-full overflow-hidden bg-black">
        <div ref={containerRef} className="h-full w-full pointer-events-auto" />
      </div>
    );
  }
);
