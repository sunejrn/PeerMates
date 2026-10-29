"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export type FileTransferPhase =
  | "sending"
  | "receiving"
  | "preparing"
  | "ready"
  | "error";

export interface FileTransferNoticeState {
  id: string;
  name: string;
  percent: number;
  phase: FileTransferPhase;
  direction: "send" | "receive";
  detail?: string;
}

interface FileTransferNoticeProps {
  state: FileTransferNoticeState | null;
  onPlay: () => void;
  onDismissError: () => void;
}

/**
 * A persistent, non-blocking file-transfer card.
 *
 * Deliberately not a modal: it sits above the page like a larger Sonner
 * toast, never blocks the room, and has no outside-click dismissal. The card
 * stays until the user presses Play (or closes a failed transfer).
 */
export function FileTransferNotice({
  state,
  onPlay,
  onDismissError,
}: FileTransferNoticeProps) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  if (!mounted || !state) return null;

  const percent = Math.max(1, Math.min(100, Math.round(state.percent)));
  const isReady = state.phase === "ready";
  const isError = state.phase === "error";
  const title =
    state.direction === "send" ? "Sending movie file" : "Receiving movie file";
  const status = isError
    ? state.detail || "The transfer stopped."
    : isReady
      ? "Loading complete. Press play when you are ready."
      : state.phase === "preparing"
        ? "Checking the file..."
        : state.direction === "send"
          ? state.detail || "Streaming peer-to-peer. Keep this tab open."
          : state.detail || "Streaming from the host. Keep this tab open.";

  return createPortal(
    <aside
      role="status"
      aria-live="polite"
      aria-label={title}
      data-file-transfer-notice
      className="fixed right-3 top-16 z-[80] w-[min(92vw,22rem)] overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl sm:right-4 sm:top-20"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">
            {title}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {state.name}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <span className="font-mono text-2xl font-semibold leading-none tabular-nums text-foreground">
            {percent}
          </span>
          <span className="ml-0.5 text-[10px] text-muted-foreground">%</span>
        </div>
      </div>

      <div className="px-3.5">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${
              isError
                ? "bg-red-500"
                : isReady
                  ? "bg-emerald-500"
                  : "bg-foreground"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {status}
        </p>
      </div>

      <div className="p-3.5 pt-3">
        {isReady ? (
          <Button
            type="button"
            onClick={onPlay}
            className="min-h-11 w-full bg-[#333] text-xs font-semibold text-[#f5f5f5] dark:bg-[#f5f5f5] dark:text-[#333333]"
          >
            play
          </Button>
        ) : isError ? (
          <Button
            type="button"
            variant="outline"
            onClick={onDismissError}
            className="min-h-11 w-full text-xs"
          >
            close
          </Button>
        ) : (
          <div className="flex min-h-11 items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            {state.phase === "preparing" ? "preparing..." : "counting..."}
          </div>
        )}
      </div>
    </aside>,
    document.body
  );
}
