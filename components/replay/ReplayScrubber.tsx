"use client";

import { useRef } from "react";
import { fmtClock } from "@/lib/replay/highlights";

/**
 * Heatmap scrubber: the 10s reaction curve as the track, peak dots tappable,
 * 48px touch height for thumbs. Pointer drag seeks.
 */
export function ReplayScrubber({
  buckets,
  peaks,
  durationSec,
  currentTime,
  onSeek,
}: {
  buckets: number[];
  peaks: { t: number; count: number; label: string }[];
  durationSec: number;
  currentTime: number;
  onSeek: (seconds: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const total = Math.max(durationSec, buckets.length * 10, 1);
  const max = Math.max(1, ...buckets);

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(f * total);
  };

  return (
    <div className="w-full select-none">
      <div
        ref={trackRef}
        role="slider"
        aria-label="Replay scrubber with reaction peaks"
        aria-valuemin={0}
        aria-valuemax={Math.floor(total)}
        aria-valuenow={Math.floor(currentTime)}
        aria-valuetext={fmtClock(currentTime)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") onSeek(Math.min(total, currentTime + 10));
          if (e.key === "ArrowLeft") onSeek(Math.max(0, currentTime - 10));
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0) seekFromClientX(e.clientX);
        }}
        className="relative flex h-12 w-full cursor-pointer touch-none items-end gap-[2px] rounded-xl border border-border/60 bg-muted/30 px-2 pb-2 pt-1"
      >
        {buckets.map((c, i) => (
          <span
            key={i}
            className="min-w-0 flex-1 rounded-sm bg-gradient-to-t from-violet-600/70 to-pink-500/70"
            style={{ height: `${Math.max(8, (c / max) * 100)}%`, opacity: 0.35 + 0.65 * (c / max) }}
          />
        ))}
        {/* Progress + playhead */}
        <span
          className="pointer-events-none absolute inset-y-0 left-0 rounded-xl bg-white/10"
          style={{ width: `${Math.min(100, (currentTime / total) * 100)}%` }}
          aria-hidden
        />
        {peaks.map((p, i) => (
          <span
            key={i}
            title={p.label}
            className="absolute top-1 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-pink-500 ring-2 ring-white/70"
            style={{ left: `${(p.t / total) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
        <span>{fmtClock(currentTime)}</span>
        <span>{fmtClock(total)}</span>
      </div>
    </div>
  );
}
