"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

/**
 * Movie Buddy — "Ask" button in the room. Sends only subtitle text up to the
 * room's current timestamp + the question (server-side, keys never leave).
 * Answers show privately by default with a "Share to chat" button.
 */
export function MovieBuddy({
  slug,
  actorId,
  getCurrentTime,
  onShare,
}: {
  slug: string;
  actorId: string;
  getCurrentTime: () => number;
  onShare: (text: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);

  const ask = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = question.trim();
    if (!q) {
      toast.error("Type a question first.");
      return;
    }
    setLoading(true);
    setAnswer(null);
    try {
      const res = await fetch(`/api/rooms/${slug}/buddy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          currentTime: Math.max(0, Math.floor(getCurrentTime())),
          actorId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          res.status === 429
            ? "Movie Buddy is busy right now — try again in a bit."
            : data?.error || "Movie Buddy couldn't answer that."
        );
      }
      setAnswer(String(data.answer || "that hasn't been shown yet"));
      setCached(Boolean(data.cached));
    } catch (err) {
      toast.warning(err instanceof Error ? err.message : "Couldn't ask Movie Buddy.");
    } finally {
      setLoading(false);
    }
  };

  const share = async () => {
    if (!answer) return;
    setSharing(true);
    try {
      const ok = await onShare(`🤖 Movie Buddy: ${answer}`);
      if (ok !== false) toast.success("Shared to chat.");
    } catch {
      toast.error("Couldn't share that.");
    } finally {
      setSharing(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full min-h-12 text-xs font-semibold cursor-pointer"
      >
        🤖 Ask Movie Buddy
      </Button>
    );
  }

  return (
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          🤖 Movie Buddy
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Movie Buddy"
          className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
        >
          ✕
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Answers only from what&apos;s been shown so far — private to you unless you share.
      </p>
      <form onSubmit={ask} className="flex gap-1.5">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What just happened? Who is that?"
          aria-label="Ask Movie Buddy"
          maxLength={500}
          className="h-11 min-h-11 flex-1 text-xs"
        />
        <Button type="submit" disabled={loading || !question.trim()} className="h-11 min-h-11 px-4 text-xs cursor-pointer shrink-0 border-transparent bg-[#333] text-white dark:bg-white dark:text-black">
          {loading ? <Spinner className="size-4 text-white" /> : "Ask"}
        </Button>
      </form>
      {answer && (
        <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-2.5" role="status">
          <p className="text-xs leading-relaxed">🔒 Only you can see this{cached ? " (cached)" : ""}:</p>
          <p className="max-h-48 overflow-y-auto no-scrollbar text-xs leading-relaxed text-foreground">{answer}</p>
          <Button
            type="button"
            variant="outline"
            onClick={share}
            disabled={sharing}
            className="w-full min-h-11 text-xs cursor-pointer"
          >
            {sharing ? "Sharing…" : "Share to chat"}
          </Button>
        </div>
      )}
    </Card>
  );
}
