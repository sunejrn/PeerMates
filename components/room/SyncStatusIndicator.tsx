"use client";

import { SyncState } from "@/hooks/useWatchSync";

interface SyncStatusIndicatorProps {
  syncState: SyncState;
  driftSeconds: number;
  isHost: boolean;
  isCohost?: boolean;
}

/**
 * Neutral Vercel-style sync pill: text only, no status dot, no color
 * borders. Works on both #fafaf9 and #333333 surfaces.
 */
export function SyncStatusIndicator({
  syncState,
  driftSeconds,
  isHost,
  isCohost = false,
}: SyncStatusIndicatorProps) {
  const base =
    "flex items-center rounded-lg border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground whitespace-nowrap";

  if (isHost) {
    return (
      <div className={base} role="status">
        <span>host</span>
      </div>
    );
  }

  if (isCohost) {
    return (
      <div className={base} role="status">
        <span>cohost</span>
      </div>
    );
  }

  if (syncState === "buffering") {
    return (
      <div className={base} role="status">
        <span>viewer · host buffering</span>
      </div>
    );
  }

  if (syncState === "synced") {
    return (
      <div className={base} role="status">
        <span>
          viewer · synced
          {driftSeconds > 0 ? ` (${driftSeconds.toFixed(2)}s drift)` : ""}
        </span>
      </div>
    );
  }

  if (syncState === "syncing") {
    return (
      <div className={base} role="status">
        <span>viewer · syncing ({driftSeconds.toFixed(1)}s)</span>
      </div>
    );
  }

  return (
    <div className={base} role="status">
      <span>viewer · disconnected</span>
    </div>
  );
}
