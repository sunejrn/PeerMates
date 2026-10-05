"use client";

import { useMemo } from "react";
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

/**
 * Room analytics: modern monochrome bar charts of how the room is
 * interacting — message activity over time, top chatters, and reaction
 * breakdown. Pure CSS/SVG bars, no chart lib. Vercel-style: neutral
 * borders, text-only, rounded-lg.
 */
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

    // Activity over the session span (12 slices).
    const times = visible.map((m) => toMs(m.createdAt)).filter((t) => t > 0);
    const activity: number[] = new Array(BUCKETS).fill(0);
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
            No activity yet — say hello and watch the bars light up.
          </p>
        ) : (
          <>
            <div
              className="mt-3 flex h-24 items-end gap-1"
              role="img"
              aria-label={`Message activity across the session, peak ${stats.peak} per slice`}
            >
              {stats.activity.map((c, i) => (
                <div
                  key={i}
                  title={`${c} message${c === 1 ? "" : "s"}`}
                  className="flex min-w-0 flex-1 items-end self-stretch"
                >
                  <div
                    className="w-full rounded-sm bg-foreground"
                    style={{
                      height: `${Math.max(6, (c / stats.peak) * 100)}%`,
                      opacity: c === 0 ? 0.12 : 0.35 + 0.65 * (c / stats.peak),
                    }}
                  />
                </div>
              ))}
            </div>
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
