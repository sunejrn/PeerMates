import { NextRequest, NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { getReplayRow, listReplayEvents } from "@/lib/replay/store";
import { canViewReplay } from "@/lib/replay/access";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import {
  resolveActorId,
  rateLimited,
  errMessage,
} from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/replay/[id]/events?actorId=
 * Time-ordered replay events for overlay sync (visibility-gated, capped).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const replay = await getReplayRow(id);
    if (!replay) {
      return NextResponse.json({ error: "Replay not found." }, { status: 404 });
    }
    const { actorId } = await resolveActorId(
      req,
      Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>
    );
    if (!(await canViewReplay(replay, actorId))) {
      return NextResponse.json({ error: "This replay is private." }, { status: 403 });
    }
    const events = await listReplayEvents(id, 2000);
    return NextResponse.json({ events });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/replay/[id]/events
 * Layered reactions: late friends react on top of the original party.
 * Reactions only (chat stays in live rooms). Body: { videoTime, emoji,
 * actorId, userName? }.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const replay = await getReplayRow(id);
    if (!replay) {
      return NextResponse.json({ error: "Replay not found." }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canViewReplay(replay, actorId))) {
      return NextResponse.json({ error: "This replay is private." }, { status: 403 });
    }

    const videoTime = Number(body?.videoTime);
    const emoji = typeof body?.emoji === "string" ? body.emoji : "";
    if (!Number.isFinite(videoTime) || videoTime < 0 || videoTime > 24 * 3600) {
      return NextResponse.json({ error: "videoTime is required (seconds)." }, { status: 400 });
    }
    if (!emoji || [...emoji].length > 4) {
      return NextResponse.json({ error: "emoji is required." }, { status: 400 });
    }

    const rl = await checkRateLimit(
      `replay:${id}:${actorId}`,
      RATE_LIMITS.replayEvent.limit,
      RATE_LIMITS.replayEvent.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const event = {
      id: nanoid(12),
      userId: actorId,
      userName:
        typeof body?.userName === "string" ? body.userName.slice(0, 24) : undefined,
      type: "reaction" as const,
      videoTime,
      payload: { emoji },
      ts: Date.now(),
    };

    if (process.env.DATABASE_URL) {
      try {
        const { db } = await import("@/db/drizzle");
        const { partyEvents } = await import("@/db/schema");
        await db.insert(partyEvents).values({
          roomSlug: replay.roomSlug,
          replayId: id,
          userId: event.userId,
          userName: event.userName ?? null,
          type: "reaction",
          videoTime: event.videoTime,
          payload: event.payload,
        });
        return NextResponse.json({ success: true, event });
      } catch (err) {
        console.warn("layered reaction DB insert failed, using fallback:", err);
      }
    }
    const { saveReplayEventsFallback } = await import("@/lib/replay/store");
    const existing = await listReplayEvents(id, 2000);
    await saveReplayEventsFallback(id, [...existing, event]);
    return NextResponse.json({ success: true, event });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
