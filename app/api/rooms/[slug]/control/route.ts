import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import {
  addControlRequest,
  getControlRequests,
  getRole,
  removeControlRequest,
  setRole,
  isKicked,
} from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { mirrorMemberRole, broadcastRoomEvent } from "@/lib/stream/server";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/[slug]/control -> pending hand-raise queue.
 * Privileged callers only (host/co-host).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const viewerId = req.nextUrl.searchParams.get("viewerId") ?? "";
    const { actorId } = await resolveActorId(req);
    const me = actorId || viewerId;
    const role = await getRole(slug, me, room.hostId);
    if (role !== "host" && role !== "cohost") {
      return forbidden("Only hosts and co-hosts can view control requests.");
    }
    const requests = await getControlRequests(slug);
    return NextResponse.json({ requests });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rooms/[slug]/control
 * - { action: "request", name?, image? } — viewer hand-raise.
 * - { action: "approve", targetUserId } — host promotes requester to co-host.
 * - { action: "deny", targetUserId } — host/co-host dismisses the request.
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

    const { action } = body ?? {};
    const myRole = await getRole(slug, actorId, room.hostId);

    if (action === "request") {
      if (myRole !== "viewer") {
        return NextResponse.json(
          { error: "You already have control privileges." },
          { status: 400 }
        );
      }
      const rl = await checkRateLimit(
        `ctrlreq:${slug}:${actorId}`,
        RATE_LIMITS.controlRequest.limit,
        RATE_LIMITS.controlRequest.windowSeconds
      );
      if (!rl.allowed) return rateLimited(rl.retryAfter);

      const name =
        typeof body?.name === "string" && body.name.trim()
          ? body.name.trim().slice(0, 60)
          : "Viewer";
      const image =
        typeof body?.image === "string" ? body.image.slice(0, 500) : undefined;
      await addControlRequest(slug, {
        userId: actorId,
        name,
        image,
        requestedAt: Date.now(),
      });
      await broadcastRoomEvent(slug, {
        type: "room.control_requested",
        userId: actorId,
        name,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "approve" || action === "deny") {
      if (myRole !== "host") {
        return forbidden("Only the host can approve control requests.");
      }
      const target =
        typeof body?.targetUserId === "string" ? body.targetUserId : "";
      if (!target) {
        return NextResponse.json(
          { error: "targetUserId is required" },
          { status: 400 }
        );
      }
      await removeControlRequest(slug, target);
      if (action === "approve") {
        if (target === room.hostId) {
          return NextResponse.json(
            { error: "That user is already the host." },
            { status: 400 }
          );
        }
        await setRole(slug, target, "cohost");
        await mirrorMemberRole(slug, target, "cohost");
        await broadcastRoomEvent(slug, {
          type: "room.roles_changed",
          userId: target,
          role: "cohost",
        });
        return NextResponse.json({
          success: true,
          userId: target,
          role: "cohost",
        });
      }
      return NextResponse.json({ success: true, denied: target });
    }

    return NextResponse.json(
      { error: 'action must be "request", "approve", or "deny"' },
      { status: 400 }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
