import { NextRequest, NextResponse } from "next/server";
import {
  getPresence,
  heartbeatPresence,
  removePresence,
} from "@/lib/redis/presence";
import { getRoomBySlug } from "@/lib/rooms/store";

type RouteParams = { params: Promise<{ slug: string }> };

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
    const members = await getPresence(slug);
    return NextResponse.json({ members, hostId: room.hostId });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
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
    const { id, name, image, joinedAt } = body ?? {};
    if (!id || !name) {
      return NextResponse.json(
        { error: "id and name are required" },
        { status: 400 }
      );
    }
    const member = {
      id: String(id),
      name: String(name),
      image: image ? String(image) : undefined,
      role: (room.hostId === id ? "host" : "viewer") as "host" | "viewer",
      joinedAt: typeof joinedAt === "number" ? joinedAt : Date.now(),
    };
    await heartbeatPresence(slug, member);
    const members = await getPresence(slug);
    return NextResponse.json({ success: true, members });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// DELETE /api/rooms/[slug]/presence -> leave
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId;
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    await removePresence(slug, String(userId));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
