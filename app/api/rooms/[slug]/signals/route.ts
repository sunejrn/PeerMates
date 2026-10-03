import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { drainSignals, pushSignal, type SignalKind } from "@/lib/redis/signals";
import {
  addP2PReceiver,
  removeP2PReceiver,
  isP2PSharing,
} from "@/lib/redis/localfile";
import { isKicked } from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { P2P_MAX_RECEIVERS } from "@/lib/video/localfile";
import { resolveActorId, forbidden, rateLimited } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

const KINDS: SignalKind[] = [
  "p2p-join",
  "p2p-offer",
  "p2p-answer",
  "p2p-ice",
  "p2p-leave",
  "p2p-full",
  "p2p-decline",
];

/** SDP/ICE envelopes stay small — reject anything abusive. */
const MAX_PAYLOAD_BYTES = 32 * 1024;

/**
 * GET /api/rooms/[slug]/signals?for=<userId>
 * Drains the caller's signaling mailbox (viewer/host P2P setup only).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const forUser = req.nextUrl.searchParams.get("for") ?? "";
    if (!forUser) {
      return NextResponse.json({ error: "for=<userId> is required" }, { status: 400 });
    }
    if (await isKicked(slug, forUser)) {
      return NextResponse.json(
        { error: "KICKED", message: "You were removed from this room." },
        { status: 403 }
      );
    }
    const signals = await drainSignals(slug, forUser);
    return NextResponse.json({ signals });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rooms/[slug]/signals { to, kind, payload, fromName? }
 * Relays one signaling envelope. p2p-join additionally enforces the
 * receiver cap server-side (max 8); the 9th viewer gets 403 ROOM_FULL.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (await isKicked(slug, actorId)) {
      return forbidden("You were removed from this room.");
    }

    const rl = await checkRateLimit(
      `sig:${slug}:${actorId}`,
      RATE_LIMITS.signaling.limit,
      RATE_LIMITS.signaling.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const to = typeof body?.to === "string" ? body.to : "";
    const kind = body?.kind as SignalKind;
    if (!to || !KINDS.includes(kind)) {
      return NextResponse.json(
        { error: "to and a valid kind are required" },
        { status: 400 }
      );
    }
    const payloadSize = JSON.stringify(body?.payload ?? null).length;
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: "Signal payload too large." },
        { status: 413 }
      );
    }
    const fromName =
      typeof body?.fromName === "string"
        ? body.fromName.slice(0, 60)
        : undefined;

    if (kind === "p2p-join") {
      // Joins go to the current host only, and only while sharing.
      if (to !== room.hostId) {
        return NextResponse.json(
          { error: "P2P streams come from the host." },
          { status: 400 }
        );
      }
      if (!(await isP2PSharing(slug))) {
        return NextResponse.json(
          {
            error: "NOT_SHARING",
            message: "The host isn't sharing right now. Pick the matching local file instead.",
          },
          { status: 403 }
        );
      }
      const res = await addP2PReceiver(slug, actorId, P2P_MAX_RECEIVERS);
      if (res.full) {
        return NextResponse.json(
          {
            error: "ROOM_FULL",
            message: `The host stream is full (${res.count}/${P2P_MAX_RECEIVERS}). Use a matching local file or a link-based source instead.`,
            count: res.count,
            max: P2P_MAX_RECEIVERS,
          },
          { status: 403 }
        );
      }
    }

    if (kind === "p2p-leave") {
      await removeP2PReceiver(slug, actorId);
    }

    await pushSignal(slug, to, { from: actorId, fromName, kind, payload: body?.payload ?? null });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
