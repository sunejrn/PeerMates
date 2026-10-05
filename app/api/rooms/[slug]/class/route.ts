import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { getRole } from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import {
  getClassMode,
  setClassMode,
  createPoll,
  listPolls,
  updatePoll,
  votePoll,
  getPollVotes,
  askQuestion,
  listQuestions,
  upvoteQuestion,
  answerQuestion,
  heartbeatAttendance,
  listAttendance,
  addNote,
  listNotes,
} from "@/lib/redis/classmode";
import { broadcastRoomEvent } from "@/lib/stream/server";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

async function neonMirror(slug: string, fn: () => Promise<void>): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    await fn();
  } catch {
    // best-effort; Redis stays live
  }
}

async function notify(slug: string): Promise<void> {
  try {
    await broadcastRoomEvent(slug, { type: "room_class_changed" });
  } catch {
    // polling covers it
  }
}

function toCsv(rows: string[][]): string {
  return rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

function toMarkdown(opts: {
  title: string;
  notes: { text: string; videoTime: number }[];
  questions: { text: string; authorName: string; upvotes: number; answered: boolean }[];
  polls: { question: string; options: string[]; counts: number[]; correctIndex: number | null }[];
}): string {
  const fmtT = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };
  const lines = [`# ${opts.title} — Class notes`, ""];
  lines.push("## My timestamped notes", "");
  if (opts.notes.length === 0) lines.push("_No notes yet._", "");
  for (const n of opts.notes) lines.push(`- [${fmtT(n.videoTime)}] ${n.text}`);
  lines.push("", "## Question queue", "");
  if (opts.questions.length === 0) lines.push("_No questions yet._", "");
  for (const q of opts.questions) {
    lines.push(`- ${q.answered ? "[answered] " : ""}${q.text} — ${q.authorName} (${q.upvotes} upvotes)`);
  }
  lines.push("", "## Poll results", "");
  if (opts.polls.length === 0) lines.push("_No polls yet._", "");
  for (const p of opts.polls) {
    lines.push(`### ${p.question}`);
    p.options.forEach((o, i) => {
      lines.push(`- ${o}: ${p.counts[i] ?? 0}${p.correctIndex === i ? " ✓ correct" : ""}`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * GET /api/rooms/[slug]/class[?userId=][&format=markdown|csv]
 * Full Class Mode state (mode, polls+counts, questions, attendance, my notes).
 * format=markdown -> notes+questions+polls export; format=csv -> attendance.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const url = new URL(req.url);
    const format = url.searchParams.get("format");
    const userId = url.searchParams.get("userId") ?? "";

    const [mode, polls, questions, attendance] = await Promise.all([
      getClassMode(slug),
      listPolls(slug),
      listQuestions(slug),
      listAttendance(slug),
    ]);
    const countsBy: Record<string, Record<string, number>> = {};
    await Promise.all(
      polls.map(async (p) => {
        countsBy[p.id] = await getPollVotes(slug, p.id);
      })
    );
    const pollsWithCounts = polls.map((p) => {
      const votes = countsBy[p.id] ?? {};
      const counts = p.options.map((_, i) =>
        Object.values(votes).filter((v) => v === i).length
      );
      return { ...p, votes, counts, totalVotes: Object.keys(votes).length };
    });
    const notes = userId ? await listNotes(slug, userId) : [];

    if (format === "csv") {
      const csv = toCsv([
        ["userId", "userName", "joinedAt", "lastSeenAt", "minutesPresent"],
        ...attendance.map((a) => [
          a.userId,
          a.userName,
          new Date(a.joinedAt).toISOString(),
          new Date(a.lastSeenAt).toISOString(),
          (a.totalSeconds / 60).toFixed(1),
        ]),
      ]);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="attendance-${slug}.csv"`,
        },
      });
    }
    if (format === "markdown") {
      const md = toMarkdown({
        title: room.title,
        notes: notes.map((n) => ({ text: n.text, videoTime: n.videoTime })),
        questions: questions.map((q) => ({
          text: q.text,
          authorName: q.authorName,
          upvotes: q.upvotes,
          answered: q.answered,
        })),
        polls: pollsWithCounts.map((p) => ({
          question: p.question,
          options: p.options,
          counts: p.counts,
          correctIndex: p.correctIndex,
        })),
      });
      return new NextResponse(md, {
        headers: {
          "Content-Type": "text/markdown",
          "Content-Disposition": `attachment; filename="class-notes-${slug}.md"`,
        },
      });
    }
    return NextResponse.json({ mode, polls: pollsWithCounts, questions, attendance, notes });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/rooms/[slug]/class  { action, ... } — server-enforced host/co-host
 * for privileged actions (mode, poll create/close/reveal, question answer).
 * - mode { on } (privileged)
 * - poll_create { question, options[2..6], correctIndex? } (privileged)
 * - poll_vote { pollId, choice }
 * - poll_close { pollId } / poll_reveal { pollId, reveal? } (privileged)
 * - q_ask { text } / q_upvote { questionId } / q_answer { questionId, answered } (privileged)
 * - attend { userName }
 * - note_add { text, videoTime }
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = await checkRateLimit(
      `class:${slug}:${actorId}`,
      RATE_LIMITS.classWrite.limit,
      RATE_LIMITS.classWrite.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const action = String(body?.action ?? "");
    const role = await getRole(slug, actorId, room.hostId);
    const privileged = role === "host" || role === "cohost";
    const actorName = String(body?.actorName ?? body?.userName ?? "Member").slice(0, 60);

    const needPriv = () => {
      if (!privileged) throw Object.assign(new Error("Only hosts and co-hosts can do that."), { status: 403 });
    };

    try {
      if (action === "mode") {
        needPriv();
        const on = body?.on !== false;
        await setClassMode(slug, on);
        await neonMirror(slug, async () => {
          const { db } = await import("@/db/drizzle");
          const { classRooms } = await import("@/db/schema");
          await db.insert(classRooms).values({ roomSlug: slug, enabled: on, createdBy: actorId }).onConflictDoNothing();
        });
        await notify(slug);
        return NextResponse.json({ success: true, mode: on });
      }
      if (action === "poll_create") {
        needPriv();
        const question = String(body?.question ?? "").trim().slice(0, 300);
        const options = Array.isArray(body?.options)
          ? body.options.map((o: unknown) => String(o ?? "").trim()).filter(Boolean).slice(0, 6)
          : [];
        if (!question || options.length < 2) {
          return NextResponse.json({ error: "Give a question and at least 2 options." }, { status: 400 });
        }
        let correctIndex: number | null = null;
        const ci = Number(body?.correctIndex);
        if (Number.isInteger(ci) && ci >= 0 && ci < options.length) correctIndex = ci;
        const poll = await createPoll(slug, { question, options, correctIndex, createdBy: actorId });
        await neonMirror(slug, async () => {
          const { db } = await import("@/db/drizzle");
          const { classPolls } = await import("@/db/schema");
          await db.insert(classPolls).values({
            id: poll.id, roomSlug: slug, question, options, correctIndex, createdBy: actorId,
          });
        });
        await notify(slug);
        return NextResponse.json({ success: true, poll });
      }
      if (action === "poll_vote") {
        const pollId = String(body?.pollId ?? "");
        const choice = Number(body?.choice);
        if (!pollId || !Number.isInteger(choice)) {
          return NextResponse.json({ error: "pollId and choice are required." }, { status: 400 });
        }
        const polls = await listPolls(slug);
        const poll = polls.find((p) => p.id === pollId);
        if (!poll) return NextResponse.json({ error: "Poll not found." }, { status: 404 });
        if (!poll.isOpen) return NextResponse.json({ error: "That poll is closed." }, { status: 400 });
        if (choice < 0 || choice >= poll.options.length) {
          return NextResponse.json({ error: "Invalid choice." }, { status: 400 });
        }
        await votePoll(slug, pollId, actorId, choice);
        await neonMirror(slug, async () => {
          const { db } = await import("@/db/drizzle");
          const { classPollVotes } = await import("@/db/schema");
          await db.insert(classPollVotes).values({ roomSlug: slug, pollId, voterId: actorId, choice });
        });
        await notify(slug);
        return NextResponse.json({ success: true });
      }
      if (action === "poll_close" || action === "poll_reveal") {
        needPriv();
        const pollId = String(body?.pollId ?? "");
        if (!pollId) return NextResponse.json({ error: "pollId is required." }, { status: 400 });
        const next =
          action === "poll_close"
            ? await updatePoll(slug, pollId, { isOpen: false, closedAt: Date.now() })
            : await updatePoll(slug, pollId, { revealed: body?.reveal !== false });
        if (!next) return NextResponse.json({ error: "Poll not found." }, { status: 404 });
        await notify(slug);
        return NextResponse.json({ success: true, poll: next });
      }
      if (action === "q_ask") {
        const text = String(body?.text ?? "").trim().slice(0, 500);
        if (!text) return NextResponse.json({ error: "Write a question first." }, { status: 400 });
        const q = await askQuestion(slug, { text, authorId: actorId, authorName: actorName });
        await neonMirror(slug, async () => {
          const { db } = await import("@/db/drizzle");
          const { classQuestions } = await import("@/db/schema");
          await db.insert(classQuestions).values({
            id: q.id, roomSlug: slug, text, authorId: actorId, authorName: actorName,
          });
        });
        await notify(slug);
        return NextResponse.json({ success: true, question: q });
      }
      if (action === "q_upvote") {
        const questionId = String(body?.questionId ?? "");
        if (!questionId) return NextResponse.json({ error: "questionId is required." }, { status: 400 });
        const q = await upvoteQuestion(slug, questionId, actorId);
        if (!q) return NextResponse.json({ error: "Question not found." }, { status: 404 });
        await notify(slug);
        return NextResponse.json({ success: true, question: q });
      }
      if (action === "q_answer") {
        needPriv();
        const questionId = String(body?.questionId ?? "");
        if (!questionId) return NextResponse.json({ error: "questionId is required." }, { status: 400 });
        const q = await answerQuestion(slug, questionId, body?.answered !== false);
        if (!q) return NextResponse.json({ error: "Question not found." }, { status: 404 });
        await notify(slug);
        return NextResponse.json({ success: true, question: q });
      }
      if (action === "attend") {
        await heartbeatAttendance(slug, actorId, actorName);
        await neonMirror(slug, async () => {
          const { db } = await import("@/db/drizzle");
          const { classAttendance } = await import("@/db/schema");
          await db.insert(classAttendance).values({ roomSlug: slug, userId: actorId, userName: actorName }).onConflictDoNothing();
        });
        return NextResponse.json({ success: true });
      }
      if (action === "note_add") {
        const text = String(body?.text ?? "").trim().slice(0, 2000);
        if (!text) return NextResponse.json({ error: "Write a note first." }, { status: 400 });
        const videoTime = Number(body?.videoTime) || 0;
        const note = await addNote(slug, { userId: actorId, text, videoTime });
        await neonMirror(slug, async () => {
          const { db } = await import("@/db/drizzle");
          const { classNotes } = await import("@/db/schema");
          await db.insert(classNotes).values({ roomSlug: slug, userId: actorId, text, videoTime });
        });
        return NextResponse.json({ success: true, note });
      }
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status ?? 500;
      if (status === 403) return forbidden(e instanceof Error ? e.message : "Forbidden");
      throw e;
    }
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
