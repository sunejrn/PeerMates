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
import { GuidedEmbedPlayer } from "./GuidedEmbedPlayer";
import { GlassControls } from "./GlassControls";
import { Badge } from "@/components/ui/badge";
import { parseEmbedSource } from "@/lib/video/detector";
import { PROVIDER_LABELS } from "@/lib/video/parseUrl";

export const VideoPlayer = forwardRef<UnifiedPlayerRef, VideoPlayerProps>(
  function VideoPlayer(props, ref) {
    const {
      videoType,
      isHost = true,
      canControl: canControlProp,
      roleBadge,
      controlLabel: controlLabelProp,
      onPlayerEvent,
      slug,
      actorId,
      clarityFilter,
      clarityOverlay,
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
        requestFullscreen: () => innerPlayerRef.current?.requestFullscreen?.(),
        getVideoElement: () =>
          innerPlayerRef.current?.getVideoElement?.() ?? null,
        setPlaybackRate: (rate: number) =>
          innerPlayerRef.current?.setPlaybackRate?.(rate),
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

    // YouTube-style auto-hide: 2s after the cursor leaves / goes idle
    // during playback the bar slides away; any cursor movement brings it back.
    const triggerUserActivity = () => {
      setShowControls(true);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      if (isPlaying) {
        hideTimeoutRef.current = setTimeout(() => {
          setShowControls(false);
        }, 2000);
      }
    };

    const handlePointerLeave = () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      if (isPlaying) {
        hideTimeoutRef.current = setTimeout(() => {
          setShowControls(false);
        }, 2000);
      }
    };

    const handleToggleFullscreen = () => {
      // Prefer the player's own implementation: native <video> uses
      // webkitEnterFullscreen on iPhone Safari where element fullscreen
      // does not exist.
      if (typeof document !== "undefined" && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
        return;
      }
      const inner = innerPlayerRef.current;
      if (inner?.requestFullscreen) {
        try {
          inner.requestFullscreen();
        } catch {
          // ignore — native controls remain available
        }
        return;
      }
      // Legacy fallback for players without their own implementation.
      containerRef.current?.requestFullscreen?.().catch(() => {});
    };

    // Embedded providers (Facebook, Vimeo, TikTok, …): official iframe +
    // guided countdown sync — the sync engine stays untouched because the
    // guided clock lives in its own tiny API.
    if (videoType === "embed") {
      const embed = parseEmbedSource(props.src);
      if (!embed) return null;
      return (
        <GuidedEmbedPlayer
          provider={embed.provider}
          providerId={embed.id}
          label={PROVIDER_LABELS[embed.provider] ?? embed.provider}
          slug={slug ?? ""}
          actorId={actorId ?? ""}
          canControl={canControl}
        />
      );
    }

    return (
      <div
        ref={containerRef}
        onMouseMove={triggerUserActivity}
        onTouchStart={triggerUserActivity}
        onMouseLeave={handlePointerLeave}
        className={`group relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black select-none ${
          showControls ? "" : "cursor-none"
        }`}
      >
        <div
          className="absolute inset-0"
          style={clarityFilter ? { filter: clarityFilter } : undefined}
        >
          {videoType === "youtube" ? (
            <YouTubePlayer ref={innerPlayerRef} {...props} />
          ) : (
            <NativeVideoPlayer ref={innerPlayerRef} {...props} />
          )}
        </div>
        {/* Clarity Ultra: WebGL canvas drawn over the native frame */}
        {clarityOverlay}

        {/* Top-left: source format only — minimal, transparent, no shadow */}
        <div
          className={`absolute top-2 left-2 z-20 pointer-events-none transition-all duration-300 ${
            showControls ? "opacity-100" : "opacity-0"
          }`}
        >
          <Badge
            variant="outline"
            className="border-white/10 bg-black/30 text-[10px] font-mono text-zinc-300 uppercase px-1.5 py-0 rounded-lg"
          >
            {videoType === "localfile" ? "My File" : videoType}
          </Badge>
        </div>

        {/* Bottom controls — slides down and hides like YouTube */}
        <div
          className={`transition-all duration-300 ${
            showControls
              ? "opacity-100 translate-y-0"
              : "opacity-0 translate-y-2 pointer-events-none"
          }`}
        >
          <GlassControls
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            isHost={canControl}
            controlLabel={
              controlLabelProp ??
              (badge === "host"
                ? "Host controlling"
                : badge === "cohost"
                  ? "Co-host controlling"
                  : undefined)
            }
            onPlay={() => innerPlayerRef.current?.play()}
            onPause={() => innerPlayerRef.current?.pause()}
            onSeek={(s) => innerPlayerRef.current?.seek(s)}
            onToggleFullscreen={handleToggleFullscreen}
            markers={props.markers}
            onMarkerTap={props.onMarkerTap}
          />
        </div>
      </div>
    );
  }
);
