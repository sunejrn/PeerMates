import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getRoomBySlug } from "@/lib/rooms/store";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { getMutedUserIds } from "@/lib/redis/roles";
import { getPresence } from "@/lib/redis/presence";
import { peekReplayEvents, clearReplayBuffer } from "@/lib/redis/replay";
import {
  flushReplayBuffer,
  saveReplayRow,
  saveReplayEventsFallback,
  attributeEventsToReplay,
  type ReplayRow,
} from "@/lib/replay/store";
import {
  buildBuckets,
  detectPeaks,
  computeHighlights,
  topEmojiOf,
} from "@/lib/replay/highlights";
import { getRoomFingerprint } from "@/lib/redis/localfile";
import { isLocalFileSource } from "@/lib/video/detector";
import {
  resolveActorId,
  forbidden,
  rateLimited,
  errMessage,
} from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

const VISIBILITIES = new Set(["public", "circle", "private", "discard"]);

/**
 * POST /api/rooms/[slug]/finalize
 * HOST ONLY (strict — co-hosts get 403): ends the party and builds the
 * replay. Body: { visibility: public|circle|private|discard, durationSec?,
 * actorId }. Flushes remaining buffered events in batches, filters muted
 * users, computes the 10s heatmap + highlights, and persists one replay row.
 * "discard" wipes the buffer (and unattributed rows) without saving.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (actorId !== room.hostId) {
      return forbidden("Only the host can end the party and save the replay.");
    }

    const rl = await checkRateLimit(
      `mod:${slug}:${actorId}`,
      RATE_LIMITS.moderation.limit,
      RATE_LIMITS.moderation.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const visibility = typeof body?.visibility === "string" ? body.visibility : "";
    if (!VISIBILITIES.has(visibility)) {
      return NextResponse.json(
        { error: "visibility must be public|circle|private|discard" },
        { status: 400 }
      );
    }

    if (visibility === "discard") {
      await clearReplayBuffer(slug);
      if (process.env.DATABASE_URL) {
        try {
          const { db } = await import("@/db/drizzle");
          const { partyEvents } = await import("@/db/schema");
          const { sql } = await import("drizzle-orm");
          await db
            .delete(partyEvents)
            .where(
              sql`${partyEvents.replayId} IS NULL AND ${partyEvents.roomSlug} = ${slug}`
            );
        } catch {
          // buffer clear already covers the common path
        }
      }
      return NextResponse.json({ success: true, discarded: true });
    }

    // Drain the buffer to Neon in batches (bounded loop for huge parties).
    for (let i = 0; i < 25; i++) {
      const n = await flushReplayBuffer(slug);
      if (n === 0) break;
    }

    // Gather everything: flushed DB rows + whatever is still buffered.
    let dbEvents: {
      id: string;
      userId: string;
      userName: string | null;
      type: string;
      videoTime: number;
      payload: unknown;
      ts: number;
    }[] = [];
    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import("@/db/drizzle");
        const { partyEvents } = await import("@/db/schema");
        const { sql } = await import("drizzle-orm");
        const rows = await db
          .select()
          .from(partyEvents)
          .where(
            sql`${partyEvents.replayId} IS NULL AND ${partyEvents.roomSlug} = ${slug}`
          );
        dbEvents = rows.map((r) => ({
          id: r.id,
          userId: r.userId,
          userName: r.userName,
          type: r.type,
          videoTime: r.videoTime,
          payload: r.payload,
          ts: r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now(),
        }));
      } catch (err) {
        console.warn("finalize: DB read failed, using buffer only:", err);
      }
    }
    const buffered = await peekReplayEvents(slug);

    // Respect mute history: muted users leave no replay trace.
    let muted: string[] = [];
    try {
      muted = await getMutedUserIds(slug);
    } catch {
      // best-effort
    }
    const mutedSet = new Set(muted);
    const events = [
      ...dbEvents.map((e) => ({
        id: e.id,
        userId: e.userId,
        userName: e.userName ?? undefined,
        type: e.type as "reaction" | "message" | "voice" | "pin",
        videoTime: e.videoTime,
        payload: (e.payload ?? {}) as Record<string, unknown>,
        ts: e.ts,
      })),
      ...buffered,
    ].filter((e) => !mutedSet.has(e.userId));

    const claimed = Number(body?.durationSec);
    const maxEvent = events.reduce((m, e) => Math.max(m, e.videoTime || 0), 0);
    const durationSec = Math.min(
      12 * 3600,
      Math.max(0, Number.isFinite(claimed) ? claimed : 0, maxEvent)
    );

    const buckets = buildBuckets(events, durationSec);
    const peaks = detectPeaks(buckets);
    const highlights = computeHighlights(events, peaks);

    let viewerCount = 0;
    try {
      viewerCount = (await getPresence(slug)).length;
    } catch {
      // fall back below
    }
    if (viewerCount === 0) {
      viewerCount = new Set(events.map((e) => e.userId)).size;
    }

    // Local-file rooms: snapshot the host fingerprint so replay viewers can
    // verify their own copy. Remote URLs replay directly. Video bytes are
    // never stored.
    const isLocal = room.videoType === "localfile" || isLocalFileSource(room.videoSource);
    let fileFingerprint: unknown = null;
    if (isLocal) {
      try {
        fileFingerprint = await getRoomFingerprint(slug);
      } catch {
        // replay still works; verification just skips
      }
    }

    const replayId = nanoid(10);
    const row: ReplayRow = {
      id: replayId,
      roomSlug: slug,
      title: room.title || "PeerMates Party",
      videoType: room.videoType,
      videoSource: isLocal ? null : room.videoSource,
      fileFingerprint,
      durationSec,
      viewerCount,
      visibility,
      buckets,
      peaks,
      highlights: highlights as unknown as Record<string, unknown>,
      topEmoji: topEmojiOf(events),
      hostId: room.hostId,
      hostName: room.hostName ?? null,
      endedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const { persisted } = await saveReplayRow(row);
    await attributeEventsToReplay(slug, replayId);
    if (!persisted) {
      await saveReplayEventsFallback(replayId, events);
    }

    return NextResponse.json({
      success: true,
      replayId,
      visibility,
      persisted,
      row,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
