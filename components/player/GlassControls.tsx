"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface GlassControlsProps {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isHost: boolean;
  /** Overrides the role label (e.g. co-host). Defaults from isHost. */
  controlLabel?: string;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
  onToggleFullscreen?: () => void;
  /** "Pin to moment" markers from chat. Tapping jumps when allowed. */
  markers?: { id: string; seconds: number }[];
  onMarkerTap?: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const mm = m < 10 ? `0${m}` : `${m}`;
  const ss = s < 10 ? `0${s}` : `${s}`;
  return `${mm}:${ss}`;
}

export function GlassControls({
  isPlaying,
  currentTime,
  duration,
  isHost,
  controlLabel,
  onPlay,
  onPause,
  onSeek,
  onToggleFullscreen,
  markers = [],
  onMarkerTap,
}: GlassControlsProps) {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (!isScrubbing) {
      setScrubValue(currentTime);
    }
  }, [currentTime, isScrubbing]);

  const displayTime = isScrubbing ? scrubValue : currentTime;
  const progressPercent = duration > 0 ? (displayTime / duration) * 100 : 0;

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setScrubValue(val);
  };

  const handleSeekCommit = () => {
    setIsScrubbing(false);
    onSeek(scrubValue);
  };

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 p-2 sm:p-4 bg-linear-to-t from-black/80 via-black/40 to-transparent transition-opacity duration-300 pointer-events-auto">
      {/* Floating Glassmorphic Container */}
      <div className="flex flex-col gap-2 rounded-xl sm:rounded-2xl border border-white/15 bg-background/80 dark:bg-zinc-950/75 p-2 sm:p-3 backdrop-blur-xl shadow-2xl shadow-black/50 text-foreground transition-all">
        {/* Timeline Scrubber Bar */}
        <div className="relative flex items-center w-full group/slider h-5 sm:h-6 cursor-pointer">
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            step={0.1}
            value={displayTime}
            onChange={handleSeekChange}
            onMouseDown={() => setIsScrubbing(true)}
            onTouchStart={() => setIsScrubbing(true)}
            onMouseUp={handleSeekCommit}
            onTouchEnd={handleSeekCommit}
            disabled={!isHost}
            className={`w-full h-1.5 sm:h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-violet-500 hover:accent-violet-400 transition-all ${
              !isHost ? "cursor-not-allowed opacity-80" : ""
            }`}
            style={{
              background: `linear-gradient(to right, rgb(139, 92, 246) ${progressPercent}%, rgba(120, 120, 120, 0.25) ${progressPercent}%)`,
            }}
          />
          {/* Pinned-moment markers from chat (host/co-host taps jump). */}
          {duration > 0 && markers.length > 0 && (
            <div className="pointer-events-none absolute inset-0" aria-hidden={!onMarkerTap}>
              {markers.map((m) => {
                const pct = Math.min(100, Math.max(0, (m.seconds / duration) * 100));
                return onMarkerTap ? (
                  <button
                    key={m.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkerTap(m.seconds);
                    }}
                    aria-label={`Jump to pinned moment ${formatTime(m.seconds)}`}
                    title={`📌 Pinned moment ${formatTime(m.seconds)}`}
                    className="pointer-events-auto absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[8px] text-black shadow cursor-pointer"
                    style={{ left: `${pct}%` }}
                  >
                    📌
                  </button>
                ) : (
                  <span
                    key={m.id}
                    title={`📌 Pinned moment ${formatTime(m.seconds)} (host can jump)`}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-amber-400/80 text-[7px] shadow"
                    style={{ left: `${pct}%` }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Action Controls Row */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Play/Pause, Seek Buttons & Timestamps */}
          <div className="flex items-center gap-1.5 sm:gap-3">
            {/* Play/Pause Button - min 44x44px hit target for touch accessibility */}
            {isHost ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={isPlaying ? onPause : onPlay}
                className="h-10 w-10 sm:h-9 sm:w-9 rounded-full bg-primary/10 hover:bg-primary/20 text-primary hover:text-primary transition-transform active:scale-95 cursor-pointer"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 fill-current ml-0.5" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </Button>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                <span className="hidden xs:inline">Synced</span>
              </div>
            )}

            {/* Timestamps */}
            <div className="text-[11px] sm:text-xs font-mono text-muted-foreground select-none">
              <span className="text-foreground font-semibold">
                {formatTime(displayTime)}
              </span>
              <span className="mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right: Role indicator & Fullscreen */}
          <div className="flex items-center gap-2">
            {isHost ? (
              <span className="hidden sm:inline-flex text-[11px] font-medium text-amber-400/90 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                {controlLabel ?? "👑 Host Controlling"}
              </span>
            ) : (
              <span className="hidden sm:inline-flex text-[11px] font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md border border-border/40">
                Follower
              </span>
            )}

            {/* Fullscreen Button */}
            {onToggleFullscreen && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onToggleFullscreen}
                className="h-10 w-10 sm:h-9 sm:w-9 text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label="Toggle Fullscreen"
              >
                <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                </svg>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
