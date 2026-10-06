"use client";

import { useId, useMemo } from "react";
import { Card } from "@/components/ui/card";
import type {
  ChatMessage,
  PartyMember,
} from "@/lib/stream/realtimeClient";

const BUCKETS = 12;

function toMs(createdAt: string): number {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Catmull-Rom → cubic Bézier smoothing for the activity curve. */
function smoothLinePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x},${pts[0].y}`;
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * Room analytics — message activity as a smooth area curve (thin line,
 * soft fill, peak badge), plus top chatters and reaction breakdown.
 * Pure SVG, no chart lib. Vercel-style: neutral borders, text-only.
 */
export function ActivityCurve({
  activity,
  bucketTimes,
  peak,
}: {
  activity: number[];
  bucketTimes: number[];
  peak: number;
}) {
  const gradientId = useId();
  const W = 600;
  const H = 184;
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_TOP = 28;
  const PAD_BOTTOM = 24;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_TOP - PAD_BOTTOM;
  const base = PAD_TOP + plotH;

  const pts = activity.map((c, i) => ({
    x: PAD_L + (i / Math.max(1, activity.length - 1)) * plotW,
    y: base - (Math.max(0, c) / Math.max(1, peak)) * plotH,
  }));
  const line = smoothLinePath(pts);
  const area = `${line} L ${pts[pts.length - 1].x.toFixed(1)},${base} L ${pts[0].x.toFixed(1)},${base} Z`;

  const peakIndex = activity.indexOf(Math.max(...activity));
  const peakPt = pts[Math.max(0, peakIndex)];
  const badgeW = 38;
  const badgeH = 18;
  const badgeX = Math.min(
    Math.max(peakPt.x - badgeW / 2, 2),
    W - badgeW - 2
  );
  const badgeY = Math.max(2, peakPt.y - badgeH - 8);

  const fmtTick = (ts: number) =>
    new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  const tickIndexes = [0, 3, 6, 9, activity.length - 1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 w-full"
      role="img"
      aria-label={`Message activity across the session, peak ${peak} per slice`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="text-foreground" stopColor="currentColor" stopOpacity="0.14" />
          <stop offset="100%" className="text-foreground" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Dotted vertical gridlines at the labeled ticks */}
      {tickIndexes.map((i) => {
        const x = PAD_L + (i / Math.max(1, activity.length - 1)) * plotW;
        return (
          <line
            key={i}
            x1={x}
            y1={PAD_TOP - 6}
            x2={x}
            y2={base}
            className="stroke-border"
            strokeWidth="1"
            strokeDasharray="2 4"
            opacity="0.9"
          />
        );
      })}

      {/* Soft area fill */}
      <path d={area} fill={`url(#${gradientId})`} />

      {/* Smooth curve */}
      <path
        d={line}
        fill="none"
        className="stroke-foreground"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Peak value badge */}
      <g>
        <rect
          x={badgeX}
          y={badgeY}
          width={badgeW}
          height={badgeH}
          rx="3"
          className="fill-foreground"
        />
        <text
          x={badgeX + badgeW / 2}
          y={badgeY + 13}
          textAnchor="middle"
          fontSize="11"
          fontWeight="600"
          className="fill-background tabular-nums"
        >
          {peak}
        </text>
      </g>

      {/* Time labels */}
      {tickIndexes.map((i) => {
        const x = PAD_L + (i / Math.max(1, activity.length - 1)) * plotW;
        return (
          <text
            key={i}
            x={x}
            y={H - 8}
            textAnchor="middle"
            fontSize="10"
            className="fill-muted-foreground"
          >
            {fmtTick(bucketTimes[i] ?? Date.now())}
          </text>
        );
      })}
    </svg>
  );
}
export function AnalyticsPanel({
  messages,
  members,
  hostId,
}: {
  messages: ChatMessage[];
  members: PartyMember[];
  hostId: string;
}) {
  const stats = useMemo(() => {
    const visible = messages.filter((m) => !m.deleted);
    let reactions = 0;
    const emojiCounts = new Map<string, number>();
    const chatterCounts = new Map<string, { name: string; count: number }>();
    let moments = 0;
    let media = 0;

    for (const m of visible) {
      const entry = chatterCounts.get(m.user.id) ?? {
        name: m.user.id === hostId ? `${m.user.name} 👑` : m.user.name,
        count: 0,
      };
      entry.count += 1;
      chatterCounts.set(m.user.id, entry);
      if (typeof m.moment === "number") moments += 1;
      if (m.attachment) media += 1;
      const rs = m.reactions ?? {};
      for (const [emoji, users] of Object.entries(rs)) {
        const n = users.length;
        reactions += n;
        emojiCounts.set(emoji, (emojiCounts.get(emoji) ?? 0) + n);
      }
    }

    // Activity over the session span (12 slices) + per-slice timestamps
    // for the curve's time labels.
    const times = visible.map((m) => toMs(m.createdAt)).filter((t) => t > 0);
    const activity: number[] = new Array(BUCKETS).fill(0);
    let bucketTimes: number[] = new Array(BUCKETS).fill(0);
    let spanLabel: string | null = null;
    if (times.length > 0) {
      const min = Math.min(...times);
      const max = Math.max(...times);
      const span = Math.max(max - min, 60_000);
      for (const t of times) {
        const i = Math.min(
          BUCKETS - 1,
          Math.floor(((t - min) / span) * BUCKETS)
        );
        activity[i] += 1;
      }
      bucketTimes = activity.map((_, i) => min + ((i + 0.5) / BUCKETS) * span);
      const fmt = (ts: number) =>
        new Date(ts).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      spanLabel = `${fmt(min)} → ${fmt(min + span)}`;
    }

    const topChatters = [...chatterCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const topEmoji = [...emojiCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    const peak = Math.max(1, ...activity);

    return {
      totalMessages: visible.length,
      reactions,
      chatters: chatterCounts.size,
      moments,
      media,
      members: members.length,
      activity,
      bucketTimes,
      spanLabel,
      topChatters,
      topEmoji,
      peak,
    };
  }, [messages, members, hostId]);

  const tiles = [
    { label: "Messages", value: stats.totalMessages },
    { label: "Reactions", value: stats.reactions },
    { label: "Chatters", value: stats.chatters },
    { label: "Watching", value: stats.members },
  ];

  return (
    <div className="no-scrollbar flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain">
      {/* Stat tiles */}
      <div className="grid shrink-0 grid-cols-2 gap-2" role="list" aria-label="Room totals">
        {tiles.map((t) => (
          <Card
            key={t.label}
            role="listitem"
            className="rounded-lg border-border bg-card px-3 py-2.5"
          >
            <p className="text-xl font-semibold tabular-nums text-foreground">
              {t.value}
            </p>
            <p className="text-[11px] text-muted-foreground">{t.label}</p>
          </Card>
        ))}
      </div>

      {/* Activity over time */}
      <Card className="shrink-0 rounded-lg border-border bg-card p-3 sm:p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Activity
          </h3>
          {stats.spanLabel && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {stats.spanLabel}
            </span>
          )}
        </div>
        {stats.totalMessages === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No activity yet — say hello and watch the curve move.
          </p>
        ) : (
          <>
            <ActivityCurve
              activity={stats.activity}
              bucketTimes={stats.bucketTimes}
              peak={stats.peak}
            />
            <div className="mt-2 border-t border-border pt-1.5 font-mono text-[10px] text-muted-foreground">
              peak {stats.peak}/slice
              {stats.moments > 0 ? ` · ${stats.moments} pinned moment${stats.moments === 1 ? "" : "s"}` : ""}
              {stats.media > 0 ? ` · ${stats.media} media` : ""}
            </div>
          </>
        )}
      </Card>

      {/* Top chatters */}
      <Card className="shrink-0 rounded-lg border-border bg-card p-3 sm:p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Top chatters
        </h3>
        {stats.topChatters.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nobody has chatted yet.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {stats.topChatters.map((c) => (
              <li key={c.name} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {c.name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {c.count}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground"
                    style={{
                      width: `${Math.max(4, (c.count / Math.max(1, stats.topChatters[0].count)) * 100)}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Reactions */}
      <Card className="shrink-0 rounded-lg border-border bg-card p-3 sm:p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Reactions
        </h3>
        {stats.topEmoji.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No reactions yet — long-press a message to react.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {stats.topEmoji.map(([emoji, n]) => (
              <li key={emoji} className="flex items-center gap-2.5">
                <span className="w-6 shrink-0 text-center text-base" aria-hidden>
                  {emoji}
                </span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground"
                    style={{
                      width: `${Math.max(4, (n / Math.max(1, stats.topEmoji[0][1])) * 100)}%`,
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {n}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
