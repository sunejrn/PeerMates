import { redis } from "./client";

/**
 * Room roles + moderation state, Redis-backed with in-memory fallback.
 *
 * Roles: "host" | "cohost" | "viewer"
 * - The room creator is seeded as "host" on room creation.
 * - Only the host can promote/demote co-hosts (server-enforced).
 * - Host + co-hosts are "privileged": playback control, source changes,
 *   kicks/mutes, slow-mode. Viewers can only chat + react.
 * - Every key carries a TTL so abandoned rooms evaporate on free tiers.
 */

export type RoomRole = "host" | "cohost" | "viewer";

export interface RoomSettings {
  /** Minimum seconds between chat messages per user (0 = off). */
  slowModeSeconds: number;
  /** When true, only privileged users may chat. */
  chatMuted: boolean;
}

export interface ControlRequest {
  userId: string;
  name: string;
  image?: string;
  requestedAt: number;
}

const ROLES_KEY = (slug: string) => `room:${slug}:roles`;
const SETTINGS_KEY = (slug: string) => `room:${slug}:settings`;
const KICKED_KEY = (slug: string) => `room:${slug}:kicked`;
const MUTED_KEY = (slug: string) => `room:${slug}:muted`;
const REQUESTS_KEY = (slug: string) => `room:${slug}:control-requests`;
const CHAT_TS_KEY = (slug: string, userId: string) =>
  `room:${slug}:chat-ts:${userId}`;

const ROLES_TTL = 60 * 60 * 24 * 7; // 7 days
const SETTINGS_TTL = 60 * 60 * 24 * 7; // 7 days
const KICKED_TTL = 60 * 60 * 24; // 24 hours
const MUTED_TTL = 60 * 60 * 24; // 24 hours
const REQUESTS_TTL = 60 * 60 * 24; // 24 hours

export const DEFAULT_SETTINGS: RoomSettings = {
  slowModeSeconds: 0,
  chatMuted: false,
};

// ---- In-memory fallbacks (single-instance local dev only) ----

const memRoles = new Map<string, Map<string, RoomRole>>();
const memSettings = new Map<string, RoomSettings>();
const memKicked = new Map<string, Set<string>>();
const memMuted = new Map<string, Set<string>>();
const memRequests = new Map<string, Map<string, ControlRequest>>();
const memChatTs = new Map<string, number>();

function memMap<K, V>(outer: Map<string, Map<K, V>>, slug: string) {
  let m = outer.get(slug);
  if (!m) {
    m = new Map();
    outer.set(slug, m);
  }
  return m;
}

function memSet(outer: Map<string, Set<string>>, slug: string) {
  let s = outer.get(slug);
  if (!s) {
    s = new Set();
    outer.set(slug, s);
  }
  return s;
}

// ---- Roles ----

export async function setRole(
  slug: string,
  userId: string,
  role: RoomRole
): Promise<void> {
  if (redis) {
    try {
      await redis.hset(ROLES_KEY(slug), { [userId]: role });
      await redis.expire(ROLES_KEY(slug), ROLES_TTL);
      return;
    } catch (err) {
      console.warn("Redis setRole failed, using memory:", err);
    }
  }
  memMap(memRoles, slug).set(userId, role);
}

/** Seed the creator as host. Called once on room creation. */
export async function seedHostRole(
  slug: string,
  hostId: string
): Promise<void> {
  await setRole(slug, hostId, "host");
  await setSettings(slug, DEFAULT_SETTINGS);
}

/**
 * Resolve the effective role. Falls back to the room's hostId when no
 * explicit role was stored (rooms created before this feature, or the
 * Redis key expired while the room row still exists).
 */
export async function getRole(
  slug: string,
  userId: string,
  roomHostId?: string
): Promise<RoomRole> {
  if (!userId) return "viewer";
  if (redis) {
    try {
      const stored = await redis.hget<string>(ROLES_KEY(slug), userId);
      if (stored === "host" || stored === "cohost" || stored === "viewer") {
        return stored;
      }
    } catch (err) {
      console.warn("Redis getRole failed, using memory:", err);
    }
  } else {
    const stored = memMap(memRoles, slug).get(userId);
    if (stored) return stored;
  }
  if (roomHostId && userId === roomHostId) return "host";
  return "viewer";
}

