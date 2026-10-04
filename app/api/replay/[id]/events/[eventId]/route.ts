import { NextRequest, NextResponse } from "next/server";
import {
  getReplayRow,
  listReplayEvents,
  deleteReplayEvent,
} from "@/lib/replay/store";
import { canViewReplay } from "@/lib/replay/access";
import { resolveActorId, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ id: string; eventId: string }> };

/**
 * DELETE /api/replay/[id]/events/[eventId]?actorId=
 * Members delete their own moments; the host may delete any moment.
 */
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { id, eventId } = await params;
    const replay = await getReplayRow(id);
    if (!replay) {
      return NextResponse.json({ error: "Replay not found." }, { status: 404 });
    }
    const { actorId } = await resolveActorId(
      req,
      Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>
    );
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canViewReplay(replay, actorId))) {
      return NextResponse.json({ error: "This replay is private." }, { status: 403 });
    }

    const events = await listReplayEvents(id, 2000);
    const target = events.find((e) => e.id === eventId);
    if (!target) return NextResponse.json({ error: "Moment not found." }, { status: 404 });
    if (target.userId !== actorId && actorId !== replay.hostId) {
      return NextResponse.json(
        { error: "You can only delete your own moments." },
        { status: 403 }
      );
    }
    await deleteReplayEvent(id, eventId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
