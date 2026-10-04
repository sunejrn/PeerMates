/**
 * Party Replay highlights engine — pure functions, import-safe for server
 * routes and the browser (no DOM, no Node APIs).
 *
 * Heatmap: reactions-per-10-seconds across the runtime. Peaks: top
 * non-adjacent buckets labeled for the scrubber and the Wrapped card.
 */

import type { BufferedReplayEvent } from "@/lib/redis/replay";

export const HEATMAP_BUCKET_SEC = 10;

export interface HeatPeak {
  t: number;
  count: number;
  label: string;
}

export interface ReplayHighlights {
  laugh: { t: number; count: number };
  shock: { t: number; count: number };
  topVoice: { userName: string; t: number; duration: number } | null;
  chatter: { name: string; count: number } | null;
  firstReactor: { name: string; t: number } | null;
  peakLabel: string;
}

const LAUGH = new Set(["😂", "🤣", "😹", "😆", "😄", "😁", "🤭", "😜"]);
const SHOCK = new Set(["😮", "😱", "😳", "🤯", "🙀", "😲", "😨"]);

/** 01:12:45 / 04:07 — scrubber, peaks, and Wrapped card share this. */
export function fmtClock(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function emojiOf(e: BufferedReplayEvent): string {
  const v = (e.payload as Record<string, unknown> | undefined)?.emoji;
  return typeof v === "string" ? v : "";
}

/** Reactions-per-10s curve. Index i covers [i*10, i*10+10). */
export function buildBuckets(
  events: BufferedReplayEvent[],
  durationSec: number
): number[] {
  const n = Math.max(1, Math.ceil(Math.max(0, durationSec) / HEATMAP_BUCKET_SEC));
  const buckets = new Array<number>(n).fill(0);
  for (const e of events) {
    if (e.type !== "reaction") continue;
    const i = Math.floor(Math.max(0, e.videoTime) / HEATMAP_BUCKET_SEC);
    if (i < n) buckets[i] += 1;
  }
  return buckets;
}

/** Top 3 non-adjacent buckets (a peak claims its neighbors). */
export function detectPeaks(buckets: number[], top = 3): HeatPeak[] {
  const order = buckets
    .map((count, i) => ({ count, i }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count);
  const taken = new Set<number>();
  const peaks: HeatPeak[] = [];
  for (const b of order) {
    if (peaks.length >= top) break;
    if (taken.has(b.i)) continue;
    taken.add(b.i - 1);
    taken.add(b.i);
    taken.add(b.i + 1);
    peaks.push({
      t: b.i * HEATMAP_BUCKET_SEC,
      count: b.count,
      label:
        peaks.length === 0
          ? `Everyone lost it here ${fmtClock(b.i * HEATMAP_BUCKET_SEC)}`
          : `Peak ${peaks.length + 1} · ${fmtClock(b.i * HEATMAP_BUCKET_SEC)}`,
    });
  }
  return peaks.sort((a, b) => a.t - b.t);
}

export function computeHighlights(
  events: BufferedReplayEvent[],
  peaks: HeatPeak[]
): ReplayHighlights {
  const laughAt = new Map<number, number>();
  const shockAt = new Map<number, number>();
  const chatCount = new Map<string, { name: string; count: number }>();
  let firstReaction: BufferedReplayEvent | null = null;
  let topEmoji = "";
  const emojiCount = new Map<string, number>();

  for (const e of events) {
    if (e.type === "reaction") {
      const emoji = emojiOf(e);
      if (emoji) {
        emojiCount.set(emoji, (emojiCount.get(emoji) ?? 0) + 1);
        const bucket = Math.floor(Math.max(0, e.videoTime) / HEATMAP_BUCKET_SEC);
        if (LAUGH.has(emoji)) laughAt.set(bucket, (laughAt.get(bucket) ?? 0) + 1);
        if (SHOCK.has(emoji)) shockAt.set(bucket, (shockAt.get(bucket) ?? 0) + 1);
      }
      if (!firstReaction || e.ts < firstReaction.ts) firstReaction = e;
    }
    if (e.type === "message" || e.type === "voice" || e.type === "pin") {
      const cur = chatCount.get(e.userId) ?? { name: e.userName || "Guest", count: 0 };
      cur.count += 1;
      if (e.userName) cur.name = e.userName;
      chatCount.set(e.userId, cur);
    }
  }

  const bestOf = (m: Map<number, number>) => {
    let bi = -1;
    let bc = 0;
    for (const [i, c] of m) {
      if (c > bc) {
        bc = c;
        bi = i;
      }
    }
    return { t: bi >= 0 ? bi * HEATMAP_BUCKET_SEC : 0, count: bc };
  };
  const laugh = bestOf(laughAt);
  const shock = bestOf(shockAt);

  // Funniest voice note: the voice note closest to the biggest laugh moment
  // (a genuine crowd reaction beats any heuristic on length).
  let topVoice: ReplayHighlights["topVoice"] = null;
  if (laugh.count > 0) {
    let best: BufferedReplayEvent | null = null;
    let bestDist = Infinity;
    for (const e of events) {
      if (e.type !== "voice") continue;
      const d = Math.abs(e.videoTime - laugh.t);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    if (best) {
      const p = (best.payload ?? {}) as Record<string, unknown>;
      topVoice = {
        userName: best.userName || "Guest",
        t: best.videoTime,
        duration: typeof p.duration === "number" ? p.duration : 0,
      };
    }
  }

  let chatter: ReplayHighlights["chatter"] = null;
  for (const v of chatCount.values()) {
    if (!chatter || v.count > chatter.count) chatter = v;
  }

  // Most-used emoji doubles as the Wrapped card's top emoji.
  for (const [emoji, c] of emojiCount) {
    if (!topEmoji || c > (emojiCount.get(topEmoji) ?? 0)) topEmoji = emoji;
  }

  return {
    laugh,
    shock,
    topVoice,
    chatter,
    firstReactor: firstReaction
      ? { name: firstReaction.userName || "Guest", t: firstReaction.videoTime }
      : null,
    peakLabel:
      peaks.length > 0
        ? peaks[0].label
        : "No peaks yet — be the first to react!",
  };
}

export function topEmojiOf(events: BufferedReplayEvent[]): string | null {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "reaction") continue;
    const emoji = emojiOf(e);
    if (emoji) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [emoji, c] of counts) {
    if (!best || c > (counts.get(best) ?? 0)) best = emoji;
  }
  return best;
}