export async function getAllRoles(
  slug: string
): Promise<Record<string, RoomRole>> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(ROLES_KEY(slug));
      if (!raw) return {};
      const out: Record<string, RoomRole> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (v === "host" || v === "cohost" || v === "viewer") out[k] = v;
      }
      return out;
    } catch (err) {
      console.warn("Redis getAllRoles failed, using memory:", err);
    }
  }
  return Object.fromEntries(memMap(memRoles, slug).entries());
}

export function isPrivileged(role: RoomRole): boolean {
  return role === "host" || role === "cohost";
}

export async function canControl(
  slug: string,
  userId: string,
  roomHostId?: string
): Promise<boolean> {
  return isPrivileged(await getRole(slug, userId, roomHostId));
}

/** Co-hosts first (earliest promoted), then longest-tenured viewer. */
export async function pickSuccessor(
  slug: string,
  candidates: { id: string; joinedAt: number }[],
  roomHostId?: string
): Promise<string | null> {
  if (candidates.length === 0) return null;
  const roles = await getAllRoles(slug);
  const roleOf = (id: string): RoomRole =>
    roles[id] ?? (roomHostId && id === roomHostId ? "host" : "viewer");
  const sorted = [...candidates].sort((a, b) => a.joinedAt - b.joinedAt);
  const cohost = sorted.find((c) => roleOf(c.id) === "cohost");
  return (cohost ?? sorted[0]).id;
}

// ---- Settings (slow mode + mute-all) ----

export async function getSettings(slug: string): Promise<RoomSettings> {
  if (redis) {
    try {
      const raw = await redis.get<string | RoomSettings>(SETTINGS_KEY(slug));
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed =
        typeof raw === "string" ? JSON.parse(raw) : (raw as RoomSettings);
      return {
        slowModeSeconds:
          typeof parsed.slowModeSeconds === "number"
            ? Math.max(0, Math.min(120, parsed.slowModeSeconds))
            : 0,
        chatMuted: Boolean(parsed.chatMuted),
      };
    } catch (err) {
      console.warn("Redis getSettings failed, using memory:", err);
    }
  }
  return { ...(memSettings.get(slug) ?? DEFAULT_SETTINGS) };
}

export async function setSettings(
  slug: string,
  settings: RoomSettings
): Promise<void> {
  const clean: RoomSettings = {
    slowModeSeconds: Math.max(0, Math.min(120, Math.floor(settings.slowModeSeconds || 0))),
    chatMuted: Boolean(settings.chatMuted),
  };
  if (redis) {
    try {
      await redis.set(SETTINGS_KEY(slug), JSON.stringify(clean), {
        ex: SETTINGS_TTL,
      });
      return;
    } catch (err) {
      console.warn("Redis setSettings failed, using memory:", err);
    }
  }
  memSettings.set(slug, clean);
}

// ---- Kicks / mutes ----

export async function kickUser(slug: string, userId: string): Promise<void> {
  if (redis) {
    try {
      await redis.sadd(KICKED_KEY(slug), userId);
      await redis.expire(KICKED_KEY(slug), KICKED_TTL);
      return;
    } catch (err) {
      console.warn("Redis kickUser failed, using memory:", err);
    }
  }
  memSet(memKicked, slug).add(userId);
}

export async function isKicked(
  slug: string,
  userId: string
): Promise<boolean> {
  if (!userId) return false;
  if (redis) {
    try {
      return (await redis.sismember(KICKED_KEY(slug), userId)) === 1;
    } catch (err) {
      console.warn("Redis isKicked failed, using memory:", err);
    }
  }
  return memSet(memKicked, slug).has(userId);
}

export async function muteUser(slug: string, userId: string): Promise<void> {
  if (redis) {
    try {
      await redis.sadd(MUTED_KEY(slug), userId);
      await redis.expire(MUTED_KEY(slug), MUTED_TTL);
      return;
    } catch (err) {
      console.warn("Redis muteUser failed, using memory:", err);
    }
  }
  memSet(memMuted, slug).add(userId);
}

export async function unmuteUser(
  slug: string,
  userId: string
): Promise<void> {
  if (redis) {
    try {
      await redis.srem(MUTED_KEY(slug), userId);
      return;
    } catch (err) {
      console.warn("Redis unmuteUser failed, using memory:", err);
    }
  }
  memSet(memMuted, slug).delete(userId);
}

