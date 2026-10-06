"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useLocalFilePick } from "@/hooks/useLocalFilePick";
import { GuardLogSheet } from "@/components/room/GuardLogSheet";
import {
  formatBytes,
  formatDuration,
  LOCAL_FILE_ACCEPT,
  type LocalFingerprint,
} from "@/lib/video/localfile";

interface ModerationPanelProps {
  slug: string;
  actorId: string;
  slowModeSeconds: number;
  chatMuted: boolean;
  memberCount: number;
  onSetSlowMode: (seconds: number) => Promise<void>;
  onSetChatMuted: (muted: boolean) => Promise<void>;
  onChangeSource: (videoUrl: string) => Promise<void>;
  onSwitchToLocalFile: (fp: LocalFingerprint, file: File) => Promise<void>;
}

const SLOW_OPTIONS = [0, 5, 10, 30];

const GUARD_LEVELS = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
] as const;

type GuardLevel = (typeof GUARD_LEVELS)[number]["id"];

/**
 * Host / co-host room controls: chat slow-mode, viewer mute-all, and video
 * source changes. Every action is re-validated server-side; failures surface
 * as toasts with the server's reason. All controls are 44px+ tap targets.
 */
export function ModerationPanel({
  slug,
  actorId,
  slowModeSeconds,
  chatMuted,
  memberCount,
  onSetSlowMode,
  onSetChatMuted,
  onChangeSource,
  onSwitchToLocalFile,
}: ModerationPanelProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [showFileSwitch, setShowFileSwitch] = useState(false);
  const [guardOn, setGuardOn] = useState(true);
  const [guardLevel, setGuardLevel] = useState<GuardLevel>("medium");
  const [guardLoaded, setGuardLoaded] = useState(false);
  const [guardCount, setGuardCount] = useState(0);
  const [showGuardLog, setShowGuardLog] = useState(false);
  const filePick = useLocalFilePick();

  // Chat Guard settings live server-side; load once (failures keep defaults).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/rooms/${slug}/guard?actorId=${encodeURIComponent(actorId)}`
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        if (typeof data?.settings?.enabled === "boolean") {
          setGuardOn(data.settings.enabled);
        }
        if (
          data?.settings?.sensitivity === "low" ||
          data?.settings?.sensitivity === "medium" ||
          data?.settings?.sensitivity === "high"
        ) {
          setGuardLevel(data.settings.sensitivity);
        }
        if (Array.isArray(data?.log)) setGuardCount(data.log.length);
      } catch {
        // guard controls keep defaults; chat itself is unaffected
      } finally {
        if (!cancelled) setGuardLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, actorId]);

  const saveGuard = async (patch: { enabled?: boolean; sensitivity?: GuardLevel }) => {
    const res = await fetch(`/api/rooms/${slug}/guard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "settings", actorId, ...patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Couldn't save Guard settings.");
    if (typeof patch.enabled === "boolean") setGuardOn(patch.enabled);
    if (patch.sensitivity) setGuardLevel(patch.sensitivity);
  };

  const run = async (key: string, fn: () => Promise<void>, ok?: string) => {
    try {
      setPending(key);
      await fn();
      if (ok) toast.success(ok);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Action failed. Try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="border-border bg-card p-3 sm:p-4 rounded-lg space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          Moderation
        </h3>
        <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground rounded-lg">
          {memberCount} in room
        </Badge>
      </div>

      {/* Slow mode */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground">
          Chat slow mode
          <span className="ml-1.5 font-normal text-muted-foreground">
            {slowModeSeconds === 0 ? "Off" : `${slowModeSeconds}s between messages`}
          </span>
        </p>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Slow mode delay">
          {SLOW_OPTIONS.map((s) => {
            const active = slowModeSeconds === s;
            return (
              <button
                key={s}
                type="button"
                disabled={pending !== null}
                onClick={() => run(`slow-${s}`, () => onSetSlowMode(s))}
                aria-pressed={active}
                className={`min-h-11 rounded-lg border text-xs font-medium transition-all cursor-pointer disabled:opacity-60 ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {pending === `slow-${s}` ? "…" : s === 0 ? "Off" : `${s}s`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mute-all */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-foreground">Mute all viewers</p>
          <p className="text-[11px] text-muted-foreground">
            {chatMuted ? "Viewers are read-only." : "Everyone can chat."}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={chatMuted}
          aria-label="Mute all viewers"
          disabled={pending !== null}
          onClick={() =>
            run("muteall", () => onSetChatMuted(!chatMuted))
          }
          className={`relative h-11 w-16 shrink-0 rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
            chatMuted ? "bg-foreground border-foreground" : "bg-muted border-border"
          }`}
        >
          <span
            className={`absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-white shadow-none transition-all ${
              chatMuted ? "left-[calc(100%-2.25rem)]" : "left-1"
            }`}
          />
        </button>
      </div>

      {/* Chat Guard: auto filter + Guard log.
          The log opens as a compact inline popover anchored here
          (same pattern as the chat attach menu). */}
      <div className="relative space-y-2">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2">
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-foreground">Chat Guard</p>
            <p className="text-[11px] text-muted-foreground">
              {guardLoaded
                ? guardOn
                  ? `Filtering spam & scams (${guardLevel}).`
                  : "Off — chat is unfiltered."
                : "Loading Guard settings…"}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={guardOn}
            aria-label="Chat Guard"
            disabled={pending !== null || !guardLoaded}
            onClick={() => run("guard", () => saveGuard({ enabled: !guardOn }), guardOn ? "Chat Guard off." : "Chat Guard on.")}
            className={`relative h-11 w-16 shrink-0 rounded-full border transition-colors cursor-pointer disabled:opacity-60 ${
              guardOn ? "bg-foreground border-foreground" : "bg-muted border-border"
            }`}
          >
            <span
              className={`absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-white shadow-none transition-all ${
                guardOn ? "left-[calc(100%-2.25rem)]" : "left-1"
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Guard sensitivity">
          {GUARD_LEVELS.map((l) => {
            const active = guardLevel === l.id;
            return (
              <button
                key={l.id}
                type="button"
                disabled={pending !== null || !guardLoaded}
                onClick={() => run(`guard-${l.id}`, () => saveGuard({ sensitivity: l.id }), `Guard sensitivity: ${l.label}.`)}
                aria-pressed={active}
                className={`min-h-11 rounded-lg border text-xs font-medium cursor-pointer disabled:opacity-60 ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {pending === `guard-${l.id}` ? "…" : l.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setShowGuardLog(true)}
          className="flex min-h-11 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground cursor-pointer"
        >
          <span>View Guard log</span>
          {guardCount > 0 && (
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {guardCount}
            </span>
          )}
        </button>

        <GuardLogSheet
          slug={slug}
          actorId={actorId}
          open={showGuardLog}
          onClose={() => setShowGuardLog(false)}
        />
      </div>

      {/* Source change */}
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sourceUrl.trim() || pending) return;
          const url = sourceUrl.trim();
          run("source", () => onChangeSource(url)).then(() => setSourceUrl(""));
        }}
      >
        <label className="text-xs font-medium text-foreground" htmlFor="mod-source-url">
          Change video source
        </label>
        <div className="flex gap-1.5">
          <Input
            id="mod-source-url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="YouTube / HLS / MP4 URL…"
            className="h-11 bg-background/80 font-mono text-xs min-w-0 flex-1"
          />
          <Button
            type="submit"
            disabled={!sourceUrl.trim() || pending !== null}
            className="h-11 px-4 shrink-0 text-xs rounded-lg"
          >
            {pending === "source" ? "…" : "Switch"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Playback resets for everyone so all devices re-sync.
        </p>
      </form>

      {/* Switch to a My Files movie on this device */}
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => setShowFileSwitch((v) => !v)}
          aria-expanded={showFileSwitch}
          className="flex min-h-11 w-full items-center justify-between rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground cursor-pointer"
        >
          <span>Switch to My File…</span>
          <span className="text-muted-foreground" aria-hidden>{showFileSwitch ? "▲" : "▼"}</span>
        </button>
        {showFileSwitch && (
          <div className="space-y-2 rounded-lg border border-border p-2.5">
            <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-background px-3 text-xs font-medium transition-all">
              <input
                type="file"
                accept={LOCAL_FILE_ACCEPT}
                className="hidden"
                aria-label="Choose a movie file to make the room file"
                onChange={(e) => {
                  void filePick.pickFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              {filePick.file ? filePick.file.name : "Choose movie file…"}
            </label>

            {(filePick.phase === "preflight" || filePick.phase === "fingerprint") && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <Spinner className="shrink-0" />
                {filePick.phase === "preflight"
                  ? "Checking compatibility…"
                  : `Fingerprinting… ${Math.round(filePick.progress * 100)}%`}
              </div>
            )}
            {filePick.phase === "error" && (
              <p className="text-xs text-destructive" role="alert">
                {filePick.error}{filePick.tip ? ` ${filePick.tip}` : ""}
              </p>
            )}
            {filePick.phase === "ready" && filePick.fp && (
              <div className="space-y-1.5">
                <p className="text-xs text-foreground">
                  {formatBytes(filePick.fp.size)} · {formatDuration(filePick.fp.duration)}
                </p>
                <Button
                  disabled={pending !== null}
                  onClick={() => {
                    if (!filePick.fp || !filePick.file) return;
                    const fp = filePick.fp;
                    const f = filePick.file;
                    run("localsource", () => onSwitchToLocalFile(fp, f)).then(() => {
                      filePick.reset();
                      setShowFileSwitch(false);
                    });
                  }}
                  className="w-full min-h-11 text-xs rounded-lg"
                >
                  {pending === "localsource" ? "Switching…" : "Make this the room file"}
                </Button>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Everyone picks the same file on their device; playback resets so all re-sync.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
