import { NextRequest, NextResponse } from "next/server";
import {
  getPresence,
  heartbeatPresence,
  removePresence,
} from "@/lib/redis/presence";
import { getRoomBySlug, transferRoomHost } from "@/lib/rooms/store";
import {
  getRole,
  getAllRoles,
  isKicked,
  pickSuccessor,
  type RoomRole,
} from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

function withRoles<T extends { id: string }>(
  members: T[],
  roles: Record<string, RoomRole>,
  hostId: string
) {
  return members.map((m) => ({
    ...m,
    role: (roles[m.id] ?? (m.id === hostId ? "host" : "viewer")) as RoomRole,
  }));
}

// GET /api/rooms/[slug]/presence -> list of currently-online members
// This is the cross-device source of truth (Redis-backed). Stream watchers
// and BroadcastChannel only cover same-session / same-browser cases.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const [members, roles] = await Promise.all([
      getPresence(slug),
      getAllRoles(slug),
    ]);
    return NextResponse.json({
      members: withRoles(members, roles, room.hostId),
      hostId: room.hostId,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}

// POST /api/rooms/[slug]/presence -> heartbeat (join / keep-alive)
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const body = await req.json();
    const { id, name, image, joinedAt, fileMatch } = body ?? {};
    if (!id || !name) {
      return NextResponse.json(
        { error: "id and name are required" },
        { status: 400 }
      );
    }
    if (await isKicked(slug, String(id))) {
      return NextResponse.json(
        { error: "KICKED", message: "You were removed from this room." },
        { status: 403 }
      );
    }

    const rl = await checkRateLimit(
      `presence:${slug}:${id}`,
      RATE_LIMITS.presence.limit,
      RATE_LIMITS.presence.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    // The authoritative role comes from the Redis role store so a
    // promoted co-host keeps their badge across reconnects.
    const role = await getRole(slug, String(id), room.hostId);
    const member = {
      id: String(id),
      name: String(name),
      image: image ? String(image) : undefined,
      role,
      joinedAt: typeof joinedAt === "number" ? joinedAt : Date.now(),
      // Local-file match badge (boolean only; anything else => not picked).
      fileMatch: fileMatch === true ? true : fileMatch === false ? false : null,
    };
    await heartbeatPresence(slug, member);
    const [members, roles] = await Promise.all([
      getPresence(slug),
      getAllRoles(slug),
    ]);
    return NextResponse.json({
      success: true,
      members: withRoles(members, roles, room.hostId),
      myRole: role,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/rooms/[slug]/presence -> leave. If the host leaves, the crown
// passes to a co-host first, then the longest-tenured viewer.
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId;
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    await removePresence(slug, String(userId));

    const room = await getRoomBySlug(slug);
    if (room && String(userId) === room.hostId) {
      const remaining = await getPresence(slug);
      const successor = await pickSuccessor(slug, remaining, room.hostId);
      if (successor) {
        const updated = await transferRoomHost(slug, successor);
        return NextResponse.json({
          success: true,
          newHostId: updated?.hostId ?? successor,
        });
      }
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
