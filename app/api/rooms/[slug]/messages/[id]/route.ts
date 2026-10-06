import { NextRequest, NextResponse } from "next/server";
import { findMessage, markDeleted } from "@/lib/redis/chat";
import { markViewedOnce, unhideMessage } from "@/lib/redis/guard";
import { getRoomBySlug } from "@/lib/rooms/store";
import { getRole, isKicked } from "@/lib/redis/roles";
import { resolveActorId, forbidden, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string; id: string }> };

/**
 * DELETE /api/rooms/[slug]/messages/[id].
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

/**
 * PATCH /api/rooms/[slug]/messages/[id] { action, actorId }.
 * - { action: "viewed" }: any room member burns a view-once message they
 *   opened (author excluded — opening your own send never burns it).
 * - { action: "restore" }: host/co-host un-hides a Guard-collapsed message.
 *   Restores change no rules; they just un-hide that one message.
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug, id } = await params;
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
    const action = body?.action;
    if (action !== "viewed" && action !== "restore") {
      return NextResponse.json(
        { error: 'action must be "viewed" or "restore"' },
        { status: 400 }
      );
    }

    const msg = await findMessage(slug, id);
    if (!msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (action === "viewed") {
      if (msg.attachment?.viewOnce !== true) {
        return NextResponse.json({ error: "Not a view-once message." }, { status: 400 });
      }
      if (msg.user.id === actorId) {
        return NextResponse.json({ success: true, burned: false });
      }
      await markViewedOnce(slug, id);
      return NextResponse.json({ success: true, burned: true });
    }

    const role = await getRole(slug, actorId, room.hostId);
    if (role !== "host" && role !== "cohost") {
      return forbidden("Only hosts and co-hosts can restore hidden messages.");
    }
    await unhideMessage(slug, id);
    return NextResponse.json({ success: true, id });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
