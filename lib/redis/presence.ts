import { redis } from "./client";
import type { PartyMember } from "@/lib/stream/realtimeClient";

const PRESENCE_TTL_SECONDS = 35; // heartbeat must refresh within this window
const PRESENCE_KEY = (slug: string) => `room:${slug}:presence`;

// In-memory fallback for local dev without Upstash (single-instance only)
const inMemoryPresence = new Map<string, Map<string, PartyMember & { lastSeen: number }>>();

function memMap(slug: string) {
  let m = inMemoryPresence.get(slug);
  if (!m) {
    m = new Map();
    inMemoryPresence.set(slug, m);
  }
  return m;
}

export async function heartbeatPresence(
  slug: string,
  member: PartyMember
): Promise<void> {
  const payload = JSON.stringify({ ...member, lastSeen: Date.now() });
  if (redis) {
    try {
      await redis.hset(PRESENCE_KEY(slug), { [member.id]: payload });
      await redis.expire(PRESENCE_KEY(slug), PRESENCE_TTL_SECONDS * 2);
      return;
    } catch (err) {
      console.warn("Redis presence write failed, using memory:", err);
    }
  }
  memMap(slug).set(member.id, { ...member, lastSeen: Date.now() });
}

export async function removePresence(
  slug: string,
  userId: string
): Promise<void> {
  if (redis) {
    try {
      await redis.hdel(PRESENCE_KEY(slug), userId);
      return;
    } catch {
      // fall through to memory
    }
  }
  memMap(slug).delete(userId);
}

export async function getPresence(slug: string): Promise<PartyMember[]> {
  const cutoff = Date.now() - PRESENCE_TTL_SECONDS * 1000;
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(
        PRESENCE_KEY(slug)
      );
      if (!raw) return [];
      const members: PartyMember[] = [];
      for (const value of Object.values(raw)) {
        try {
          const parsed =
            typeof value === "string" ? JSON.parse(value) : (value as any);
          if (parsed.lastSeen && parsed.lastSeen < cutoff) continue;
          members.push({
            id: parsed.id,
            name: parsed.name,
            image: parsed.image,
            role: parsed.role,
            joinedAt: parsed.joinedAt,
            fileMatch:
              parsed.fileMatch === true
                ? true
                : parsed.fileMatch === false
                  ? false
                  : null,
          });
        } catch {
          // skip corrupt entries
        }
      }
      // Sort by join time so host promotion is deterministic
      members.sort((a, b) => a.joinedAt - b.joinedAt);
      return members;
    } catch (err) {
      console.warn("Redis presence read failed, using memory:", err);
    }
  }
  return Array.from(memMap(slug).values())
    .filter((m) => m.lastSeen >= cutoff)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map(({ lastSeen: _omit, ...member }) => member);
}
