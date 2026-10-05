"use client";

import { useMemo } from "react";
import { fmtClock, HEATMAP_BUCKET_SEC } from "@/lib/replay/highlights";

/**
 * Monochrome reaction heatmap line with labeled peaks. Pure SVG — no chart
 * lib, light on low-end Android phones and iPhones. Uses currentColor so it
 * follows the theme (Vercel-style, no glow).
 */
export function Heatmap({
  buckets,
  peaks,
  durationSec,
  onSeek,
}: {
  buckets: number[];
  peaks: { t: number; count: number; label: string }[];
  durationSec: number;
  onSeek?: (seconds: number) => void;
}) {
  const W = 600;
  const H = 120;
  const PAD = 8;

  const { path, area, ticks } = useMemo(() => {
    const max = Math.max(1, ...buckets);
    const n = Math.max(1, buckets.length);
    const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2));
    const y = (c: number) => H - 22 - (c / max) * (H - 40);
    const pts = buckets.map((c, i) => ({ x: x(i), y: y(c) }));
    // Catmull-Rom → cubic bezier for the smooth curve.
    let d = pts.length > 0 ? `M ${pts[0].x},${pts[0].y}` : "";
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    const area = `${d} L ${x(n - 1)},${H - 22} L ${x(0)},${H - 22} Z`;
    // X ticks: 0, 25%, 50%, 75%, end.
    const total = Math.max(durationSec, buckets.length * HEATMAP_BUCKET_SEC, 1);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
      x: PAD + f * (W - PAD * 2),
      label: fmtClock(total * f),
    }));
    return { path: d, area, ticks };
  }, [buckets, durationSec]);

  const max = Math.max(1, ...buckets);
  const n = Math.max(1, buckets.length);
  const px = (t: number) => {
    const i = t / HEATMAP_BUCKET_SEC;
    return n <= 1 ? W / 2 : PAD + (Math.min(i, n - 1) / (n - 1)) * (W - PAD * 2);
  };

  return (
    <div className="w-full text-foreground">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-28 w-full"
        role="img"
        aria-label="Reaction heatmap across the party"
        onClick={
          onSeek
            ? (e) => {
                const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                const total = Math.max(durationSec, buckets.length * HEATMAP_BUCKET_SEC, 1);
                onSeek(f * total);
              }
            : undefined
        }
        style={onSeek ? { cursor: "pointer" } : undefined}
      >
        <path d={area} fill="currentColor" opacity="0.12" />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {peaks.map((p, i) => {
          const cx = px(p.t);
          const cy = H - 22 - ((p.count || 0) / max) * (H - 40);
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r="4.5" fill="currentColor" />
              <text x={cx} y={Math.max(12, cy - 10)} textAnchor="middle" fontSize="11" fill="currentColor" fontWeight="700">
                {fmtClock(p.t)}
              </text>
            </g>
          );
        })}
        {ticks.map((t, i) => (
          <text key={i} x={t.x} y={H - 6} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.55" className="fill-muted-foreground">
            {t.label}
          </text>
        ))}
      </svg>
      {peaks.length > 0 && (
        <p className="mt-1 text-center text-xs font-semibold text-foreground" role="status">
          Peak moment — {peaks[0].label}
        </p>
      )}
    </div>
  );
}
