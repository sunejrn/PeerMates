import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getRoomBySlug } from "@/lib/rooms/store";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { isKicked, isMutedChat } from "@/lib/redis/roles";
import {
  pushReplayEvent,
  removeBufferedByMessage,
  type BufferedReplayEvent,
} from "@/lib/redis/replay";
import { flushReplayBuffer } from "@/lib/replay/store";
import {
  resolveActorId,
  rateLimited,
  errMessage,
} from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

const TYPES = new Set(["reaction", "message", "voice", "pin"]);
const MAX_PAYLOAD_BYTES = 4096;
const FLUSH_EVERY = 50;

/**
 * POST /api/rooms/[slug]/events
 * Best-effort Party Replay capture: every reaction, chat message, voice note
 * and pin, anchored to a video timestamp (seconds). Buffered in Redis and
 * flushed to Neon in batches — never per-event DB writes.
 *
 * Body: { type, videoTime, payload?, messageId?, ts?, actorId, userName? }
 * Body: { action: "delete", messageId, actorId } — removes a deleted chat
 * message from the replay buffer (members can delete their own moments).
 *
 * Skips muted/kicked users (respects mute history). Failures never break
 * chat — the client fires and forgets.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Delete-your-message propagation (chat delete already authorized this).
    if (body?.action === "delete" && typeof body?.messageId === "string") {
      await removeBufferedByMessage(slug, body.messageId);
      if (process.env.DATABASE_URL) {
        try {
          const { db } = await import("@/db/drizzle");
          const { partyEvents } = await import("@/db/schema");
          const { sql } = await import("drizzle-orm");
          await db
            .delete(partyEvents)
            .where(
              sql`${partyEvents.replayId} IS NULL AND ${partyEvents.roomSlug} = ${slug} AND ${partyEvents.payload}->>'messageId' = ${body.messageId}`
            );
        } catch {
          // buffer removal already covers the common path
        }
      }
      return NextResponse.json({ success: true });
    }

    const type = typeof body?.type === "string" ? body.type : "";
    if (!TYPES.has(type)) {
      return NextResponse.json({ error: "type must be reaction|message|voice|pin" }, { status: 400 });
    }
    const videoTime = Number(body?.videoTime);
    if (!Number.isFinite(videoTime) || videoTime < 0 || videoTime > 24 * 3600) {
      return NextResponse.json({ error: "videoTime is required (seconds)." }, { status: 400 });
    }
    const payload =
      body?.payload && typeof body.payload === "object"
        ? (body.payload as Record<string, unknown>)
        : {};
    if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "payload too large." }, { status: 400 });
    }

    const perUser = await checkRateLimit(
      `replay:${slug}:${actorId}`,
      RATE_LIMITS.replayEvent.limit,
      RATE_LIMITS.replayEvent.windowSeconds
    );
    if (!perUser.allowed) return rateLimited(perUser.retryAfter);
    const global = await checkRateLimit(
      `replay:room:${slug}`,
      RATE_LIMITS.replayGlobal.limit,
      RATE_LIMITS.replayGlobal.windowSeconds
    );
    if (!global.allowed) return rateLimited(global.retryAfter);

    // Respect mute + kick history: muted/kicked users leave no replay trace.
    try {
      if (await isKicked(slug, actorId)) {
        return NextResponse.json({ error: "Removed from room." }, { status: 403 });
      }
      if (await isMutedChat(slug, actorId)) return NextResponse.json({ success: true, skipped: true });
    } catch {
      // moderation checks are best-effort
    }

    const event: BufferedReplayEvent = {
      id: nanoid(12),
      userId: actorId,
      userName:
        typeof body?.userName === "string" ? body.userName.slice(0, 24) : undefined,
      type: type as BufferedReplayEvent["type"],
      videoTime,
      payload,
      ts: typeof body?.ts === "number" ? body.ts : Date.now(),
      messageId: typeof body?.messageId === "string" ? body.messageId : undefined,
    };
    const len = await pushReplayEvent(slug, event);

    // Batch flush: every 50 buffered events, one bulk Neon insert.
    if (len >= FLUSH_EVERY) {
      void flushReplayBuffer(slug).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
