"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
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

interface NoticePosition {
  x: number;
  y: number;
}

const POSITION_KEY = "peermates:file-transfer:position";
const EDGE_GAP = 8;

function clampPosition(
  x: number,
  y: number,
  width: number,
  height: number
): NoticePosition {
  const maxX = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
  const maxY = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);
  return {
    x: Math.min(Math.max(EDGE_GAP, x), maxX),
    y: Math.min(Math.max(EDGE_GAP, y), maxY),
  };
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
  const [position, setPosition] = useState<NoticePosition | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(POSITION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<NoticePosition>;
      if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
        return { x: Number(parsed.x), y: Number(parsed.y) };
      }
    } catch {
      // ignore corrupt/blocked storage
    }
    return null;
  });
  const cardRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    lastX: number;
    lastY: number;
  } | null>(null);

  useEffect(() => {
    if (!position || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const clamped = clampPosition(
      position.x,
      position.y,
      rect.width,
      rect.height
    );
    if (clamped.x !== position.x || clamped.y !== position.y) {
      setPosition(clamped);
    }
  }, [position, state?.id]);

  useEffect(() => {
    const onResize = () => {
      setPosition((current) => {
        const card = cardRef.current;
        if (!current || !card) return current;
        const rect = card.getBoundingClientRect();
        return clampPosition(current.x, current.y, rect.width, rect.height);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (
      (event.target as HTMLElement).closest(
        "button, a, input, textarea, select"
      )
    ) {
      return;
    }
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const start = position ?? { x: rect.left, y: rect.top };
    if (!position) setPosition(start);
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      lastX: start.x,
      lastY: start.y,
    };
    try {
      card.setPointerCapture(event.pointerId);
    } catch {
      // ignore unsupported pointer capture
    }
    event.preventDefault();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const next = clampPosition(
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
      rect.width,
      rect.height
    );
    drag.lastX = next.x;
    drag.lastY = next.y;
    setPosition(next);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      cardRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    try {
      window.localStorage.setItem(
        POSITION_KEY,
        JSON.stringify({ x: drag.lastX, y: drag.lastY })
      );
    } catch {
      // ignore blocked storage
    }
  };

  if (!mounted || !state) return null;

  const percent = Math.max(1, Math.min(100, Math.round(state.percent)));
  const isReady = state.phase === "ready";
  const isError = state.phase === "error";
  const isConnecting = !isReady && !isError && percent <= 1;
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
      ref={cardRef}
      role="status"
      aria-live="polite"
      aria-label={`${title}. Drag to move.`}
      data-file-transfer-notice
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={(e) => e.stopPropagation()}
      style={
        position
          ? {
              left: position.x,
              top: position.y,
              right: "auto",
              touchAction: "none",
            }
          : undefined
      }
      className="fixed right-3 top-16 z-[80] w-[min(92vw,22rem)] touch-none cursor-grab select-none overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl active:cursor-grabbing sm:right-4 sm:top-20"
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
            {state.phase === "preparing"
              ? "preparing..."
              : isConnecting
                ? "connecting, please wait..."
                : state.direction === "send"
                  ? "sending..."
                  : "receiving..."}
          </div>
        )}
      </div>
    </aside>,
    document.body
  );
}
