"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { fingerprintFile, LOCAL_FILE_ACCEPT } from "@/lib/video/localfile";

interface PickerVoter {
  id: string;
  name: string;
}

interface PickerCandidateView {
  id: string;
  title: string;
  kind: "link" | "file";
  url?: string | null;
  fpId?: string | null;
  addedBy: string;
  addedByName?: string;
  createdAt: number;
  voteCount: number;
  voters: PickerVoter[];
  haveCount: number;
  haveIds: string[];
  missing: { id: string; name: string }[];
  readyText: string;
  playable: boolean | null;
}

interface PickerMeta {
  votingOpen: boolean;
  winnerId: string | null;
  countdownAt: number | null;
}

/**
 * Movie Night Picker — mobile-first card list with thumb-reachable vote
 * buttons (min 48px), live vote counts (3s poll), "Ready for X of Y",
 * voter avatars, file-have nudges, host close + countdown lobby.
 */
export function MoviePicker({
  slug,
  actorId,
  actorName,
  myImage,
  canControl,
  memberCount,
}: {
  slug: string;
  actorId: string;
  actorName: string;
  myImage?: string;
  canControl: boolean;
  memberCount: number;
}) {
  const [candidates, setCandidates] = useState<PickerCandidateView[]>([]);
  const [meta, setMeta] = useState<PickerMeta>({ votingOpen: true, winnerId: null, countdownAt: null });
  const [loading, setLoading] = useState(true);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [hashing, setHashing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  const checkFileRef = useRef<HTMLInputElement>(null);
  const [checkTarget, setCheckTarget] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${slug}/picker`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.candidates)) setCandidates(data.candidates);
      if (data.meta) setMeta(data.meta);
    } catch {
      // polling is best-effort
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void fetchState();
    const t = setInterval(fetchState, 3000);
    return () => clearInterval(t);
  }, [slug, fetchState]);

  // Countdown ticker for the winner lobby
  useEffect(() => {
    if (!meta.countdownAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [meta.countdownAt]);

  useEffect(() => {
    const mine = candidates.find((c) => c.voters.some((v) => v.id === actorId));
    setMyVote(mine ? mine.id : null);
  }, [candidates, actorId]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/rooms/${slug}/picker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, actorId, actorName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Request failed.");
      return data;
    },
    [slug, actorId, actorName]
  );

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error("Paste a link first.");
      return;
    }
    setBusy(true);
    try {
      await post({ action: "add", title: title.trim() || url.trim().slice(0, 60), url: url.trim() });
      setTitle("");
      setUrl("");
      toast.success("Candidate added — tap Vote!");
      void fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add that.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddFile = async (f: File | undefined) => {
    if (!f) return;
    setHashing(true);
    try {
      const fp = await fingerprintFile(f);
      await post({ action: "add", title: title.trim() || f.name.replace(/\.[^.]+$/, ""), fingerprint: fp });
      setTitle("");
      toast.success("File candidate added (fingerprinted, nothing uploaded).");
      void fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't fingerprint that file.");
    } finally {
      setHashing(false);
    }
  };

  const handleVote = async (id: string) => {
    try {
      setMyVote(id); // optimistic
      await post({ action: "vote", candidateId: id });
      void fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Vote failed.");
      void fetchState();
    }
  };

  const handleCheckHave = async (f: File | undefined) => {
    if (!f || !checkTarget) return;
    setHashing(true);
    try {
      const fp = await fingerprintFile(f);
      const target = candidates.find((c) => c.id === checkTarget);
      if (target?.fpId && fp.fpId !== target.fpId) {
        toast.error("That's a different file — grab the host's copy or use Stream from host.");
        return;
      }
      await post({ action: "have", candidateId: checkTarget, fingerprint: fp });
      toast.success("Marked — you're ready for this one!");
      void fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setHashing(false);
      setCheckTarget(null);
    }
  };

  const handleClose = async () => {
    try {
      setBusy(true);
      const data = await post({ action: "close" });
      toast.success(`Winner: ${data?.winner?.title ?? "picked"} — starting countdown!`);
      void fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Close failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async () => {
    try {
      await post({ action: "reopen" });
      toast.success("Voting reopened.");
      void fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reopen failed.");
    }
  };

  const winner = meta.winnerId ? candidates.find((c) => c.id === meta.winnerId) : null;
  const countdownSec = meta.countdownAt ? Math.max(0, Math.ceil((meta.countdownAt - now) / 1000)) : 0;

  return (
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          🎬 Movie Night Picker
        </h3>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] rounded-lg">
            {memberCount} in room
          </Badge>
          <Badge variant="outline" className="text-[10px] rounded-lg">
            {meta.votingOpen ? "Voting open" : "Closed"}
          </Badge>
        </div>
      </div>

      {/* Winner / countdown lobby */}
      {winner && (
        <div className="rounded-xl border border-border bg-muted/40 p-3 text-center space-y-1" role="status">
          <p className="text-sm font-bold">🏆 {winner.title}</p>
          <p className="text-xs text-muted-foreground">
            {meta.countdownAt && countdownSec > 0
              ? `Starting in ${countdownSec}s — get your snacks!`
              : "Winner is now the room source — syncing everyone…"}
          </p>
          {winner.kind === "file" && (
            <p className="text-[11px] text-muted-foreground">
              Local file — pick the same movie on your device, or watch via Stream from host.
            </p>
          )}
        </div>
      )}

      {/* Candidate cards — mobile-first, thumb-reachable vote buttons */}
      {loading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Spinner className="size-3.5 shrink-0 text-foreground" /> Loading picks…
        </p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground" role="status">
          No picks yet — add a link or your movie file below.
        </p>
      ) : (
        <ul className="space-y-2 max-h-80 overflow-y-auto no-scrollbar pr-0.5">
          {candidates.map((c) => {
            const voted = myVote === c.id;
            return (
              <li key={c.id} className={`rounded-xl border p-3 space-y-2 ${voted ? "border-foreground bg-muted/40" : "border-border bg-background/60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{c.title}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {c.kind === "link" ? (c.url ?? "Link") : `File · ${c.fpId ?? ""}`} · by {c.addedByName ?? "Member"}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[11px] rounded-lg shrink-0">
                    {c.voteCount} vote{c.voteCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                {/* Voter avatars (initials, data-saver safe) */}
                {c.voters.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap" aria-label={`${c.voteCount} votes`}>
                    {c.voters.slice(0, 8).map((v) => (
                      <span
                        key={v.id}
                        title={v.name}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold"
                      >
                        {(v.name || "?").slice(0, 1).toUpperCase()}
                      </span>
                    ))}
                    {c.voters.length > 8 && (
                      <span className="text-[10px] text-muted-foreground">+{c.voters.length - 8}</span>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-medium text-muted-foreground">{c.readyText}</span>
                  {c.kind === "link" && (
                    <span className="text-[11px] text-muted-foreground">
                      {c.playable ? "✓ playable link" : "! link may not play"}
                    </span>
                  )}
                </div>
                {/* Missing-file nudge */}
                {c.kind === "file" && c.missing.length > 0 && (
                  <p className="text-[11px] text-muted-foreground rounded-lg border border-border bg-muted/40 px-2 py-1.5">
                    Missing file: {c.missing.slice(0, 3).map((m) => m.name).join(", ")}
                    {c.missing.length > 3 ? ` +${c.missing.length - 3} more` : ""} —{" "}
                    <span className="font-semibold">offer Stream from host</span> below the player, or send the file P2P.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleVote(c.id)}
                    disabled={!meta.votingOpen}
                    aria-pressed={voted}
                    className={`min-h-12 rounded-xl border text-sm font-bold cursor-pointer disabled:opacity-50 ${
                      voted
                        ? "border-transparent bg-[#333] text-white dark:bg-white dark:text-black"
                        : "border-border bg-muted/40 hover:border-foreground/40"
                    }`}
                  >
                    {voted ? "✓ Voted" : "Vote"}
                  </button>
                  {c.kind === "file" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCheckTarget(c.id);
                        checkFileRef.current?.click();
                      }}
                      className="min-h-12 rounded-xl border border-border bg-background/60 text-xs font-semibold cursor-pointer"
                    >
                      I have this file
                    </button>
                  ) : (
                    <a
                      href={c.url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-12 items-center justify-center rounded-xl border border-border bg-background/60 text-xs font-semibold"
                    >
                      Preview link
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add candidate */}
      {meta.votingOpen && (
        <form onSubmit={handleAddLink} className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-2.5">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Pick title (e.g. Dune 2)"
            aria-label="Candidate title"
            maxLength={120}
            className="h-11 min-h-11 text-xs"
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a YouTube / HLS / MP4 link…"
            aria-label="Candidate link"
            inputMode="url"
            className="h-11 min-h-11 text-xs font-mono"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="submit" disabled={busy || !url.trim()} className="min-h-12 text-xs cursor-pointer border-transparent bg-[#333] text-white dark:bg-white dark:text-black">
              {busy ? "Adding…" : "＋ Add link"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={hashing}
              onClick={() => fileRef.current?.click()}
              className="min-h-12 text-xs cursor-pointer"
            >
              {hashing ? "Hashing…" : "📁 Add my file"}
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={LOCAL_FILE_ACCEPT}
            className="hidden"
            aria-label="Add a local file candidate"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void handleAddFile(f);
            }}
          />
          <input
            ref={checkFileRef}
            type="file"
            accept={LOCAL_FILE_ACCEPT}
            className="hidden"
            aria-label="Check I have this file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              void handleCheckHave(f);
            }}
          />
          <p className="text-[10px] text-muted-foreground">
            Files are fingerprinted on-device (3 × 1 MB) — nothing is uploaded.
          </p>
        </form>
      )}

      {/* Host controls */}
      {canControl && (
        <div className="flex gap-2">
          {meta.votingOpen ? (
            <Button
              type="button"
              onClick={handleClose}
              disabled={busy || candidates.length === 0}
              className="flex-1 min-h-12 text-xs cursor-pointer border-transparent bg-[#333] text-white dark:bg-white dark:text-black"
            >
              Close vote → play winner
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={handleReopen} className="flex-1 min-h-12 text-xs cursor-pointer">
              Reopen voting
            </Button>
          )}
        </div>
      )}
      <span className="hidden">{myImage}</span>
    </Card>
  );
}
