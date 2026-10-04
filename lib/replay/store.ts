import { db } from "@/db/drizzle";
import { partyReplays, partyEvents } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import {
  peekReplayEvents,
  clearReplayBuffer,
  setReplayRowFallback,
  getReplayRowFallback,
  type BufferedReplayEvent,
} from "@/lib/redis/replay";
import { redis } from "@/lib/redis/client";

/**
 * Neon persistence for Party Replay with graceful fallbacks (mirrors
 * lib/rooms/store.ts: DB first, Redis/memory when unreachable — a replay
 * is never lost to a DB blip).
 */

export interface ReplayRow {
  id: string;
  roomSlug: string;
  title: string;
  videoType: string;
  videoSource: string | null;
  fileFingerprint: unknown;
  durationSec: number;
  viewerCount: number;
  visibility: string;
  buckets: number[];
  peaks: { t: number; count: number; label: string }[];
  highlights: Record<string, unknown>;
  topEmoji: string | null;
  hostId: string;
  hostName: string | null;
  endedAt: string;
  createdAt: string;
}

const FALLBACK_EVENTS_KEY = (id: string) => `replay:events:${id}`;
const FALLBACK_TTL = 60 * 60 * 24 * 30;

const memEvents = new Map<string, BufferedReplayEvent[]>();

