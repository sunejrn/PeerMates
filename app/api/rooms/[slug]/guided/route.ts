import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { getRole } from "@/lib/redis/roles";
import {
  getGuidedState,
  startGuidedCountdown,
  stopGuidedCountdown,
} from "@/lib/redis/guided";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/[slug]/guided → { startedAt, version }.
 * Polled by GuidedEmbedPlayer (2s) — the shared countdown clock for
 * embed providers that can't be remote-controlled.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    return NextResponse.json(await getGuidedState(slug));
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/rooms/[slug]/guided { action: "start" | "stop", actorId }.
 * HOST + CO-HOST ONLY (server-enforced), rate-limited.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = await getRole(slug, actorId, room.hostId);
    if (role !== "host" && role !== "cohost") {
      return forbidden("Only hosts and co-hosts can run the countdown.");
    }
    const rl = await checkRateLimit(
      `guided:${slug}:${actorId}`,
      RATE_LIMITS.moderation.limit,
      RATE_LIMITS.moderation.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    if (body?.action === "stop") {
      return NextResponse.json({
        success: true,
        ...(await stopGuidedCountdown(slug)),
      });
    }
    if (body?.action === "start") {
      return NextResponse.json({
        success: true,
        ...(await startGuidedCountdown(slug)),
      });
    }
    return NextResponse.json(
      { error: 'action must be "start" or "stop"' },
      { status: 400 }
    );
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
