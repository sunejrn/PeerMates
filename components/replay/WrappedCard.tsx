"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { fmtClock } from "@/lib/replay/highlights";
import { replayLink } from "@/lib/rooms/code";

export interface WrappedMeta {
  id: string;
  title: string;
  durationSec: number;
  viewerCount: number;
  buckets: number[];
  peaks: { t: number; count: number; label: string }[];
  topEmoji: string | null;
  endedAt: string;
}

function replayUrl(id: string): string {
  return replayLink(id);
}

/** Mini heatmap sparkline (SVG, no chart lib — light on low-end phones). */
export function HeatSpark({ buckets, peaks }: { buckets: number[]; peaks: WrappedMeta["peaks"] }) {
  const max = Math.max(1, ...buckets);
  const W = 280;
  const H = 56;
  const pts = buckets.map((c, i) => {
    const x = buckets.length <= 1 ? W / 2 : (i / (buckets.length - 1)) * W;
    const y = H - 6 - (c / max) * (H - 14);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const peakSet = new Set(peaks.map((p) => Math.floor(p.t / 10)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img" aria-label="Reaction heatmap">
      <defs>
        <linearGradient id="pm-heat" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="url(#pm-heat)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {buckets.map((c, i) =>
        peakSet.has(i) && c > 0 ? (
          <circle
            key={i}
            cx={buckets.length <= 1 ? W / 2 : (i / (buckets.length - 1)) * W}
            cy={H - 6 - (c / max) * (H - 14)}
            r="3.5"
            fill="#ec4899"
          />
        ) : null
      )}
    </svg>
  );
}

/**
 * Party Wrapped card: heatmap, top emoji, peak moment, viewer count, and
 * one-tap shares (WhatsApp Status, X, Instagram via download, copy link).
 * Every card links to the public /replay/[id] page with a join CTA.
 */
export function WrappedCard({ meta }: { meta: WrappedMeta }) {
  const [downloading, setDownloading] = useState(false);
  const url = replayUrl(meta.id);
  const text = `I just watched "${meta.title}" with ${meta.viewerCount} people on PeerMates — peak moment ${fmtClock(meta.peaks[0]?.t ?? 0)}! Relive it:`;

  const copyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast.success("Replay link copied!");
    } catch {
      toast.error("Copy failed on this browser.");
    }
  };

  const downloadStory = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/replay/${meta.id}/story`);
      if (!res.ok) throw new Error("Story render failed.");
      const blob = await res.blob();
      const obj = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = obj;
      a.download = `peermates-wrapped-${meta.id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(obj), 5000);
      toast.success("Story image saved — post it to Instagram Stories!");
    } catch {
      toast.error("Couldn't render the story image. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  const shareInstagram = () => {
    // No web intent exists for Instagram — download first, then post.
    toast.info("Saving the 9:16 story image — then share it to your Story in Instagram.");
    void downloadStory();
  };

  return (
    <Card className="border-border bg-card/60 p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          🎉 Party Wrapped
        </h3>
        <span className="text-[11px] text-muted-foreground font-mono">
          {meta.viewerCount} {meta.viewerCount === 1 ? "viewer" : "viewers"}
        </span>
      </div>

      <div className="rounded-xl border border-violet-500/30 bg-gradient-to-br from-violet-600/15 via-indigo-500/10 to-pink-500/15 p-3 space-y-2">
        <p className="truncate text-sm font-bold text-foreground">{meta.title}</p>
        <HeatSpark buckets={meta.buckets} peaks={meta.peaks} />
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {meta.topEmoji ? `${meta.topEmoji} top vibe · ` : ""}
            {meta.peaks.length > 0 ? meta.peaks[0].label : "No peaks yet"}
          </span>
          <a
            href={url}
            className="shrink-0 font-semibold text-violet-600 dark:text-violet-300 underline underline-offset-2"
          >
            Watch replay →
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#25D366] px-2 text-xs font-bold text-white"
          aria-label="Share to WhatsApp Status"
        >
          <span aria-hidden>💬</span> WhatsApp
        </a>
        <a
          href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-foreground px-2 text-xs font-bold text-background"
          aria-label="Share to X"
        >
          <span aria-hidden>𝕏</span> Post to X
        </a>
        <Button
          type="button"
          variant="outline"
          onClick={shareInstagram}
          disabled={downloading}
          className="min-h-11 text-xs cursor-pointer"
        >
          {downloading ? "Rendering…" : "📸 Instagram Story"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={copyLink}
          className="min-h-11 text-xs cursor-pointer"
        >
          🔗 Copy link
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        onClick={downloadStory}
        disabled={downloading}
        className="w-full min-h-11 text-xs cursor-pointer"
      >
        {downloading ? "Rendering…" : "⬇ Download story image (9:16)"}
      </Button>
    </Card>
  );
}
