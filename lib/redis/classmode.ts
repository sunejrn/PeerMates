import { redis } from "@/lib/redis/client";

/**
 * Class Mode live state on Upstash Redis (Neon mirrors best-effort in routes).
 * Polls/quizzes, question queue + upvotes, attendance heartbeats, notes.
 * All TTL'd 7d; in-memory fallback for local dev without Upstash.
 */

export interface ClassPoll {
  id: string;
  question: string;
  options: string[];
  correctIndex: number | null;
  isOpen: boolean;
  revealed: boolean;
  createdBy: string;
  createdAt: number;
  closedAt: number | null;
}

export interface ClassQuestion {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  upvotes: number;
  upvoters: string[];
  answered: boolean;
  createdAt: number;
}

export interface AttendanceEntry {
  userId: string;
  userName: string;
  joinedAt: number;
  lastSeenAt: number;
  totalSeconds: number;
}

export interface ClassNote {
  id: string;
  userId: string;
  text: string;
  videoTime: number;
  createdAt: number;
}

const MODE_KEY = (slug: string) => `room:${slug}:class:mode`;
const POLLS_KEY = (slug: string) => `room:${slug}:class:polls`;
const PVOTES_KEY = (slug: string, pollId: string) => `room:${slug}:class:pvotes:${pollId}`;
const Q_KEY = (slug: string) => `room:${slug}:class:questions`;
const ATT_KEY = (slug: string) => `room:${slug}:class:attendance`;
const NOTES_KEY = (slug: string, userId: string) => `room:${slug}:class:notes:${userId}`;
const TTL = 60 * 60 * 24 * 7;

interface MemClass {
  mode: boolean;
  polls: Map<string, ClassPoll>;
  pvotes: Map<string, Map<string, number>>;
  questions: Map<string, ClassQuestion>;
  attendance: Map<string, AttendanceEntry>;
  notes: Map<string, ClassNote[]>;
}
const mem = new Map<string, MemClass>();
function memClass(slug: string): MemClass {
  let r = mem.get(slug);
  if (!r) {
    r = { mode: false, polls: new Map(), pvotes: new Map(), questions: new Map(), attendance: new Map(), notes: new Map() };
    mem.set(slug, r);
  }
  return r;
}

function nid(p = "id"): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ---- mode ----

export async function getClassMode(slug: string): Promise<boolean> {
  if (redis) {
    try {
      const v = await redis.get<string | number>(MODE_KEY(slug));
      if (v === "1" || v === 1) return true;
      if (v != null) return false;
    } catch (err) {
      console.warn("Redis class mode get failed:", err);
    }
  }
  return memClass(slug).mode;
}

export async function setClassMode(slug: string, on: boolean): Promise<void> {
  if (redis) {
    try {
      if (on) await redis.set(MODE_KEY(slug), "1", { ex: TTL });
      else await redis.del(MODE_KEY(slug));
      return;
    } catch (err) {
      console.warn("Redis class mode set failed:", err);
    }
  }
  memClass(slug).mode = on;
}

// ---- polls ----

export async function createPoll(
  slug: string,
  p: { question: string; options: string[]; correctIndex: number | null; createdBy: string }
): Promise<ClassPoll> {
  const full: ClassPoll = {
    id: nid("poll"),
    question: p.question.slice(0, 300),
    options: p.options.slice(0, 6).map((o) => o.slice(0, 120)),
    correctIndex: p.correctIndex,
    isOpen: true,
    revealed: false,
    createdBy: p.createdBy,
    createdAt: Date.now(),
    closedAt: null,
  };
  if (redis) {
    try {
      await redis.hset(POLLS_KEY(slug), { [full.id]: JSON.stringify(full) });
      await redis.expire(POLLS_KEY(slug), TTL);
      return full;
    } catch (err) {
      console.warn("Redis class poll create failed:", err);
    }
  }
  memClass(slug).polls.set(full.id, full);
  return full;
}

export async function listPolls(slug: string): Promise<ClassPoll[]> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(POLLS_KEY(slug));
      if (!raw) return Array.from(memClass(slug).polls.values());
      const out: ClassPoll[] = [];
      for (const v of Object.values(raw)) {
        try {
          const p = (typeof v === "string" ? JSON.parse(v) : v) as ClassPoll;
          if (p?.id) out.push(p);
        } catch {
          // skip
        }
      }
      out.sort((a, b) => b.createdAt - a.createdAt);
      return out;
    } catch (err) {
      console.warn("Redis class polls list failed:", err);
    }
  }
  return Array.from(memClass(slug).polls.values()).sort((a, b) => b.createdAt - a.createdAt);
}

