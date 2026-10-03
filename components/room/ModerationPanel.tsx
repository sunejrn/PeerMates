"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface ModerationPanelProps {
  slowModeSeconds: number;
  chatMuted: boolean;
  memberCount: number;
  onSetSlowMode: (seconds: number) => Promise<void>;
  onSetChatMuted: (muted: boolean) => Promise<void>;
  onChangeSource: (videoUrl: string) => Promise<void>;
}

const SLOW_OPTIONS = [0, 5, 10, 30];

/**
 * Host / co-host room controls: chat slow-mode, viewer mute-all, and video
 * source changes. Every action is re-validated server-side; failures surface
 * as toasts with the server's reason. All controls are 44px+ tap targets.
 */
export function ModerationPanel({
  slowModeSeconds,
  chatMuted,
  memberCount,
  onSetSlowMode,
  onSetChatMuted,
  onChangeSource,
}: ModerationPanelProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");

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
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          🛡️ Moderation
        </h3>
        <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
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
                className={`min-h-11 rounded-lg border text-xs font-semibold transition-all cursor-pointer disabled:opacity-60 ${
                  active
                    ? "border-violet-500 bg-violet-500/15 text-violet-600 dark:text-violet-300"
                    : "border-border bg-background/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                {pending === `slow-${s}` ? "…" : s === 0 ? "Off" : `${s}s`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mute-all */}
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/50 px-3 py-2">
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
            chatMuted ? "bg-red-500/80 border-red-500" : "bg-muted border-border"
          }`}
        >
          <span
            className={`absolute top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
              chatMuted ? "left-[calc(100%-2.25rem)]" : "left-1"
            }`}
          />
        </button>
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
            className="h-11 px-4 shrink-0 bg-violet-600 hover:bg-violet-500 text-white text-xs"
          >
            {pending === "source" ? "…" : "Switch"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Playback resets for everyone so all devices re-sync.
        </p>
      </form>
    </Card>
  );
}
