"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { useGuestIdentity } from "@/hooks/useGuestIdentity";
import { useDataSaver } from "@/hooks/useDataSaver";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import type { UnifiedPlayerRef } from "@/components/player/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { ALLOWED_REACTIONS } from "@/lib/chat/moderate";
import { fmtClock } from "@/lib/replay/highlights";
import type { BufferedReplayEvent } from "@/lib/redis/replay";
import type { LocalFingerprint } from "@/lib/video/localfile";
import { compareFingerprints } from "@/lib/video/localfile";
import { Heatmap } from "@/components/replay/Heatmap";
import { ReplayOverlay, type OverlayMode } from "@/components/replay/ReplayOverlay";
import { ReplayScrubber } from "@/components/replay/ReplayScrubber";
import { ReplayFileGate } from "@/components/replay/ReplayFileGate";
import { WrappedCard, type WrappedMeta } from "@/components/replay/WrappedCard";

interface ReplayMeta {
  id: string;
  roomSlug: string;
  title: string;
  videoType: "youtube" | "hls" | "mp4" | "localfile";
  videoSource: string | null;
  fileFingerprint: LocalFingerprint | null;
  durationSec: number;
  viewerCount: number;
  visibility: string;
  buckets: number[];
  peaks: { t: number; count: number; label: string }[];
  highlights: {
    laugh?: { t: number; count: number };
    shock?: { t: number; count: number };
    topVoice?: { userName: string; t: number; duration: number } | null;
    chatter?: { name: string; count: number } | null;
    firstReactor?: { name: string; t: number } | null;
  };
  topEmoji: string | null;
  hostName: string | null;
  endedAt: string;
}