async function savePoll(slug: string, poll: ClassPoll): Promise<void> {
  if (redis) {
    try {
      await redis.hset(POLLS_KEY(slug), { [poll.id]: JSON.stringify(poll) });
      await redis.expire(POLLS_KEY(slug), TTL);
      return;
    } catch {
      // fall through
    }
  }
  memClass(slug).polls.set(poll.id, poll);
}

export async function updatePoll(
  slug: string,
  id: string,
  patch: Partial<Pick<ClassPoll, "isOpen" | "revealed" | "closedAt">>
): Promise<ClassPoll | null> {
  const polls = await listPolls(slug);
  const found = polls.find((p) => p.id === id);
  if (!found) return null;
  const next = { ...found, ...patch };
  await savePoll(slug, next);
  return next;
}

export async function votePoll(
  slug: string,
  pollId: string,
  voterId: string,
  choice: number
): Promise<boolean> {
  if (redis) {
    try {
      await redis.hset(PVOTES_KEY(slug, pollId), { [voterId]: String(choice) });
      await redis.expire(PVOTES_KEY(slug, pollId), TTL);
      return true;
    } catch (err) {
      console.warn("Redis class vote failed:", err);
    }
  }
  const m = memClass(slug);
  let map = m.pvotes.get(pollId);
  if (!map) {
    map = new Map();
    m.pvotes.set(pollId, map);
  }
  map.set(voterId, choice);
  return true;
}

export async function getPollVotes(
  slug: string,
  pollId: string
): Promise<Record<string, number>> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(PVOTES_KEY(slug, pollId));
      if (!raw) return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n)) out[k] = n;
      }
      return out;
    } catch (err) {
      console.warn("Redis class votes get failed:", err);
    }
  }
  const map = memClass(slug).pvotes.get(pollId);
  return map ? Object.fromEntries(map.entries()) : {};
}

// ---- question queue ----

export async function askQuestion(
  slug: string,
  q: { text: string; authorId: string; authorName: string }
): Promise<ClassQuestion> {
  const full: ClassQuestion = {
    id: nid("q"),
    text: q.text.slice(0, 500),
    authorId: q.authorId,
    authorName: q.authorName.slice(0, 60),
    upvotes: 0,
    upvoters: [],
    answered: false,
    createdAt: Date.now(),
  };
  if (redis) {
    try {
      await redis.hset(Q_KEY(slug), { [full.id]: JSON.stringify(full) });
      await redis.expire(Q_KEY(slug), TTL);
      return full;
    } catch (err) {
      console.warn("Redis class ask failed:", err);
    }
  }
  memClass(slug).questions.set(full.id, full);
  return full;
}

export async function listQuestions(slug: string): Promise<ClassQuestion[]> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(Q_KEY(slug));
      if (!raw) return Array.from(memClass(slug).questions.values());
      const out: ClassQuestion[] = [];
      for (const v of Object.values(raw)) {
        try {
          const q = (typeof v === "string" ? JSON.parse(v) : v) as ClassQuestion;
          if (q?.id) out.push(q);
        } catch {
          // skip
        }
      }
      out.sort((a, b) => b.upvotes - a.upvotes || a.createdAt - b.createdAt);
      return out;
    } catch (err) {
      console.warn("Redis class questions list failed:", err);
    }
  }
  return Array.from(memClass(slug).questions.values()).sort(
    (a, b) => b.upvotes - a.upvotes || a.createdAt - b.createdAt
  );
}

export async function upvoteQuestion(
  slug: string,
  id: string,
  voterId: string
): Promise<ClassQuestion | null> {
  const list = await listQuestions(slug);
  const q = list.find((x) => x.id === id);
  if (!q) return null;
  if (!q.upvoters.includes(voterId)) {
    q.upvoters = [...q.upvoters, voterId].slice(0, 500);
    q.upvotes = q.upvoters.length;
  }
  if (redis) {
    try {
      await redis.hset(Q_KEY(slug), { [q.id]: JSON.stringify(q) });
      return q;
    } catch {
      // fall through
    }
  }
  memClass(slug).questions.set(q.id, q);
  return q;
}

