"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

interface PollView {
  id: string;
  question: string;
  options: string[];
  correctIndex: number | null;
  isOpen: boolean;
  revealed: boolean;
  counts: number[];
  totalVotes: number;
  votes?: Record<string, number>;
}

interface QuestionView {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  upvotes: number;
  upvoters: string[];
  answered: boolean;
  createdAt: number;
}

interface AttendanceView {
  userId: string;
  userName: string;
  joinedAt: number;
  lastSeenAt: number;
  totalSeconds: number;
}

interface NoteView {
  id: string;
  text: string;
  videoTime: number;
  createdAt: number;
}

function fmtT(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Class Mode — host/co-host toolbar (polls + quizzes with live bar chart +
 * correct-answer reveal, question queue moderation, attendance) and viewer
 * tools (bottom-sheet poll answers at 360px, upvotes, personal timestamped
 * notes). Exports: notes+questions+polls as Markdown (/print to PDF),
 * attendance as CSV. Server-enforced privileged controls.
 */
export function ClassMode({
  slug,
  actorId,
  actorName,
  canControl,
  getCurrentTime,
}: {
  slug: string;
  actorId: string;
  actorName: string;
  canControl: boolean;
  getCurrentTime: () => number;
}) {
  const [mode, setMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [polls, setPolls] = useState<PollView[]>([]);
  const [questions, setQuestions] = useState<QuestionView[]>([]);
  const [attendance, setAttendance] = useState<AttendanceView[]>([]);
  const [notes, setNotes] = useState<NoteView[]>([]);
  // forms
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState("");
  const [pollCorrect, setPollCorrect] = useState("");
  const [qText, setQText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheetPoll, setSheetPoll] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${slug}/class?userId=${encodeURIComponent(actorId)}`);
      if (!res.ok) return;
      const data = await res.json();
      setMode(Boolean(data.mode));
      if (Array.isArray(data.polls)) setPolls(data.polls);
      if (Array.isArray(data.questions)) setQuestions(data.questions);
      if (Array.isArray(data.attendance)) setAttendance(data.attendance);
      if (Array.isArray(data.notes)) setNotes(data.notes);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, [slug, actorId]);

  useEffect(() => {
    void fetchState();
    const t = setInterval(fetchState, 4000);
    return () => clearInterval(t);
  }, [slug, fetchState]);

  // Attendance heartbeat (joined time + time present)
  useEffect(() => {
    if (!mode) return;
    const beat = () => {
      fetch(`/api/rooms/${slug}/class`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "attend", actorId, actorName }),
      }).catch(() => {});
    };
    beat();
    const t = setInterval(beat, 20000);
    return () => clearInterval(t);
  }, [mode, slug, actorId, actorName]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/rooms/${slug}/class`, {
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

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      void fetchState();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const openPoll = polls.find((p) => p.id === sheetPoll) ?? polls.find((p) => p.isOpen) ?? null;

  return (
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          🎓 Class Mode
        </h3>
        {loading ? (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Spinner className="size-3.5 text-foreground" /> Loading…
          </span>
        ) : (
          <Badge variant="outline" className="text-[10px] rounded-lg">
            {mode ? "Enabled" : "Off"}
          </Badge>
        )}
      </div>

      {/* Enable toggle (privileged) */}
      {!mode && (
        <>
          <p className="text-xs text-muted-foreground">
            Live polls + quizzes, a question queue, attendance, and personal timestamped notes — with
            Markdown/PDF and CSV exports at the end.
          </p>
          {canControl ? (
            <Button
              type="button"
              onClick={() => void run(() => post({ action: "mode", on: true }), "Class Mode on.")}
              disabled={busy}
              className="w-full min-h-12 text-xs cursor-pointer border-transparent bg-[#333] text-white dark:bg-white dark:text-black"
            >
              Enable Class Mode for this room
            </Button>
          ) : (
            <p className="text-[11px] text-muted-foreground" role="status">
              The host hasn&apos;t enabled Class Mode yet.
            </p>
          )}
        </>
      )}

      {mode && (
        <div className="space-y-4">
          {/* Host toolbar */}
          {canControl && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-2.5">
              <p className="text-[11px] font-bold text-muted-foreground">HOST TOOLBAR — new poll / quiz</p>
              <Input
                value={pollQ}
                onChange={(e) => setPollQ(e.target.value)}
                placeholder="Question (e.g. What is 2+2?)"
                aria-label="Poll question"
                maxLength={300}
                className="h-11 min-h-11 text-xs"
              />
              <Input
                value={pollOpts}
                onChange={(e) => setPollOpts(e.target.value)}
                placeholder="Options, comma separated (min 2, max 6)"
                aria-label="Poll options"
                className="h-11 min-h-11 text-xs"
              />
              <div className="flex gap-1.5">
                <Input
                  value={pollCorrect}
                  onChange={(e) => setPollCorrect(e.target.value)}
                  placeholder="Correct # (optional, 1-based)"
                  aria-label="Correct option number"
                  inputMode="numeric"
                  className="h-11 min-h-11 flex-1 text-xs"
                />
                <Button
                  type="button"
                  disabled={busy || !pollQ.trim() || pollOpts.split(",").filter((s) => s.trim()).length < 2}
                  onClick={() =>
                    void run(async () => {
                      const options = pollOpts.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
                      const n = Number(pollCorrect);
                      await post({
                        action: "poll_create",
                        question: pollQ.trim(),
                        options,
                        correctIndex: Number.isInteger(n) && n >= 1 && n <= options.length ? n - 1 : null,
                      });
                      setPollQ("");
                      setPollOpts("");
                      setPollCorrect("");
                    }, "Poll is live.")
                  }
                  className="h-11 min-h-11 px-4 text-xs cursor-pointer shrink-0 border-transparent bg-[#333] text-white dark:bg-white dark:text-black"
                >
                  Launch
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void run(() => post({ action: "mode", on: false }), "Class Mode off.")}
                disabled={busy}
                className="w-full min-h-11 text-[11px] cursor-pointer"
              >
                Disable Class Mode
              </Button>
            </div>
          )}

          {/* Polls — live bar chart + reveal; viewers answer via bottom sheet */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-muted-foreground">POLLS & QUIZZES ({polls.length})</p>
              {polls.some((p) => p.isOpen) && !canControl && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSheetPoll(polls.find((p) => p.isOpen)?.id ?? null)}
                  className="min-h-11 px-3 text-[11px] cursor-pointer"
                >
                  Answer ▴
                </Button>
              )}
            </div>
            {polls.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No polls yet.</p>
            )}
            <div className="max-h-96 space-y-2 overflow-y-auto no-scrollbar pr-0.5">
            {polls.map((p) => {
              const max = Math.max(1, ...p.counts);
              return (
                <div key={p.id} className="rounded-xl border border-border bg-background/60 p-2.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold">{p.question}</p>
                    <Badge variant="outline" className="text-[10px] rounded-lg shrink-0">
                      {p.isOpen ? `Live · ${p.totalVotes}` : "Closed"}
                    </Badge>
                  </div>
                  {p.options.map((o, i) => (
                    <div key={i} className="space-y-0.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span>
                          {o}
                          {p.revealed && p.correctIndex === i && " ✓"}
                        </span>
                        <span className="font-mono text-muted-foreground">{p.counts[i] ?? 0}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden" role="img" aria-label={`${o}: ${p.counts[i] ?? 0} votes`}>
                        <div
                          className="h-full bg-foreground/70 transition-all"
                          style={{ width: `${Math.round(((p.counts[i] ?? 0) / max) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-1.5 flex-wrap">
                    {p.isOpen && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setSheetPoll(p.id)}
                        className="flex-1 min-h-11 text-[11px] cursor-pointer"
                      >
                        Answer
                      </Button>
                    )}
                    {canControl && (
                      <>
                        {p.isOpen && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void run(() => post({ action: "poll_close", pollId: p.id }))}
                            disabled={busy}
                            className="min-h-11 px-3 text-[11px] cursor-pointer"
                          >
                            Close
                          </Button>
                        )}
                        {p.correctIndex !== null && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void run(() => post({ action: "poll_reveal", pollId: p.id, reveal: !p.revealed }))}
                            disabled={busy}
                            className="min-h-11 px-3 text-[11px] cursor-pointer"
                          >
                            {p.revealed ? "Hide answer" : "Reveal answer"}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </div>

          {/* Question queue */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold text-muted-foreground">QUESTION QUEUE ({questions.length})</p>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!qText.trim()) return;
                void run(async () => {
                  await post({ action: "q_ask", text: qText.trim() });
                  setQText("");
                }, "Question added.");
              }}
            >
              <Input
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="Ask the host anything…"
                aria-label="Ask a question"
                maxLength={500}
                className="h-11 min-h-11 flex-1 text-xs"
              />
              <Button type="submit" disabled={busy || !qText.trim()} className="h-11 min-h-11 px-4 text-xs cursor-pointer shrink-0 border-transparent bg-[#333] text-white dark:bg-white dark:text-black">
                Send
              </Button>
            </form>
            <ul className="space-y-1.5 max-h-72 overflow-y-auto no-scrollbar pr-0.5">
              {questions.map((q) => (
                <li key={q.id} className={`rounded-xl border p-2.5 space-y-1 ${q.answered ? "border-foreground bg-muted/40" : "border-border bg-background/60"}`}>
                  <p className="text-xs">{q.answered ? "✓ " : ""}{q.text}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">{q.authorName} · {q.upvotes} upvotes</span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void run(() => post({ action: "q_upvote", questionId: q.id }))}
                        disabled={busy || q.upvoters.includes(actorId)}
                        className="min-h-11 px-3 rounded-lg border border-border text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                        aria-label="Upvote question"
                      >
                        ▲ {q.upvotes}
                      </button>
                      {canControl && (
                        <button
                          type="button"
                          onClick={() => void run(() => post({ action: "q_answer", questionId: q.id, answered: !q.answered }))}
                          disabled={busy}
                          className="min-h-11 px-3 rounded-lg border border-border text-[11px] cursor-pointer"
                        >
                          {q.answered ? "Reopen" : "Done"}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
              {questions.length === 0 && <li className="text-[11px] text-muted-foreground">No questions yet.</li>}
            </ul>
          </div>

          {/* Attendance */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-muted-foreground">ATTENDANCE ({attendance.length})</p>
            <ul className="max-h-36 overflow-y-auto no-scrollbar space-y-1 pr-0.5">
              {attendance.map((a) => (
                <li key={a.userId} className="flex items-center justify-between text-[11px] rounded-lg border border-border/60 px-2 py-1.5">
                  <span className="truncate font-medium">{a.userName}</span>
                  <span className="text-muted-foreground shrink-0">
                    joined {new Date(a.joinedAt).toLocaleTimeString()} · {fmtDur(a.totalSeconds)} present
                  </span>
                </li>
              ))}
              {attendance.length === 0 && <li className="text-[11px] text-muted-foreground">Nobody checked in yet.</li>}
            </ul>
          </div>

          {/* Personal timestamped notes */}
          <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <p className="text-[11px] font-bold text-muted-foreground">MY NOTES ({notes.length})</p>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!noteText.trim()) return;
                void run(async () => {
                  await post({ action: "note_add", text: noteText.trim(), videoTime: Math.floor(getCurrentTime()) });
                  setNoteText("");
                }, "Note saved.");
              }}
            >
              <Input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={`Note at ${fmtT(getCurrentTime())}…`}
                aria-label="Add a timestamped note"
                maxLength={2000}
                className="h-11 min-h-11 flex-1 text-xs"
              />
              <Button type="submit" disabled={busy || !noteText.trim()} className="h-11 min-h-11 px-4 text-xs cursor-pointer shrink-0 border-transparent bg-[#333] text-white dark:bg-white dark:text-black">
                Save
              </Button>
            </form>
            <ul className="space-y-1 max-h-32 overflow-y-auto no-scrollbar pr-0.5">
              {notes.slice(-8).reverse().map((n) => (
                <li key={n.id} className="text-[11px] rounded-lg border border-border/60 px-2 py-1.5">
                  <span className="font-mono font-bold">[{fmtT(n.videoTime)}]</span> {n.text}
                </li>
              ))}
            </ul>
          </div>

          {/* Exports */}
          <div className="grid grid-cols-3 gap-1.5">
            <a
              href={`/api/rooms/${slug}/class?format=markdown&userId=${encodeURIComponent(actorId)}`}
              className="flex min-h-11 items-center justify-center rounded-lg border border-border text-[11px] font-semibold"
              download
            >
              ⬇ Notes .md
            </a>
            <a
              href={`/api/rooms/${slug}/class?format=csv`}
              className="flex min-h-11 items-center justify-center rounded-lg border border-border text-[11px] font-semibold"
              download
            >
              ⬇ Attendance .csv
            </a>
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-11 rounded-lg border border-border text-[11px] font-semibold cursor-pointer"
            >
              🖨 PDF
            </button>
          </div>
        </div>
      )}

      {/* Bottom-sheet poll answers (mobile-first, 360px safe) */}
      {mode && openPoll && sheetPoll && (
        <div className="fixed inset-0 z-50" role="dialog" aria-label="Answer poll">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSheetPoll(null)} />
          <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-2xl border-t border-border bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2">
            <div className="mx-auto h-1 w-10 rounded-full bg-muted" />
            <p className="text-sm font-bold">{openPoll.question}</p>
            <div className="grid gap-2">
              {openPoll.options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      await post({ action: "poll_vote", pollId: openPoll.id, choice: i });
                      setSheetPoll(null);
                    }, "Vote counted.")
                  }
                  disabled={busy || !openPoll.isOpen}
                  className="min-h-12 rounded-xl border border-border bg-muted/40 text-sm font-semibold cursor-pointer disabled:opacity-50"
                >
                  {o}
                </button>
              ))}
            </div>
            <Button type="button" variant="outline" onClick={() => setSheetPoll(null)} className="w-full min-h-11 text-xs cursor-pointer">
              Close
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
