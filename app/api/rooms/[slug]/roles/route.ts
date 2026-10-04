import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import {
  getAllRoles,
  getMutedUserIds,
  getRole,
  getSettings,
  getControlRequests,
  isMutedChat,
  setRole,
  removeControlRequest,
  type RoomRole,
} from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { mirrorMemberRole, broadcastRoomEvent } from "@/lib/stream/server";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/[slug]/roles
 * Returns the role map + room settings. Control-request queue is only
 * included for privileged callers (host/co-host).
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
    const [roles, settings] = await Promise.all([
      getAllRoles(slug),
      getSettings(slug),
    ]);
    const myRole: RoomRole = me
      ? roles[me] ?? (me === room.hostId ? "host" : "viewer")
      : "viewer";
    const privileged = myRole === "host" || myRole === "cohost";
    const requests = await getControlRequests(slug);
    const amMuted = me ? await isMutedChat(slug, me) : false;
    const mutedIds = privileged ? await getMutedUserIds(slug) : [];
    return NextResponse.json({
      roles,
      settings,
      requests: privileged ? requests : [],
      myRequestPending: me
        ? requests.some((r) => r.userId === me)
        : false,
      mutedIds,
      amMuted,
      hostId: room.hostId,
      myRole,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/rooms/[slug]/roles  { action: "promote" | "demote", targetUserId }
 * HOST ONLY (server-enforced). Promote viewer -> co-host, demote co-host
 * -> viewer. Host transfer lives in /host. Mirrors to Stream membership.
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

    const rl = await checkRateLimit(
      `role:${slug}:${actorId}`,
      RATE_LIMITS.roleChange.limit,
      RATE_LIMITS.roleChange.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const actorRole = await getRole(slug, actorId, room.hostId);
    if (actorRole !== "host") {
      return forbidden("Only the host can change roles.");
    }

    const { action, targetUserId } = body ?? {};
    const target = typeof targetUserId === "string" ? targetUserId : "";
    if (!target) {
      return NextResponse.json(
        { error: "targetUserId is required" },
        { status: 400 }
      );
    }
    if (target === room.hostId || target === actorId) {
      return NextResponse.json(
        { error: "The host role is transferred via /host, not here." },
        { status: 400 }
      );
    }

    let nextRole: RoomRole;
    if (action === "promote") nextRole = "cohost";
    else if (action === "demote") nextRole = "viewer";
    else {
      return NextResponse.json(
        { error: 'action must be "promote" or "demote"' },
        { status: 400 }
      );
    }

    await setRole(slug, target, nextRole);
    await removeControlRequest(slug, target);
    await mirrorMemberRole(slug, target, nextRole);
    await broadcastRoomEvent(slug, {
      type: "room_roles_changed",
      userId: target,
      role: nextRole,
    });

    return NextResponse.json({ success: true, userId: target, role: nextRole });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
