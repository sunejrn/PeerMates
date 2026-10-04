"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BufferedReplayEvent } from "@/lib/redis/replay";
import { fmtClock } from "@/lib/replay/highlights";

export type OverlayMode = "both" | "reactions" | "chat";

const MAX_FLOATERS = 24;
const CHAT_WINDOW = 12;
const VOICE_WINDOW = 15;

interface Floater {
  key: number;
  emoji: string;
  x: number;
  delay: number;
}

interface Props {
  events: BufferedReplayEvent[];
  currentTime: number;
  mode: OverlayMode;
  /** Data Saver: reactions only (chat bubbles + voice auto-hidden). */
  dataSaver?: boolean;
  onDelete?: (eventId: string) => void;
  myUserId?: string;
}

/**
 * Lightweight replay overlay: reactions float up (transform/opacity only,
 * capped nodes, sampled windows), chat bubbles surface in sync, voice notes
 * appear as tappable chips. Throttled by design for low-end phones.
 */
export function ReplayOverlay({ events, currentTime, mode, dataSaver = false, onDelete, myUserId }: Props) {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const keyRef = useRef(0);
  const lastWindowRef = useRef("");

  const showChat = mode !== "reactions" && !dataSaver;
  const showReactions = mode !== "chat";

  // Reaction floaters: sample the newly-entered window (<=2.5s slices).
  useEffect(() => {
    if (!showReactions) return;
    const from = currentTime - 2.5;
    const due = events.filter(
      (e) => e.type === "reaction" && e.videoTime > from && e.videoTime <= currentTime
    );
    if (due.length === 0) return;
    const sig = `${Math.floor(currentTime * 2)}:${due.length}`;
    if (sig === lastWindowRef.current) return;
    lastWindowRef.current = sig;
    // Sample down to at most 8 per window (500-burst safe).
    const picked = due.length > 8 ? due.filter((_, i) => i % Math.ceil(due.length / 8) === 0).slice(0, 8) : due;
    setFloaters((prev) => {
      const next = [
        ...prev,
        ...picked.map((e) => ({
          key: keyRef.current++,
          emoji: String((e.payload as Record<string, unknown>)?.emoji || "🎉"),
          x: 8 + Math.random() * 84,
          delay: Math.random() * 0.35,
        })),
      ];
      return next.slice(-MAX_FLOATERS);
    });
    const t = setTimeout(() => {
      setFloaters((prev) => prev.slice(Math.max(0, prev.length - MAX_FLOATERS)));
    }, 3200);
    return () => clearTimeout(t);
  }, [currentTime, events, showReactions]);

  const bubbles = useMemo(() => {
    if (!showChat) return [];
    return events
      .filter(
        (e) =>
          (e.type === "message" || e.type === "pin") &&
          e.videoTime <= currentTime &&
          e.videoTime > currentTime - CHAT_WINDOW
      )
      .slice(-4);
  }, [events, currentTime, showChat]);

  const voices = useMemo(() => {
    if (!showChat) return [];
    return events
      .filter(
        (e) =>
          e.type === "voice" && e.videoTime <= currentTime && e.videoTime > currentTime - VOICE_WINDOW
      )
      .slice(-3);
  }, [events, currentTime, showChat]);

  const playVoice = (url: string) => {
    try {
      const audio = new Audio(url);
      void audio.play().catch(() => {});
    } catch {
      // unsupported attachment — ignore
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden={false}>
      <style>{`
        @keyframes pm-float-up {
          0% { transform: translateY(0) scale(.6); opacity: 0; }
          12% { opacity: 1; }
          100% { transform: translateY(-46vh) scale(1.15); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .pm-floater { animation: none !important; opacity: 0 !important; }
        }
      `}</style>

      {/* Floating reactions */}
      {showReactions &&
        floaters.map((f) => (
          <span
            key={f.key}
            className="pm-floater absolute bottom-16 text-3xl will-change-transform"
            style={{
              left: `${f.x}%`,
              animation: `pm-float-up 2.8s ease-out ${f.delay}s forwards`,
            }}
          >
            {f.emoji}
          </span>
        ))}

      {/* Chat bubbles in sync */}
      {bubbles.length > 0 && (
        <div className="absolute bottom-3 left-3 right-3 flex flex-col items-start gap-1.5" role="log" aria-label="Replay chat">
          {bubbles.map((b) => (
            <div
              key={b.id}
              className="pointer-events-auto max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-black/70 px-3 py-1.5 text-xs text-white backdrop-blur-sm"
            >
              <span className="mr-1.5 font-bold text-violet-300">
                {(b.userName || "Guest").slice(0, 16)}
              </span>
              {b.type === "pin" && <span aria-hidden>📌 </span>}
              <span className="break-words">
                {String((b.payload as Record<string, unknown>)?.text || "(attachment)").slice(0, 140)}
              </span>
              <span className="ml-1.5 font-mono text-[10px] text-zinc-400">
                {fmtClock(b.videoTime)}
              </span>
              {onDelete && myUserId && b.userId === myUserId && (
                <button
                  type="button"
                  onClick={() => onDelete(b.id)}
                  aria-label="Delete your moment"
                  className="ml-1.5 inline-flex h-11 min-w-11 items-center justify-center rounded-lg text-zinc-300 underline"
                >
                  Delete
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Voice note chips */}
      {voices.length > 0 && (
        <div className="absolute right-3 top-14 flex flex-col items-end gap-1.5">
          {voices.map((v) => {
            const p = (v.payload ?? {}) as Record<string, unknown>;
            const url = typeof p.url === "string" ? p.url : "";
            if (!url) return null;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => playVoice(url)}
                aria-label={`Play voice note from ${(v.userName || "Guest").slice(0, 16)} at ${fmtClock(v.videoTime)}`}
                className="pointer-events-auto flex h-11 min-h-11 items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3 text-xs font-semibold text-white backdrop-blur-sm cursor-pointer"
              >
                <span aria-hidden>🎙</span>
                {(v.userName || "Guest").slice(0, 12)} · {fmtClock(v.videoTime)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
