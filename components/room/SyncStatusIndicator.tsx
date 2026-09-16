"use client";

import { SyncState } from "@/hooks/useWatchSync";

interface SyncStatusIndicatorProps {
  syncState: SyncState;
  driftSeconds: number;
  isHost: boolean;
}

export function SyncStatusIndicator({
  syncState,
  driftSeconds,
  isHost,
}: SyncStatusIndicatorProps) {
  if (isHost) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300 font-medium">
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
        <span>Authoritative Host</span>
      </div>
    );
  }

  if (syncState === "buffering") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300 font-medium">
        <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
        <span>Host Buffering...</span>
      </div>
    );
  }

  if (syncState === "synced") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span>
          Synced {driftSeconds > 0 ? `(${driftSeconds.toFixed(2)}s drift)` : ""}
        </span>
      </div>
    );
  }

  if (syncState === "syncing") {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-700 dark:text-violet-300 font-medium">
        <span className="h-2 w-2 rounded-full bg-violet-500 animate-pulse" />
        <span>Syncing... ({driftSeconds.toFixed(1)}s)</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs text-destructive font-medium">
      <span className="h-2 w-2 rounded-full bg-destructive" />
      <span>Disconnected</span>
    </div>
  );
}
