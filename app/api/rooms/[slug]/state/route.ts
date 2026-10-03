import { NextRequest, NextResponse } from "next/server";
import { getRoomState, setRoomState } from "@/lib/redis/roomState";
import { getRoomBySlug } from "@/lib/rooms/store";
import { canControl, isKicked } from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const state = await getRoomState(slug);

    return NextResponse.json({
      state: state || {
        currentTime: 0,
        isPlaying: false,
        playbackRate: 1,
        serverTimestamp: Date.now(),
        hostId: room.hostId,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    const body = await req.json();
    const { currentTime, isPlaying, playbackRate, serverTimestamp, hostId } =
      body;

    // Identify the emitter: authenticated session wins, body id is fallback.
    const { actorId } = await resolveActorId(req, { ...body, hostId });
    if (!actorId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Kicked users lose all write access.
    if (await isKicked(slug, actorId)) {
      return forbidden("You were removed from this room.");
    }

    // SERVER-SIDE ROLE CHECK: only host + co-hosts may emit playback
    // state. Viewers never send control events — UI gating alone is not
    // trusted.
    if (!(await canControl(slug, actorId, room.hostId))) {
      return forbidden("Only hosts and co-hosts can control playback.");
    }

    const rl = await checkRateLimit(
      `state:${slug}:${actorId}`,
      RATE_LIMITS.stateWrite.limit,
      RATE_LIMITS.stateWrite.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    await setRoomState(slug, {
      currentTime: typeof currentTime === "number" ? currentTime : 0,
      isPlaying: Boolean(isPlaying),
      playbackRate: typeof playbackRate === "number" ? playbackRate : 1,
      serverTimestamp: serverTimestamp || Date.now(),
      hostId: room.hostId,
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
