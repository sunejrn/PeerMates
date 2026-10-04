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
    <div className="absolute inset-x-0 bottom-0 z-30 px-2 pb-1.5 pt-6 sm:pb-2 bg-linear-to-t from-black/80 via-black/30 to-transparent pointer-events-auto">
      {/* Slim control bar — stays compact so it never covers the video */}
      <div className="flex flex-col gap-1 rounded-lg border border-white/10 bg-black/55 px-2 py-1.5 text-zinc-200">
        {/* Timeline Scrubber Bar — h-1, full width */}
        <div className="relative flex items-center w-full group/slider h-4 cursor-pointer">
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
            aria-label="Seek"
            className={`w-full h-1 rounded-lg appearance-none cursor-pointer accent-white transition-all ${
              !isHost ? "cursor-not-allowed opacity-80" : ""
            }`}
            style={{
              background: `linear-gradient(to right, rgb(255,255,255) ${progressPercent}%, rgba(255,255,255,0.25) ${progressPercent}%)`,
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
                    title={`Pinned moment ${formatTime(m.seconds)}`}
                    className="pointer-events-auto absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex h-2 w-2 items-center justify-center rounded-full bg-white cursor-pointer"
                    style={{ left: `${pct}%` }}
                  >
                    <span className="sr-only">Jump</span>
                  </button>
                ) : (
                  <span
                    key={m.id}
                    title={`Pinned moment ${formatTime(m.seconds)} (host can jump)`}
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex h-1.5 w-1.5 items-center justify-center rounded-full bg-white/80"
                    style={{ left: `${pct}%` }}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Action Controls Row — compact */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Play/Pause & Timestamps */}
          <div className="flex items-center gap-1.5">
            {isHost ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={isPlaying ? onPause : onPlay}
                className="h-9 w-9 rounded-lg text-white hover:bg-white/10 hover:text-white active:scale-95 cursor-pointer"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4 fill-current ml-0.5" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </Button>
            ) : (
              <span className="px-1.5 py-0.5 text-[11px] font-medium text-zinc-300">
                Synced
              </span>
            )}

            {/* Timestamps */}
            <div className="text-[11px] font-mono text-zinc-400 select-none">
              <span className="text-zinc-100 font-medium">
                {formatTime(displayTime)}
              </span>
              <span className="mx-1">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right: Role indicator & Fullscreen */}
          <div className="flex items-center gap-1.5">
            {isHost ? (
              <span className="inline-flex h-6 items-center rounded-lg border border-white/15 bg-white/5 px-2 text-[10px] font-medium text-zinc-200">
                {controlLabel ?? "Host controlling"}
              </span>
            ) : (
              <span className="inline-flex h-6 items-center rounded-lg border border-white/15 bg-white/5 px-2 text-[10px] font-medium text-zinc-300">
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
                className="h-9 w-9 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 cursor-pointer"
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
