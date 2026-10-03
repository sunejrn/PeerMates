"use client";

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect,
} from "react";
import { UnifiedPlayerRef, VideoPlayerProps } from "./types";
import { YouTubePlayer } from "./YouTubePlayer";
import { NativeVideoPlayer } from "./NativeVideoPlayer";
import { GlassControls } from "./GlassControls";
import { Badge } from "@/components/ui/badge";

export const VideoPlayer = forwardRef<UnifiedPlayerRef, VideoPlayerProps>(
  function VideoPlayer(props, ref) {
    const {
      videoType,
      isHost = true,
      canControl: canControlProp,
      roleBadge,
      onPlayerEvent,
    } = props;
    const canControl = canControlProp ?? isHost;
    const badge: "host" | "cohost" | "viewer" =
      roleBadge ?? (isHost ? "host" : "viewer");
    const innerPlayerRef = useRef<UnifiedPlayerRef>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [showControls, setShowControls] = useState(true);
    const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Forward player methods up to parent ref
    useImperativeHandle(
      ref,
      () => ({
        play: () => innerPlayerRef.current?.play(),
        pause: () => innerPlayerRef.current?.pause(),
        seek: (seconds: number) => innerPlayerRef.current?.seek(seconds),
        getCurrentTime: () => innerPlayerRef.current?.getCurrentTime() || 0,
        getDuration: () => innerPlayerRef.current?.getDuration() || 0,
        isPaused: () => innerPlayerRef.current?.isPaused() ?? true,
      }),
      []
    );

    // Poll current time & duration from active player
    useEffect(() => {
      const interval = setInterval(() => {
        if (innerPlayerRef.current) {
          const t = innerPlayerRef.current.getCurrentTime();
          const d = innerPlayerRef.current.getDuration();
          const paused = innerPlayerRef.current.isPaused();
          setCurrentTime(t);
          if (d > 0) setDuration(d);
          setIsPlaying(!paused);
        }
      }, 400);

      return () => clearInterval(interval);
    }, []);

    // Auto-hide controls after inactivity during playback
    const triggerUserActivity = () => {
      setShowControls(true);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      if (isPlaying) {
        hideTimeoutRef.current = setTimeout(() => {
          setShowControls(false);
        }, 3500);
      }
    };

    const handleToggleFullscreen = () => {
      if (!containerRef.current) return;
      if (!document.fullscreenElement) {
        containerRef.current.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    };

    return (
      <div
        ref={containerRef}
        onMouseMove={triggerUserActivity}
        onTouchStart={triggerUserActivity}
        className="group relative aspect-video w-full overflow-hidden rounded-2xl border border-border/80 bg-black shadow-2xl select-none"
      >
        {videoType === "youtube" ? (
          <YouTubePlayer ref={innerPlayerRef} {...props} />
        ) : (
          <NativeVideoPlayer ref={innerPlayerRef} {...props} />
        )}

        {/* Top Badges (Engine & Role) */}
        <div
          className={`absolute top-3 sm:top-4 left-3 sm:left-4 z-20 flex items-center gap-2 pointer-events-none transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          <Badge
            variant="outline"
            className="border-white/20 bg-black/60 backdrop-blur-md text-[10px] sm:text-[11px] font-mono text-zinc-200 uppercase px-2 sm:px-2.5 py-0.5 shadow"
          >
            {videoType}
          </Badge>

          {badge === "host" ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/20 backdrop-blur-md text-[10px] sm:text-[11px] font-medium text-amber-300 px-2 sm:px-2.5 py-0.5 flex items-center gap-1.5 shadow"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
              Host
            </Badge>
          ) : badge === "cohost" ? (
            <Badge
              variant="outline"
              className="border-cyan-500/40 bg-cyan-500/20 backdrop-blur-md text-[10px] sm:text-[11px] font-medium text-cyan-300 px-2 sm:px-2.5 py-0.5 flex items-center gap-1.5 shadow"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
              Co-host
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-violet-500/40 bg-violet-500/20 backdrop-blur-md text-[10px] sm:text-[11px] font-medium text-violet-300 px-2 sm:px-2.5 py-0.5 flex items-center gap-1.5 shadow"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Follower
            </Badge>
          )}
        </div>

        {/* Floating Glassmorphic Controls Bar */}
        <div
          className={`transition-opacity duration-300 ${
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          <GlassControls
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            isHost={canControl}
            controlLabel={
              badge === "host"
                ? "👑 Host Controlling"
                : badge === "cohost"
                  ? "🎬 Co-host Controlling"
                  : undefined
            }
            onPlay={() => innerPlayerRef.current?.play()}
            onPause={() => innerPlayerRef.current?.pause()}
            onSeek={(s) => innerPlayerRef.current?.seek(s)}
            onToggleFullscreen={handleToggleFullscreen}
          />
        </div>
      </div>
    );
  }
);
