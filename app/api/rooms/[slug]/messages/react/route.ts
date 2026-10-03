import { NextRequest, NextResponse } from "next/server";
import { findMessage, toggleReaction } from "@/lib/redis/chat";
import { getRoomBySlug } from "@/lib/rooms/store";
import { isKicked } from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";
import { isAllowedReaction } from "@/lib/chat/moderate";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * POST /api/rooms/[slug]/messages/react { id, emoji }
 * Toggle one emoji reaction (allowlisted) for the caller. Rate-limited;
 * kicked users are rejected. All clients converge via message polling.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    // NOTE: resolve with an explicit actor field only — the message `id`
    // in this body must never be mistaken for the actor.
    const { actorId } = await resolveActorId(req, {
      actorId:
        typeof body?.actorId === "string" ? (body.actorId as string) : undefined,
    });
    if (!actorId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (await isKicked(slug, actorId)) {
      return forbidden("You were removed from this room.");
    }

    const id = typeof body?.id === "string" ? body.id : "";
    const emoji = typeof body?.emoji === "string" ? body.emoji : "";
    if (!id || !isAllowedReaction(emoji)) {
      return NextResponse.json(
        { error: "id and an allowed emoji are required" },
        { status: 400 }
      );
    }

    const rl = await checkRateLimit(
      `react:${slug}:${actorId}`,
      RATE_LIMITS.reaction.limit,
      RATE_LIMITS.reaction.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const msg = await findMessage(slug, id);
    if (!msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    const reactions = await toggleReaction(slug, id, emoji, actorId);
    return NextResponse.json({ success: true, id, reactions });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
