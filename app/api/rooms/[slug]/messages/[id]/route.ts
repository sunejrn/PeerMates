import { NextRequest, NextResponse } from "next/server";
import { findMessage, markDeleted } from "@/lib/redis/chat";
import { getRoomBySlug } from "@/lib/rooms/store";
import { getRole, isKicked } from "@/lib/redis/roles";
import { resolveActorId, forbidden, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string; id: string }> };

/**
 * DELETE /api/rooms/[slug]/messages/[id]
 * Tombstone a message. Allowed for the author, or host/co-hosts
 * (moderation). The realtime copy is deleted best-effort by the deleter's
 * client; every client converges via the poll tombstone within seconds.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug, id } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    // DELETEs may carry a JSON body (fetch clients); ignore parse errors.
    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (await isKicked(slug, actorId)) {
      return forbidden("You were removed from this room.");
    }

    const msg = await findMessage(slug, id);
    if (!msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    const role = await getRole(slug, actorId, room.hostId);
    const privileged = role === "host" || role === "cohost";
    if (msg.user.id !== actorId && !privileged) {
      return forbidden("You can only delete your own messages.");
    }

    await markDeleted(slug, id);
    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
