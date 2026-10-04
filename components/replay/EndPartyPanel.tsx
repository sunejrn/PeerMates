"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { WrappedCard, type WrappedMeta } from "./WrappedCard";

type Visibility = "public" | "circle" | "private";

const OPTIONS: { id: Visibility; title: string; desc: string }[] = [
  { id: "public", title: "🌍 Public link", desc: "Anyone with the link can relive it." },
  { id: "circle", title: "⭕ Circle only", desc: "Only people who were at the party." },
  { id: "private", title: "🔒 Private", desc: "Only you (the host) can open it." },
];

/**
 * Host-only end-of-party panel: choose replay visibility (or discard),
 * then save. Server re-validates host on every call. Renders nothing for
 * non-hosts.
 */
export function EndPartyPanel({
  slug,
  actorId,
  isHost,
  viewerCount,
  getDuration,
}: {
  slug: string;
  actorId: string;
  isHost: boolean;
  viewerCount: number;
  getDuration: () => number;
}) {
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<WrappedMeta | null>(null);

  if (!isHost) return null;

  const finalize = async (vis: Visibility | "discard") => {
    if (vis === "discard") setDiscarding(true);
    else setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${slug}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visibility: vis,
          durationSec: Math.floor(getDuration()),
          actorId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Couldn't save the replay.");
      if (vis === "discard") {
        toast.success("Replay discarded — nothing was kept.");
        return;
      }
      const row = data.row;
      setSaved({
        id: row.id,
        title: row.title,
        durationSec: row.durationSec,
        viewerCount: row.viewerCount,
        buckets: row.buckets ?? [],
        peaks: row.peaks ?? [],
        topEmoji: row.topEmoji ?? null,
        endedAt: row.endedAt,
      });
      toast.success("Party Wrapped is ready! 🎉");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't save the replay.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
      setDiscarding(false);
    }
  };

  if (saved) return <WrappedCard meta={saved} />;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          🏁 End party &amp; save replay
        </h3>
        <span className="text-[11px] text-muted-foreground font-mono">
          {viewerCount} {viewerCount === 1 ? "viewer" : "viewers"} here
        </span>
      </div>

      <div className="grid gap-1.5" role="radiogroup" aria-label="Replay visibility">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={visibility === o.id}
            onClick={() => setVisibility(o.id)}
            className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-left cursor-pointer ${
              visibility === o.id
                ? "border-violet-500 bg-violet-500/10"
                : "border-border bg-background/50"
            }`}
          >
            <span className="text-base" aria-hidden>
              {visibility === o.id ? "🔘" : "⚪"}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold text-foreground">{o.title}</span>
              <span className="block text-[11px] text-muted-foreground">{o.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        ⚖️ Only timestamps, chat text, and reaction emoji are kept — never the
        video file. Members can delete their own moments from the replay later.
      </p>

      {error && (
        <p className="text-xs text-red-600 dark:text-red-400 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2" role="alert">
          ❌ {error}
        </p>
      )}

      <div className="flex flex-col min-[420px]:flex-row gap-2">
        <Button
          type="button"
          onClick={() => void finalize(visibility)}
          disabled={saving || discarding}
          className="h-12 min-h-11 flex-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <Spinner className="text-white" /> Building Wrapped…
            </span>
          ) : (
            "💾 Save replay"
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void finalize("discard")}
          disabled={saving || discarding}
          className="h-12 min-h-11 px-4 text-xs text-red-500 border-red-500/30 cursor-pointer disabled:opacity-50"
        >
          {discarding ? <Spinner /> : "🗑 Discard"}
        </Button>
      </div>
    </Card>
  );
}
