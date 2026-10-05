import { redis } from "@/lib/redis/client";
import type { LocalFingerprint } from "@/lib/video/localfile";

/**
 * Movie Night Picker — live state on Upstash Redis, saved shortlists in Neon.
 *
 * Keys (all TTL'd 7d so abandoned votes evaporate on free tiers):
 * - room:{slug}:picker:candidates   hash id -> candidate JSON
 * - room:{slug}:picker:votes        hash voterId -> candidateId (one vote pp)
 * - room:{slug}:picker:meta         { votingOpen, winnerId, countdownAt }
 * - room:{slug}:picker:have:{id}    set of userIds that have the file
 *
 * Neon tables picker_candidates / picker_votes mirror adds + votes
 * best-effort (routes do that); Redis stays the live source of truth.
 */

export type PickerKind = "link" | "file";

export interface PickerCandidate {
  id: string;
  title: string;
  kind: PickerKind;
  url?: string | null;
  fpId?: string | null;
  fingerprint?: LocalFingerprint | null;
  addedBy: string;
  addedByName?: string;
  createdAt: number;
  winner?: boolean;
}

export interface PickerMeta {
  votingOpen: boolean;
  winnerId: string | null;
  countdownAt: number | null;
}

const CAND_KEY = (slug: string) => `room:${slug}:picker:candidates`;
const VOTES_KEY = (slug: string) => `room:${slug}:picker:votes`;
const META_KEY = (slug: string) => `room:${slug}:picker:meta`;
const HAVE_KEY = (slug: string, id: string) => `room:${slug}:picker:have:${id}`;
const TTL = 60 * 60 * 24 * 7;

interface MemRoom {
  candidates: Map<string, PickerCandidate>;
  votes: Map<string, string>;
  have: Map<string, Set<string>>;
  meta: PickerMeta;
}
const mem = new Map<string, MemRoom>();
function memRoom(slug: string): MemRoom {
  let r = mem.get(slug);
  if (!r) {
    r = {
      candidates: new Map(),
      votes: new Map(),
      have: new Map(),
      meta: { votingOpen: true, winnerId: null, countdownAt: null },
    };
    mem.set(slug, r);
  }
  return r;
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `pk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export async function addCandidate(
  slug: string,
  c: Omit<PickerCandidate, "id" | "createdAt">
): Promise<PickerCandidate> {
  const full: PickerCandidate = {
    ...c,
    fingerprint: c.fingerprint ?? null,
    url: c.url ?? null,
    fpId: c.fpId ?? null,
    id: newId(),
    createdAt: Date.now(),
  };
  if (redis) {
    try {
      await redis.hset(CAND_KEY(slug), { [full.id]: JSON.stringify(full) });
      await redis.expire(CAND_KEY(slug), TTL);
      const m = await getPickerMeta(slug);
      if (!m.winnerId) await redis.expire(META_KEY(slug), TTL);
      return full;
    } catch (err) {
      console.warn("Redis picker add failed, using memory:", err);
    }
  }
  memRoom(slug).candidates.set(full.id, full);
  return full;
}

export async function listCandidates(slug: string): Promise<PickerCandidate[]> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(CAND_KEY(slug));
      if (!raw) return memRoom(slug).candidates.size
        ? Array.from(memRoom(slug).candidates.values())
        : [];
      const out: PickerCandidate[] = [];
      for (const v of Object.values(raw)) {
        try {
          const p = (typeof v === "string" ? JSON.parse(v) : v) as PickerCandidate;
          if (p?.id) out.push(p);
        } catch {
          // skip
        }
      }
      out.sort((a, b) => a.createdAt - b.createdAt);
      return out;
    } catch (err) {
      console.warn("Redis picker list failed, using memory:", err);
    }
  }
  return Array.from(memRoom(slug).candidates.values()).sort(
    (a, b) => a.createdAt - b.createdAt
  );
}

export async function getVotes(slug: string): Promise<Record<string, string>> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(VOTES_KEY(slug));
      if (!raw) return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) out[k] = String(v);
      return out;
    } catch (err) {
      console.warn("Redis picker votes failed, using memory:", err);
    }
  }
  return Object.fromEntries(memRoom(slug).votes.entries());
}

/** One vote per person, changeable until close. Returns false when closed. */
export async function castVote(
  slug: string,
  voterId: string,
  candidateId: string
): Promise<boolean> {
  const meta = await getPickerMeta(slug);
  if (!meta.votingOpen) return false;
  const cands = await listCandidates(slug);
  if (!cands.some((c) => c.id === candidateId)) return false;
  if (redis) {
    try {
      await redis.hset(VOTES_KEY(slug), { [voterId]: candidateId });
      await redis.expire(VOTES_KEY(slug), TTL);
      return true;
    } catch (err) {
      console.warn("Redis picker vote failed, using memory:", err);
    }
  }
  memRoom(slug).votes.set(voterId, candidateId);
  return true;
}

export async function getPickerMeta(slug: string): Promise<PickerMeta> {
  if (redis) {
    try {
      const raw = await redis.get<string | PickerMeta>(META_KEY(slug));
      if (raw) {
        const m = (typeof raw === "string" ? JSON.parse(raw) : raw) as PickerMeta;
        return {
          votingOpen: m.votingOpen !== false,
          winnerId: m.winnerId ?? null,
          countdownAt: m.countdownAt ?? null,
        };
      }
    } catch (err) {
      console.warn("Redis picker meta failed, using memory:", err);
    }
  }
  return { ...memRoom(slug).meta };
}

export async function setPickerMeta(slug: string, meta: PickerMeta): Promise<void> {
  if (redis) {
    try {
      await redis.set(META_KEY(slug), JSON.stringify(meta), { ex: TTL });
      return;
    } catch (err) {
      console.warn("Redis picker meta set failed, using memory:", err);
    }
  }
  memRoom(slug).meta = { ...meta };
}

export async function markHaveFile(
  slug: string,
  candidateId: string,
  userId: string
): Promise<void> {
  if (redis) {
    try {
      await redis.sadd(HAVE_KEY(slug, candidateId), userId);
      await redis.expire(HAVE_KEY(slug, candidateId), TTL);
      return;
    } catch {
      // fall through
    }
  }
  const r = memRoom(slug);
  let s = r.have.get(candidateId);
  if (!s) {
    s = new Set();
    r.have.set(candidateId, s);
  }
  s.add(userId);
}

export async function getHaveFile(
  slug: string,
  candidateId: string
): Promise<string[]> {
  if (redis) {
    try {
      const ids = await redis.smembers(HAVE_KEY(slug, candidateId));
      return Array.isArray(ids) ? ids.map(String) : [];
    } catch {
      // fall through
    }
  }
  return Array.from(memRoom(slug).have.get(candidateId) ?? []);
}
