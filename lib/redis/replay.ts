import { redis } from "@/lib/redis/client";

/**
 * Party Replay capture buffer + replay-row fallback store.
 * Room events are RPUSHed to a Redis list (cheap, free-tier friendly) and
 * flushed to Neon in batches — a 500-viewer burst never touches the DB
 * per-event. Pattern mirrors lib/redis/roles.ts (Redis with in-memory
 * fallback for local dev).
 */

export type ReplayEventType = "reaction" | "message" | "voice" | "pin";

export interface BufferedReplayEvent {
  id: string;
  userId: string;
  userName?: string;
  type: ReplayEventType;
  videoTime: number;
  payload?: Record<string, unknown>;
  ts: number;
  /** Chat message id (for delete-your-message propagation). */
  messageId?: string;
}

const BUFFER_KEY = (slug: string) => `room:${slug}:replay-buffer`;
const REPLAY_ROW_KEY = (id: string) => `replay:row:${id}`;
const FLUSH_LOCK_KEY = (slug: string) => `room:${slug}:replay-flush-lock`;

const BUFFER_TTL = 60 * 60 * 24 * 7; // 7 days
const ROW_TTL = 60 * 60 * 24 * 30; // 30 days
const MAX_BUFFER = 5000;

const memBuffer = new Map<string, BufferedReplayEvent[]>();
const memRows = new Map<string, unknown>();
const memFlushLocks = new Set<string>();

/**
 * Single-flight flush guard: concurrent burst requests must not pop the
 * same slice twice (that duplicates events when the insert fails and the
 * batch is re-buffered). Redis SET NX (or a memory flag in dev).
 */
export async function acquireFlushLock(slug: string): Promise<boolean> {
  if (redis) {
    try {
      const res = await redis.set(FLUSH_LOCK_KEY(slug), "1", { nx: true, ex: 30 });
      return res === "OK";
    } catch {
      // fall through to memory flag
    }
  }
  if (memFlushLocks.has(slug)) return false;
  memFlushLocks.add(slug);
  return true;
}

export async function releaseFlushLock(slug: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(FLUSH_LOCK_KEY(slug));
    } catch {
      // ignore
    }
  }
  memFlushLocks.delete(slug);
}

export async function pushReplayEvent(
  slug: string,
  event: BufferedReplayEvent
): Promise<number> {
  if (redis) {
    try {
      const len = await redis.rpush(BUFFER_KEY(slug), JSON.stringify(event));
      await redis.expire(BUFFER_KEY(slug), BUFFER_TTL);
      if (len > MAX_BUFFER) {
        await redis.ltrim(BUFFER_KEY(slug), len - MAX_BUFFER, -1);
        return MAX_BUFFER;
      }
      return len;
    } catch (err) {
      console.warn("Redis pushReplayEvent failed, using memory:", err);
    }
  }
  const list = memBuffer.get(slug) ?? [];
  list.push(event);
  while (list.length > MAX_BUFFER) list.shift();
  memBuffer.set(slug, list);
  return list.length;
}

export async function replayBufferLength(slug: string): Promise<number> {
  if (redis) {
    try {
      const len = await redis.llen(BUFFER_KEY(slug));
      return typeof len === "number" ? len : 0;
    } catch {
      // fall through to memory
    }
  }
  return memBuffer.get(slug)?.length ?? 0;
}

/** Pop up to `count` oldest buffered events (for batched Neon flush). */
export async function popReplayEvents(
  slug: string,
  count: number
): Promise<BufferedReplayEvent[]> {
  if (redis) {
    try {
      const raw = await redis.lrange<string[]>(BUFFER_KEY(slug), 0, count - 1);
      if (raw && raw.length > 0) {
        await redis.ltrim(BUFFER_KEY(slug), raw.length, -1);
      }
      const out: BufferedReplayEvent[] = [];
      for (const item of raw ?? []) {
        try {
          const parsed = typeof item === "string" ? JSON.parse(item) : item;
          if (parsed && typeof parsed === "object") out.push(parsed as BufferedReplayEvent);
        } catch {
          // skip corrupt entries
        }
      }
      return out;
    } catch (err) {
      console.warn("Redis popReplayEvents failed, using memory:", err);
    }
  }
  const list = memBuffer.get(slug) ?? [];
  const out = list.splice(0, count);
  memBuffer.set(slug, list);
  return out;
}

/** Read (without popping) the whole buffer — used at finalize time. */
export async function peekReplayEvents(slug: string): Promise<BufferedReplayEvent[]> {
  if (redis) {
    try {
      const raw = await redis.lrange<string[]>(BUFFER_KEY(slug), 0, -1);
      const out: BufferedReplayEvent[] = [];
      for (const item of raw ?? []) {
        try {
          const parsed = typeof item === "string" ? JSON.parse(item) : item;
          if (parsed && typeof parsed === "object") out.push(parsed as BufferedReplayEvent);
        } catch {
          // skip corrupt entries
        }
      }
      return out;
    } catch {
      // fall through to memory
    }
  }
  return [...(memBuffer.get(slug) ?? [])];
}

/** Remove buffered events for one chat message (delete-your-message). */
export async function removeBufferedByMessage(
  slug: string,
  messageId: string
): Promise<void> {
  const drop = (list: BufferedReplayEvent[]) =>
    list.filter((e) => e.messageId !== messageId);
  if (redis) {
    try {
      const all = await peekReplayEvents(slug);
      const kept = drop(all);
      if (kept.length !== all.length) {
        await redis.del(BUFFER_KEY(slug));
        if (kept.length > 0) {
          await redis.rpush(
            BUFFER_KEY(slug),
            ...kept.map((e) => JSON.stringify(e))
          );
          await redis.expire(BUFFER_KEY(slug), BUFFER_TTL);
        }
      }
      return;
    } catch (err) {
      console.warn("Redis removeBufferedByMessage failed, using memory:", err);
    }
  }
  memBuffer.set(slug, drop(memBuffer.get(slug) ?? []));
}

export async function clearReplayBuffer(slug: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(BUFFER_KEY(slug));
    } catch {
      // ignore
    }
  }
  memBuffer.delete(slug);
}

// ---- Replay-row fallback (used when Neon is unreachable) ----

export async function setReplayRowFallback(id: string, row: unknown): Promise<void> {
  if (redis) {
    try {
      await redis.set(REPLAY_ROW_KEY(id), JSON.stringify(row), { ex: ROW_TTL });
      return;
    } catch (err) {
      console.warn("Redis setReplayRowFallback failed, using memory:", err);
    }
  }
  memRows.set(id, row);
}

export async function getReplayRowFallback(id: string): Promise<unknown | null> {
  if (redis) {
    try {
      const raw = await redis.get<string | object>(REPLAY_ROW_KEY(id));
      if (!raw) return null;
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      // fall through to memory
    }
  }
  return memRows.get(id) ?? null;
}
