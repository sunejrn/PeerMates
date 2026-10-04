"use client";

import { SyncState } from "@/hooks/useWatchSync";

interface SyncStatusIndicatorProps {
  syncState: SyncState;
  driftSeconds: number;
  isHost: boolean;
}

/**
 * Neutral Vercel-style sync pill: text only, no status dot, no color
 * borders. Works on both #fafaf9 and #333333 surfaces.
 */
export function SyncStatusIndicator({
  syncState,
  driftSeconds,
  isHost,
}: SyncStatusIndicatorProps) {
  const base =
    "flex items-center rounded-lg border border-border bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground whitespace-nowrap";

  if (isHost) {
    return (
      <div className={base} role="status">
        <span>Authoritative Host</span>
      </div>
    );
  }

  if (syncState === "buffering") {
    return (
      <div className={base} role="status">
        <span>Host Buffering...</span>
      </div>
    );
  }

  if (syncState === "synced") {
    return (
      <div className={base} role="status">
        <span>
          Synced{driftSeconds > 0 ? ` (${driftSeconds.toFixed(2)}s drift)` : ""}
        </span>
      </div>
    );
  }

  if (syncState === "syncing") {
    return (
      <div className={base} role="status">
        <span>Syncing... ({driftSeconds.toFixed(1)}s)</span>
      </div>
    );
  }

  return (
    <div className={base} role="status">
      <span>Disconnected</span>
    </div>
  );
}
