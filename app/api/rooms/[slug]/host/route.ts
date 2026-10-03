import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug, transferRoomHost } from "@/lib/rooms/store";
import { getPresence } from "@/lib/redis/presence";
import { getRole, pickSuccessor } from "@/lib/redis/roles";
import { resolveActorId, forbidden, errMessage } from "@/lib/rooms/actor";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const { newHostId } = body;

    if (!newHostId) {
      return NextResponse.json(
        { error: "newHostId is required." },
        { status: 400 },
      );
    }

    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found." }, { status: 404 });
    }

    const { actorId } = await resolveActorId(req, body);
    if (!actorId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actorRole = await getRole(slug, actorId, room.hostId);

    // Case 1: the current host hands the crown to someone else.
    if (actorId === room.hostId || actorRole === "host") {
      const updated = await transferRoomHost(slug, String(newHostId));
      return NextResponse.json({ success: true, newHostId: updated?.hostId });
    }

    // Case 2: self-claim (host migration). Only allowed when the current
    // host is genuinely gone from presence, and only by the rightful
    // successor: a co-host first, else the longest-tenured viewer.
    if (String(newHostId) === actorId) {
      const present = await getPresence(slug);
      const hostStillPresent = present.some((m) => m.id === room.hostId);
      if (hostStillPresent) {
        return forbidden("The current host is still in the room.");
      }
      const successor = await pickSuccessor(slug, present, room.hostId);
      if (successor !== actorId) {
        return forbidden("You are not next in line for the host role.");
      }
      const updated = await transferRoomHost(slug, actorId);
      return NextResponse.json({ success: true, newHostId: updated?.hostId });
    }

    // Anyone else assigning hosts is forbidden (prevents host hijacking).
    return forbidden("Only the host can transfer the host role.");
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 },
    );
  }
}
