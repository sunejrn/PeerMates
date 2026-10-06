"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

interface GuardLogEntry {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  reason: string;
  createdAt: string;
}

/**
 * Host/co-host Guard log: hidden messages with sender + reason, and
 * Restore / Delete / Mute-sender actions (all server-enforced).
 * Restores only un-hide that one message — they teach nothing and change
 * no rules. Compact inline popover (same pattern as the chat attach menu),
 * 44px targets, loading + error + empty states.
 */
export function GuardLogSheet({
  slug,
  actorId,
  open,
  onClose,
}: {
  slug: string;
  actorId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<GuardLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `/api/rooms/${slug}/guard?actorId=${encodeURIComponent(actorId)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Couldn't load the Guard log.");
      setEntries(Array.isArray(data.log) ? data.log : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the Guard log.");
    }
  }, [slug, actorId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runAction = async (
    key: string,
    fn: () => Promise<Response>,
    okMsg: string
  ) => {
    setBusy(key);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || "Action failed.");
      toast.success(okMsg);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const restore = (id: string) =>
    runAction(
      `restore-${id}`,
      () =>
        fetch(`/api/rooms/${slug}/messages/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore", actorId }),
        }),
      "Message restored."
    );

  const remove = (id: string) =>
    runAction(
      `delete-${id}`,
      () =>
        fetch(`/api/rooms/${slug}/messages/${id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actorId }),
        }),
      "Message deleted."
    );

  const mute = (senderId: string, senderName: string) =>
    runAction(
      `mute-${senderId}`,
      () =>
        fetch(`/api/rooms/${slug}/moderation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mute", targetUserId: senderId, actorId }),
        }),
      `${senderName} muted.`
    );

  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 z-20"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="absolute inset-x-0 bottom-full z-30 mb-2 flex max-h-96 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground"
        role="dialog"
        aria-label="Chat Guard log"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <h3 className="text-xs font-semibold">
            Guard log
            {entries && entries.length > 0 && (
              <span className="ml-2 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                {entries.length}
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Guard log"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-2.5">
          {entries === null && !error && (
            <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground" role="status">
              <Spinner className="size-3.5 shrink-0" /> Loading hidden messages…
            </p>
          )}
          {error && (
            <div className="space-y-2 py-4 text-center">
              <p className="text-xs text-muted-foreground" role="alert">{error}</p>
              <button
                type="button"
                onClick={() => void load()}
                className="min-h-11 rounded-lg border border-border px-4 text-xs font-medium cursor-pointer"
              >
                Retry
              </button>
            </div>
          )}
          {entries !== null && !error && entries.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No hidden messages. Chat is calm. 🌤️
            </p>
          )}
          {entries?.map((e) => (
            <div
              key={e.id}
              className="space-y-2 rounded-lg border border-border p-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold">{e.senderName}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {new Date(e.createdAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="break-words text-xs text-muted-foreground">
                {e.text || "(attachment)"}
              </p>
              <p className="font-mono text-[10px] text-muted-foreground">
                Reason: {e.reason}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void restore(e.id)}
                  className="min-h-11 rounded-lg border border-border text-xs font-medium cursor-pointer hover:bg-muted disabled:opacity-50"
                >
                  {busy === `restore-${e.id}` ? "…" : "Restore"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void remove(e.id)}
                  className="min-h-11 rounded-lg border border-border text-xs font-medium cursor-pointer hover:bg-muted disabled:opacity-50"
                >
                  {busy === `delete-${e.id}` ? "…" : "Delete"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void mute(e.senderId, e.senderName)}
                  className="min-h-11 rounded-lg border border-border text-xs font-medium cursor-pointer hover:bg-muted disabled:opacity-50"
                >
                  {busy === `mute-${e.senderId}` ? "…" : "Mute"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