function toRow(r: typeof partyReplays.$inferSelect): ReplayRow {
  return {
    id: r.id,
    roomSlug: r.roomSlug,
    title: r.title,
    videoType: r.videoType,
    videoSource: r.videoSource,
    fileFingerprint: r.fileFingerprint,
    durationSec: r.durationSec,
    viewerCount: r.viewerCount,
    visibility: r.visibility,
    buckets: Array.isArray(r.buckets) ? (r.buckets as number[]) : [],
    peaks: Array.isArray(r.peaks) ? (r.peaks as ReplayRow["peaks"]) : [],
    highlights:
      r.highlights && typeof r.highlights === "object"
        ? (r.highlights as Record<string, unknown>)
        : {},
    topEmoji: r.topEmoji,
    hostId: r.hostId,
    hostName: r.hostName,
    endedAt: r.endedAt instanceof Date ? r.endedAt.toISOString() : String(r.endedAt),
    createdAt:
      r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

/** Flush up to 200 buffered events to Neon in ONE round trip. */
export async function flushReplayBuffer(slug: string): Promise<number> {
  const { acquireFlushLock, releaseFlushLock, popReplayEvents } = await import(
    "@/lib/redis/replay"
  );
  if (!(await acquireFlushLock(slug))) return 0;
  try {
    return await flushReplayBufferLocked(slug, popReplayEvents);
  } finally {
    await releaseFlushLock(slug);
  }
}

async function flushReplayBufferLocked(
  slug: string,
  pop: (slug: string, count: number) => Promise<import("@/lib/redis/replay").BufferedReplayEvent[]>
): Promise<number> {
  const batch = await pop(slug, 200);
  if (batch.length === 0) return 0;
  if (!process.env.DATABASE_URL) return 0;
  try {
    await db.insert(partyEvents).values(
      batch.map((e) => ({
        roomSlug: slug,
        userId: e.userId,
        userName: e.userName ?? null,
        type: e.type,
        videoTime: e.videoTime,
        payload: { ...(e.payload ?? {}), ...(e.messageId ? { messageId: e.messageId } : {}) },
        createdAt: new Date(e.ts),
      }))
    );
    return batch.length;
  } catch (err) {
    console.warn(
      "flushReplayBuffer failed, keeping events buffered:",
      err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : err
    );
    // Put them back at the front so finalize still sees them.
    try {
      const { pushReplayEvent } = await import("@/lib/redis/replay");
      for (let i = batch.length - 1; i >= 0; i--) {
        await pushReplayEvent(slug, batch[i]);
      }
    } catch {
      // ignore — finalize reads the buffer directly as a last resort
    }
    return 0;
  }
}

export async function saveReplayRow(row: ReplayRow): Promise<{ persisted: boolean }> {
  if (process.env.DATABASE_URL) {
    try {
      await db.insert(partyReplays).values({
        id: row.id,
        roomSlug: row.roomSlug,
        title: row.title,
        videoType: row.videoType as "youtube" | "hls" | "mp4" | "localfile",
        videoSource: row.videoSource,
        fileFingerprint: row.fileFingerprint,
        durationSec: row.durationSec,
        viewerCount: row.viewerCount,
        visibility: row.visibility as "public" | "circle" | "private",
        buckets: row.buckets,
        peaks: row.peaks,
        highlights: row.highlights,
        topEmoji: row.topEmoji,
        hostId: row.hostId,
        hostName: row.hostName,
      });
      return { persisted: true };
    } catch (err) {
      console.warn("saveReplayRow failed, using fallback store:", err);
    }
  }
  await setReplayRowFallback(row.id, row);
  return { persisted: false };
}

export async function getReplayRow(id: string): Promise<ReplayRow | null> {
  if (process.env.DATABASE_URL) {
    try {
      const rows = await db
        .select()
        .from(partyReplays)
        .where(eq(partyReplays.id, id))
        .limit(1);
      if (rows.length > 0) return toRow(rows[0]);
    } catch (err) {
      console.warn("getReplayRow failed, trying fallback store:", err);
    }
  }
  const fb = await getReplayRowFallback(id);
  return (fb as ReplayRow | null) ?? null;
}

/** Stamp buffered (and flushed) events with the replay id at finalize. */
export async function attributeEventsToReplay(
  slug: string,
  replayId: string
): Promise<BufferedReplayEvent[]> {
  // Remaining buffer first (flush already moved the rest to Neon).
  const buffered = await peekReplayEvents(slug);
  await clearReplayBuffer(slug);
  if (process.env.DATABASE_URL) {
    try {
      const { sql } = await import("drizzle-orm");
      await db
        .update(partyEvents)
        .set({ replayId })
        .where(
          sql`${partyEvents.replayId} IS NULL AND ${partyEvents.roomSlug} = ${slug}`
        );
    } catch (err) {
      console.warn("attributeEventsToReplay failed:", err);
    }
  }
  return buffered.map((e) => ({ ...e, replayId } as BufferedReplayEvent));
}

export async function saveReplayEventsFallback(
  replayId: string,
  events: BufferedReplayEvent[]
): Promise<void> {
  if (redis) {
    try {
      const key = FALLBACK_EVENTS_KEY(replayId);
      if (events.length > 0) {
        await redis.rpush(key, ...events.map((e) => JSON.stringify(e)));
      }
      await redis.expire(key, FALLBACK_TTL);
      return;
    } catch (err) {
      console.warn("saveReplayEventsFallback failed, using memory:", err);
    }
  }
  memEvents.set(replayId, events);
}

/** Time-ordered replay events (heaviest fields stripped for overlay sync). */
export async function listReplayEvents(
  replayId: string,
  limit = 2000
): Promise<BufferedReplayEvent[]> {
  if (process.env.DATABASE_URL) {
    try {
      const rows = await db
        .select()
        .from(partyEvents)
        .where(eq(partyEvents.replayId, replayId))
        .orderBy(asc(partyEvents.videoTime))
        .limit(limit);
      if (rows.length > 0) {
        return rows.map((r) => {
          const p = (r.payload ?? {}) as Record<string, unknown>;
          const { waveform, ...rest } = p;
          void waveform;
          return {
            id: r.id,
            userId: r.userId,
            userName: r.userName ?? undefined,
            type: r.type as BufferedReplayEvent["type"],
            videoTime: r.videoTime,
            payload: rest,
            ts: r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now(),
            messageId: typeof p.messageId === "string" ? p.messageId : undefined,
          };
        });
      }
    } catch (err) {
      console.warn("listReplayEvents failed, trying fallback store:", err);
    }
  }
  if (redis) {
    try {
      const raw = await redis.lrange<string[]>(FALLBACK_EVENTS_KEY(replayId), 0, limit - 1);
      const out: BufferedReplayEvent[] = [];
      for (const item of raw ?? []) {
        try {
          const parsed = typeof item === "string" ? JSON.parse(item) : item;
          if (parsed && typeof parsed === "object") {
            const p = ((parsed as BufferedReplayEvent).payload ?? {}) as Record<string, unknown>;
            const { waveform, ...rest } = p;
            void waveform;
            out.push({ ...(parsed as BufferedReplayEvent), payload: rest });
          }
        } catch {
          // skip corrupt entries
        }
      }
      if (out.length > 0) return out.sort((a, b) => a.videoTime - b.videoTime);
    } catch {
      // fall through to memory
    }
  }
  return (memEvents.get(replayId) ?? [])
    .slice(0, limit)
    .sort((a, b) => a.videoTime - b.videoTime);
}

/** Delete one replay event (owner or host only — enforced by callers). */
export async function deleteReplayEvent(
  replayId: string,
  eventId: string
): Promise<BufferedReplayEvent | null> {
  let found: BufferedReplayEvent | null = null;
  if (process.env.DATABASE_URL) {
    try {
      const rows = await db
        .select()
        .from(partyEvents)
        .where(eq(partyEvents.id, eventId))
        .limit(1);
      if (rows.length > 0 && rows[0].replayId === replayId) {
        const r = rows[0];
        found = {
          id: r.id,
          userId: r.userId,
          userName: r.userName ?? undefined,
          type: r.type as BufferedReplayEvent["type"],
          videoTime: r.videoTime,
          payload: (r.payload ?? {}) as Record<string, unknown>,
          ts: r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now(),
        };
        await db.delete(partyEvents).where(eq(partyEvents.id, eventId));
        return found;
      }
    } catch (err) {
      console.warn("deleteReplayEvent failed:", err);
    }
  }
  const list = memEvents.get(replayId) ?? [];
  const idx = list.findIndex((e) => e.id === eventId);
  if (idx >= 0) {
    found = list[idx];
    list.splice(idx, 1);
    memEvents.set(replayId, list);
  }
  return found;
}