const MODES: { id: OverlayMode; label: string }[] = [
  { id: "both", label: "✨ Both" },
  { id: "reactions", label: "🎉 Reactions" },
  { id: "chat", label: "💬 Chat" },
];

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const playerRef = useRef<UnifiedPlayerRef>(null);

  const { data: session } = useSession();
  const { guestId, nickname } = useGuestIdentity();
  const effectiveId = session?.user?.id || guestId;
  const effectiveName = session?.user?.name || nickname || "Guest";
  const { dataSaver } = useDataSaver();

  const [meta, setMeta] = useState<ReplayMeta | null>(null);
  const [liveRoom, setLiveRoom] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [events, setEvents] = useState<BufferedReplayEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [fileMatch, setFileMatch] = useState<boolean | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [mode, setMode] = useState<OverlayMode>("both");
  const [reacting, setReacting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ---- Load replay meta (visibility-gated server-side) ----
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMetaLoading(true);
      setMetaError(null);
      try {
        const res = await fetch(`/api/replay/${id}?actorId=${encodeURIComponent(effectiveId)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Replay not found.");
        if (!cancelled) {
          setMeta(data.replay);
          setLiveRoom(data.liveRoom ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setMetaError(err instanceof Error ? err.message : "Replay not found.");
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    }
    if (effectiveId) void load();
    return () => {
      cancelled = true;
    };
  }, [id, effectiveId]);

  // ---- Load overlay events once meta is known ----
  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    async function load() {
      setEventsLoading(true);
      try {
        const res = await fetch(
          `/api/replay/${id}/events?actorId=${encodeURIComponent(effectiveId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data.events)) setEvents(data.events);
      } catch {
        // overlay stays empty — video still plays
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, meta, effectiveId]);

  // ---- Player clock poll (drives overlay + scrubber) ----
  useEffect(() => {
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      setCurrentTime(p.getCurrentTime());
      const d = p.getDuration();
      if (d > 0) setDuration(d);
    }, 500);
    return () => clearInterval(t);
  }, []);

  const seek = useCallback((s: number) => {
    try {
      playerRef.current?.seek(Math.max(0, s));
    } catch {
      // player not ready — ignore
    }
  }, []);

  // ---- Layered reactions (late friends react on top) ----
  const sendLayeredReaction = useCallback(
    async (emoji: string) => {
      setReacting(true);
      try {
        const res = await fetch(`/api/replay/${id}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoTime: Math.floor(currentTime),
            emoji,
            actorId: effectiveId,
            userName: effectiveName,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Reaction failed.");
        if (data.event) setEvents((prev) => [...prev, data.event]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reaction failed.");
      } finally {
        setReacting(false);
      }
    },
    [id, currentTime, effectiveId, effectiveName]
  );

  const deleteMoment = useCallback(
    async (eventId: string) => {
      setDeletingId(eventId);
      try {
        const res = await fetch(
          `/api/replay/${id}/events/${eventId}?actorId=${encodeURIComponent(effectiveId)}`,
          { method: "DELETE" }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Delete failed.");
        setEvents((prev) => prev.filter((e) => e.id !== eventId));
        toast.success("Moment deleted from the replay.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed.");
      } finally {
        setDeletingId(null);
      }
    },
    [id, effectiveId]
  );

  const myMoments = useMemo(
    () => events.filter((e) => e.userId === effectiveId).slice(-20),
    [events, effectiveId]
  );

  const totalDuration = Math.max(meta?.durationSec ?? 0, duration, 1);
  const needsFile = meta && (meta.videoType === "localfile" || !meta.videoSource);
  const videoSrc = meta?.videoSource ?? "";
  const h = meta?.highlights ?? {};
  const wrapped: WrappedMeta | null = meta
    ? {
        id: meta.id,
        title: meta.title,
        durationSec: meta.durationSec,
        viewerCount: meta.viewerCount,
        buckets: meta.buckets,
        peaks: meta.peaks,
        topEmoji: meta.topEmoji,
        endedAt: meta.endedAt,
      }
    : null;
  const partyDay = meta
    ? new Date(meta.endedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  if (metaLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-8" />
          <p className="text-sm">Loading party replay…</p>
        </div>
      </div>
    );
  }

  if (metaError || !meta) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 text-center">
        <h1 className="text-2xl font-bold text-foreground">Replay unavailable</h1>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {metaError || "This replay doesn't exist or is private."}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background hover:bg-foreground/90"
        >
          Back to PeerMates
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/80 bg-background/85 px-3 sm:px-6 backdrop-blur-md">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-1.5 text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground shrink-0"
        >
          <span aria-hidden>←</span> PeerMates
        </Link>
        <p className="min-w-0 flex-1 truncate px-3 text-center text-xs sm:text-sm font-bold">
          {meta.title} <span className="text-muted-foreground font-medium">· replay</span>
        </p>
        <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          Replay
        </span>
      </header>

      <main className="flex flex-1 flex-col gap-3 sm:gap-4 p-3 sm:p-6 max-w-[1100px] mx-auto w-full">
        {/* Crowd banner */}
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-xs text-foreground text-center" role="status">
          <span>Replaying the party from {partyDay} · {meta.viewerCount} {meta.viewerCount === 1 ? "person" : "people"}</span>
        </div>

        {/* Player + overlay */}
        <div className="w-full relative">
          {needsFile && !localUrl ? (
            <ReplayFileGate
              expected={meta.fileFingerprint}
              onFile={(_file, url, match) => {
                setLocalUrl(url);
                setFileMatch(match);
              }}
            />
          ) : (
            <VideoPlayer
              key={`${meta.videoType}|${videoSrc}|${localUrl ?? "nofile"}`}
              ref={playerRef}
              src={videoSrc}
              videoType={meta.videoType}
              isHost
              canControl
              roleBadge="viewer"
              controlLabel="📼 Your replay"
              localSrc={localUrl ?? undefined}
            />
          )}
          {!needsFile || localUrl ? (
            <ReplayOverlay
              events={events}
              currentTime={currentTime}
              mode={mode}
              dataSaver={dataSaver}
              onDelete={deleteMoment}
              myUserId={effectiveId}
            />
          ) : null}
        </div>

        {needsFile && localUrl && fileMatch === false && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300" role="status">
            This file looks different from the party&apos;s copy — timestamps still line up, but scenes may differ.
          </p>
        )}

        {/* Heatmap scrubber */}
        <Card className="border-border bg-card p-3 rounded-lg space-y-1">
          <ReplayScrubber
            buckets={meta.buckets}
            peaks={meta.peaks}
            durationSec={totalDuration}
            currentTime={currentTime}
            onSeek={seek}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => seek(h.laugh?.t ?? meta.peaks[0]?.t ?? 0)}
              disabled={!h.laugh && meta.peaks.length === 0}
              className="min-h-11 text-xs cursor-pointer flex-1"
            >
              😂 Jump to the funniest moment{h.laugh ? ` (${fmtClock(h.laugh.t)})` : ""}
            </Button>
          </div>
        </Card>

        {/* Mode toggle */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-muted/60 rounded-lg border border-border" role="group" aria-label="Replay overlay mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={`min-h-11 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                mode === m.id
                  ? "bg-background text-foreground shadow-none"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {dataSaver && (
          <p className="text-[11px] text-muted-foreground text-center">
            📉 Data Saver is on — replay shows reactions only.
          </p>
        )}

        {/* Layered reactions */}
        <Card className="border-border bg-card p-3 rounded-lg space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Add your reaction on top
          </h3>
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="React to this moment">
            {ALLOWED_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => void sendLayeredReaction(emoji)}
                disabled={reacting}
                aria-label={`React ${emoji} at ${fmtClock(currentTime)}`}
                className="flex min-h-11 items-center justify-center rounded-lg border border-border text-xl cursor-pointer hover:bg-muted disabled:opacity-50"
              >
                {emoji}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Drops at {fmtClock(currentTime)} and joins the layered replay for the next friend.
          </p>
        </Card>

        {/* Heatmap + highlights */}
        <Card className="border-border bg-card p-3 sm:p-4 rounded-lg space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reaction heatmap
          </h3>
          <Heatmap buckets={meta.buckets} peaks={meta.peaks} durationSec={totalDuration} onSeek={seek} />
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {h.laugh && h.laugh.count > 0 && (
              <li>Biggest laugh — <button type="button" onClick={() => seek(h.laugh!.t)} className="font-mono font-bold text-foreground underline underline-offset-2 cursor-pointer">{fmtClock(h.laugh.t)}</button> ({h.laugh.count} laughs)</li>
            )}
            {h.shock && h.shock.count > 0 && (
              <li>Biggest shock — <button type="button" onClick={() => seek(h.shock!.t)} className="font-mono font-bold text-foreground underline underline-offset-2 cursor-pointer">{fmtClock(h.shock.t)}</button></li>
            )}
            {h.topVoice && (
              <li>Top voice note — {h.topVoice.userName} at <button type="button" onClick={() => seek(h.topVoice!.t)} className="font-mono font-bold text-foreground underline underline-offset-2 cursor-pointer">{fmtClock(h.topVoice.t)}</button></li>
            )}
            {h.chatter && (
              <li>Most active chatter — <strong className="text-foreground">{h.chatter.name}</strong> ({h.chatter.count} messages)</li>
            )}
            {h.firstReactor && (
              <li>First to react — <strong className="text-foreground">{h.firstReactor.name}</strong> at {fmtClock(h.firstReactor.t)}</li>
            )}
          </ul>
        </Card>

        {/* Wrapped share card */}
        {wrapped && <WrappedCard meta={wrapped} />}

        {/* My moments */}
        {myMoments.length > 0 && (
          <Card className="border-border bg-card p-3 rounded-lg space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your moments in this replay
            </h3>
            <ul className="space-y-1.5">
              {myMoments.map((e) => (
                <li key={e.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-muted-foreground shrink-0">{fmtClock(e.videoTime)}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {e.type === "reaction"
                      ? String((e.payload as Record<string, unknown>)?.emoji || "🎉")
                      : String((e.payload as Record<string, unknown>)?.text || e.type).slice(0, 80)}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void deleteMoment(e.id)}
                    disabled={deletingId === e.id}
                    className="h-11 min-w-11 text-xs text-red-500 cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    {deletingId === e.id ? "…" : "Delete"}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Join CTA + rights */}
        <Card className="border-border bg-card p-4 rounded-lg text-center space-y-3">
          <p className="text-sm font-semibold text-foreground">Want the live thing?</p>
          <div className="flex flex-col min-[420px]:flex-row gap-2">
            {liveRoom && (
              <Link
                href={`/room/${liveRoom}`}
                className="inline-flex h-12 min-h-11 flex-1 items-center justify-center rounded-lg bg-foreground px-4 text-xs font-medium text-background hover:bg-foreground/90"
              >
                Join the live room
              </Link>
            )}
            <Link
              href="/"
              className="inline-flex h-12 min-h-11 flex-1 items-center justify-center rounded-lg border border-border bg-background px-4 text-xs font-medium hover:bg-muted"
            >
              Start your own party
            </Link>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Replays keep timestamps, chat text, and emoji only — never video
            files. {eventsLoading ? "Loading moments…" : `${events.length} moments in this replay.`}
          </p>
        </Card>
      </main>
    </div>
  );
}
