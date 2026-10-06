import { NextRequest, NextResponse } from "next/server";
import { findMessage } from "@/lib/redis/chat";
import {
  getGuardSettings,
  getHiddenMap,
  setGuardSettings,
  type GuardSensitivity,
} from "@/lib/redis/guard";
import { getRoomBySlug } from "@/lib/rooms/store";
import { getRole, isKicked } from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/[slug]/guard?actorId=
 * HOST + CO-HOST ONLY. Returns guard settings, auto slow-mode state, and
 * the Guard log (hidden messages with sender + reason, newest first).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const actorId = req.nextUrl.searchParams.get("actorId") || "";
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (await isKicked(slug, actorId)) {
      return forbidden("You were removed from this room.");
    }
    const role = await getRole(slug, actorId, room.hostId);
    if (role !== "host" && role !== "cohost") {
      return forbidden("Only hosts and co-hosts can view the Guard log.");
    }

    const [settings, hidden] = await Promise.all([
      getGuardSettings(slug),
      getHiddenMap(slug),
    ]);
    const entries: {
      id: string;
      text: string;
      senderId: string;
      senderName: string;
      reason: string;
      createdAt: string;
    }[] = [];
    for (const [id, reason] of Object.entries(hidden).slice(-50)) {
      const msg = await findMessage(slug, id);
      if (!msg || msg.deleted) continue;
      entries.push({
        id,
        text: msg.text.slice(0, 140),
        senderId: msg.user.id,
        senderName: msg.user.name,
        reason,
        createdAt: msg.createdAt,
      });
    }
    entries.reverse();
    return NextResponse.json({
      settings: {
        enabled: settings.enabled,
        sensitivity: settings.sensitivity,
        autoSlowActive: settings.autoSlowUntil > Date.now(),
      },
      log: entries,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/rooms/[slug]/guard { action: "settings", enabled?, sensitivity?, actorId }
 * HOST + CO-HOST ONLY, rate-limited. Toggles the Guard or its sensitivity.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (await isKicked(slug, actorId)) {
      return forbidden("You were removed from this room.");
    }
    const role = await getRole(slug, actorId, room.hostId);
    if (role !== "host" && role !== "cohost") {
      return forbidden("Only hosts and co-hosts can change Guard settings.");
    }

    const rl = await checkRateLimit(
      `guard:${slug}:${actorId}`,
      RATE_LIMITS.moderation.limit,
      RATE_LIMITS.moderation.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    if (body?.action !== "settings") {
      return NextResponse.json(
        { error: 'action must be "settings"' },
        { status: 400 }
      );
    }
    const patch: { enabled?: boolean; sensitivity?: GuardSensitivity } = {};
    if (typeof body?.enabled === "boolean") patch.enabled = body.enabled;
    if (
      body?.sensitivity === "low" ||
      body?.sensitivity === "medium" ||
      body?.sensitivity === "high"
    ) {
      patch.sensitivity = body.sensitivity;
    }
    const settings = await setGuardSettings(slug, patch);
    return NextResponse.json({
      success: true,
      settings: { enabled: settings.enabled, sensitivity: settings.sensitivity },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