export async function answerQuestion(
  slug: string,
  id: string,
  answered: boolean
): Promise<ClassQuestion | null> {
  const list = await listQuestions(slug);
  const q = list.find((x) => x.id === id);
  if (!q) return null;
  q.answered = answered;
  if (redis) {
    try {
      await redis.hset(Q_KEY(slug), { [q.id]: JSON.stringify(q) });
      return q;
    } catch {
      // fall through
    }
  }
  memClass(slug).questions.set(q.id, q);
  return q;
}

// ---- attendance ----

export async function heartbeatAttendance(
  slug: string,
  userId: string,
  userName: string
): Promise<void> {
  const now = Date.now();
  if (redis) {
    try {
      const raw = await redis.hget<string>(ATT_KEY(slug), userId);
      let entry: AttendanceEntry;
      if (raw) {
        try {
          entry = (typeof raw === "string" ? JSON.parse(raw) : raw) as AttendanceEntry;
        } catch {
          entry = { userId, userName, joinedAt: now, lastSeenAt: now, totalSeconds: 0 };
        }
        const gap = Math.min(30, Math.max(0, Math.round((now - entry.lastSeenAt) / 1000)));
        entry = {
          ...entry,
          userName,
          lastSeenAt: now,
          totalSeconds: entry.totalSeconds + gap,
        };
      } else {
        entry = { userId, userName, joinedAt: now, lastSeenAt: now, totalSeconds: 0 };
      }
      await redis.hset(ATT_KEY(slug), { [userId]: JSON.stringify(entry) });
      await redis.expire(ATT_KEY(slug), TTL);
      return;
    } catch (err) {
      console.warn("Redis attendance failed:", err);
    }
  }
  const m = memClass(slug);
  const prev = m.attendance.get(userId);
  if (prev) {
    const gap = Math.min(30, Math.max(0, Math.round((now - prev.lastSeenAt) / 1000)));
    m.attendance.set(userId, { ...prev, userName, lastSeenAt: now, totalSeconds: prev.totalSeconds + gap });
  } else {
    m.attendance.set(userId, { userId, userName, joinedAt: now, lastSeenAt: now, totalSeconds: 0 });
  }
}

export async function listAttendance(slug: string): Promise<AttendanceEntry[]> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(ATT_KEY(slug));
      if (!raw) return Array.from(memClass(slug).attendance.values());
      const out: AttendanceEntry[] = [];
      for (const v of Object.values(raw)) {
        try {
          const e = (typeof v === "string" ? JSON.parse(v) : v) as AttendanceEntry;
          if (e?.userId) out.push(e);
        } catch {
          // skip
        }
      }
      out.sort((a, b) => a.joinedAt - b.joinedAt);
      return out;
    } catch (err) {
      console.warn("Redis attendance list failed:", err);
    }
  }
  return Array.from(memClass(slug).attendance.values()).sort((a, b) => a.joinedAt - b.joinedAt);
}

// ---- notes ----

export async function addNote(
  slug: string,
  n: { userId: string; text: string; videoTime: number }
): Promise<ClassNote> {
  const full: ClassNote = {
    id: nid("n"),
    userId: n.userId,
    text: n.text.slice(0, 2000),
    videoTime: Math.max(0, n.videoTime),
    createdAt: Date.now(),
  };
  if (redis) {
    try {
      const raw = await redis.get<string>(NOTES_KEY(slug, n.userId));
      const list: ClassNote[] = raw ? JSON.parse(raw) : [];
      list.push(full);
      await redis.set(NOTES_KEY(slug, n.userId), JSON.stringify(list.slice(-200)), { ex: TTL });
      return full;
    } catch (err) {
      console.warn("Redis note add failed:", err);
    }
  }
  const m = memClass(slug);
  const list = m.notes.get(n.userId) ?? [];
  list.push(full);
  m.notes.set(n.userId, list.slice(-200));
  return full;
}

export async function listNotes(slug: string, userId: string): Promise<ClassNote[]> {
  if (redis) {
    try {
      const raw = await redis.get<string>(NOTES_KEY(slug, userId));
      if (!raw) return memClass(slug).notes.get(userId) ?? [];
      const list = JSON.parse(raw) as ClassNote[];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn("Redis notes list failed:", err);
    }
  }
  return memClass(slug).notes.get(userId) ?? [];
}
