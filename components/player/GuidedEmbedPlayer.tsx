"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { embedUrlFor, type ProviderId } from "@/lib/video/parseUrl";
import { formatGuidedClock } from "@/lib/redis/guided";

/**
 * Guided-sync player for embeds that can't be remote-controlled
 * (Facebook, Vimeo, TikTok, Drive, …): official iframe embeds only —
 * nothing is scraped, downloaded, or proxied.
 *
 * Flow: host taps "Start countdown" → everyone sees 3-2-1 → everyone taps
 * Play on their own player → a shared expected-position timer runs and
 * "Re-sync me" tells late viewers exactly where to seek. Chat and reactions
 * keep working normally throughout.
 */
export function GuidedEmbedPlayer({
  provider,
  providerId,
  label,
  slug,
  actorId,
  canControl,
}: {
  provider: ProviderId;
  providerId: string;
  label: string;
  slug: string;
  actorId: string;
  canControl: boolean;
}) {
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [showResync, setShowResync] = useState(false);
  const startedAtRef = useRef(0);
  startedAtRef.current = startedAt;

  const embedUrl = useMemo(() => {
    const parent =
      typeof window !== "undefined" ? window.location.hostname : "localhost";
    try {
      return embedUrlFor(
        { provider, id: providerId, label, control: "guided" },
        parent
      );
    } catch {
      return null;
    }
  }, [provider, providerId, label]);

  // Shared countdown clock (2s poll — cheap, tiny JSON).
  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/rooms/${slug}/guided`);
        if (!res.ok || stopped) return;
        const data = await res.json().catch(() => ({}));
        if (typeof data?.startedAt === "number" && !stopped) {
          setStartedAt(data.startedAt);
        }
      } catch {
        // polling is best-effort
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [slug]);

  // Local ticker for the countdown numbers + expected position.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  const runAction = useCallback(
    async (action: "start" | "stop") => {
      setBusy(true);
      try {
        const res = await fetch(`/api/rooms/${slug}/guided`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, actorId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Countdown failed.");
        if (typeof data?.startedAt === "number") setStartedAt(data.startedAt);
        setShowResync(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Countdown failed.");
      } finally {
        setBusy(false);
      }
    },
    [slug, actorId]
  );

  const remaining = startedAt - now;
  const phase = startedAt === 0 ? "idle" : remaining > 0 ? "count" : "live";
  const countNum = remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  const expected = phase === "live" ? (now - startedAt) / 1000 : 0;

  return (
    <div className="flex w-full flex-col gap-2">
      {/* Provider + sync-level chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="text-[10px] font-mono uppercase">
          {label}
        </Badge>
        <Badge variant="outline" className="text-[10px] uppercase">
          Guided sync
        </Badge>
        {provider === "drive" && (
          <span className="text-[10px] text-muted-foreground">
            Large or restricted files may hit Google quota limits.
          </span>
        )}
        {provider === "facebook" && (
          <span className="text-[10px] text-muted-foreground">
            Public videos only.
          </span>
        )}
      </div>

      {/* Embed frame + countdown overlay */}
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
        {embedUrl ? (
          <iframe
            key={embedUrl}
            src={embedUrl}
            title={`${label} video`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
            <p className="text-xs text-zinc-300">
              This link can&apos;t play inside PeerMates — open it in the {label} app,
              then come back for the countdown.
            </p>
            <span className="font-mono text-[10px] text-zinc-500 break-all">
              {providerId}
            </span>
          </div>
        )}
        {phase === "count" && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60">
            <span className="text-6xl font-extrabold tabular-nums text-white">
              {countNum}
            </span>
            <span className="text-xs text-zinc-300">
              Get ready — tap Play on the video at GO
            </span>
          </div>
        )}
      </div>

      {/* Shared clock + controls */}
      {phase === "idle" && (
        <p className="text-[11px] text-muted-foreground">
          {canControl
            ? "Tap Start countdown, then everyone taps Play on their own player at GO."
            : "Waiting for the host to start the countdown…"}
        </p>
      )}
      {phase === "live" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
          <span className="font-mono text-xs tabular-nums">
            Expected {formatGuidedClock(expected)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            — tap Play if you haven&apos;t yet
          </span>
          <button
            type="button"
            onClick={() => setShowResync((v) => !v)}
            className="ml-auto min-h-11 rounded-lg border border-border px-3 text-xs font-medium cursor-pointer hover:bg-muted"
          >
            Re-sync me
          </button>
        </div>
      )}
      {phase === "live" && showResync && (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed" role="status">
          Seek your player to <strong className="font-mono">{formatGuidedClock(expected)}</strong> and
          tap Play — you&apos;ll be back in sync with the room.
        </p>
      )}

      {canControl && (
        <div className="flex gap-2">
          {phase === "live" ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void runAction("start")}
                className="min-h-11 flex-1 text-xs"
              >
                {busy ? <Spinner className="size-3.5" /> : "Restart countdown"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void runAction("stop")}
                className="min-h-11 flex-1 text-xs"
              >
                Stop
              </Button>
            </>
          ) : (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void runAction("start")}
              className="min-h-11 w-full bg-foreground text-background text-xs font-semibold"
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Starting…
                </span>
              ) : (
                "Start countdown (3-2-1)"
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