export async function isMutedChat(
  slug: string,
  userId: string
): Promise<boolean> {
  if (!userId) return false;
  if (redis) {
    try {
      return (await redis.sismember(MUTED_KEY(slug), userId)) === 1;
    } catch (err) {
      console.warn("Redis isMutedChat failed, using memory:", err);
    }
  }
  return memSet(memMuted, slug).has(userId);
}

/** Full muted-user list (privileged callers only — used for badges). */
export async function getMutedUserIds(slug: string): Promise<string[]> {
  if (redis) {
    try {
      const ids = await redis.smembers(MUTED_KEY(slug));
      return Array.isArray(ids) ? ids.map(String) : [];
    } catch (err) {
      console.warn("Redis getMutedUserIds failed, using memory:", err);
    }
  }
  return Array.from(memSet(memMuted, slug));
}

// ---- "Request control" hand-raises ----

export async function addControlRequest(
  slug: string,
  req: ControlRequest
): Promise<void> {
  const payload = JSON.stringify(req);
  if (redis) {
    try {
      await redis.hset(REQUESTS_KEY(slug), { [req.userId]: payload });
      await redis.expire(REQUESTS_KEY(slug), REQUESTS_TTL);
      return;
    } catch (err) {
      console.warn("Redis addControlRequest failed, using memory:", err);
    }
  }
  memMap(memRequests, slug).set(req.userId, req);
}

export async function removeControlRequest(
  slug: string,
  userId: string
): Promise<void> {
  if (redis) {
    try {
      await redis.hdel(REQUESTS_KEY(slug), userId);
      return;
    } catch (err) {
      console.warn("Redis removeControlRequest failed, using memory:", err);
    }
  }
  memMap(memRequests, slug).delete(userId);
}

export async function getControlRequests(
  slug: string
): Promise<ControlRequest[]> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(
        REQUESTS_KEY(slug)
      );
      if (!raw) return [];
      const out: ControlRequest[] = [];
      for (const value of Object.values(raw)) {
        try {
          const parsed: unknown =
            typeof value === "string" ? JSON.parse(value) : value;
          if (parsed && typeof parsed === "object") {
            const rec = parsed as Record<string, unknown>;
            if (typeof rec.userId === "string") {
              out.push({
                userId: rec.userId,
                name: typeof rec.name === "string" ? rec.name : "Viewer",
                image: typeof rec.image === "string" ? rec.image : undefined,
                requestedAt:
                  typeof rec.requestedAt === "number"
                    ? rec.requestedAt
                    : Date.now(),
              });
            }
          }
        } catch {
          // skip corrupt entries
        }
      }
      out.sort((a, b) => a.requestedAt - b.requestedAt);
      return out;
    } catch (err) {
      console.warn("Redis getControlRequests failed, using memory:", err);
    }
  }
  return Array.from(memMap(memRequests, slug).values()).sort(
    (a, b) => a.requestedAt - b.requestedAt
  );
}

// ---- Chat slow-mode timestamps ----

/**
 * Returns seconds the user must wait before chatting again (0 = may send).
 * When sending is allowed, records the send timestamp.
 */
export async function checkAndRecordChatSend(
  slug: string,
  userId: string,
  slowModeSeconds: number
): Promise<{ waitSeconds: number }> {
  if (slowModeSeconds <= 0) return { waitSeconds: 0 };
  const now = Date.now();
  if (redis) {
    try {
      const lastRaw = await redis.get<string | number>(
        CHAT_TS_KEY(slug, userId)
      );
      const last = lastRaw == null ? 0 : Number(lastRaw);
      const waitMs = last + slowModeSeconds * 1000 - now;
      if (waitMs > 0) {
        return { waitSeconds: Math.ceil(waitMs / 1000) };
      }
      await redis.set(CHAT_TS_KEY(slug, userId), String(now), {
        ex: slowModeSeconds + 5,
      });
      return { waitSeconds: 0 };
    } catch (err) {
      console.warn("Redis slow-mode check failed, using memory:", err);
    }
  }
  const key = `${slug}:${userId}`;
  const last = memChatTs.get(key) ?? 0;
  const waitMs = last + slowModeSeconds * 1000 - now;
  if (waitMs > 0) return { waitSeconds: Math.ceil(waitMs / 1000) };
  memChatTs.set(key, now);
  return { waitSeconds: 0 };
}
