import { NextRequest, NextResponse } from "next/server";
import { getReplayRow } from "@/lib/replay/store";
import { canViewReplay } from "@/lib/replay/access";
import { getRoomBySlug } from "@/lib/rooms/store";
import { resolveActorId, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/replay/[id]?actorId=
 * Replay metadata (heatmap, peaks, highlights) gated by visibility.
 * Includes a live-room join CTA when the original room still exists.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const replay = await getReplayRow(id);
    if (!replay) {
      return NextResponse.json({ error: "Replay not found." }, { status: 404 });
    }
    const { actorId } = await resolveActorId(
      req,
      Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>
    );
    if (!(await canViewReplay(replay, actorId))) {
      return NextResponse.json({ error: "This replay is private." }, { status: 403 });
    }

    let liveRoom: string | null = null;
    try {
      const room = await getRoomBySlug(replay.roomSlug);
      if (room) liveRoom = room.slug;
    } catch {
      // no live room — replay still plays
    }

    return NextResponse.json({ replay, liveRoom });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
