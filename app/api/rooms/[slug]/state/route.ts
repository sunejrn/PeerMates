import { NextRequest, NextResponse } from "next/server";
import { getRoomState } from "@/lib/redis/roomState";
import { getRoomBySlug } from "@/lib/rooms/store";

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
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
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
    const body = await req.json();
    const { currentTime, isPlaying, playbackRate, serverTimestamp, hostId } =
      body;

    const { setRoomState } = await import("@/lib/redis/roomState");
    await setRoomState(slug, {
      currentTime: typeof currentTime === "number" ? currentTime : 0,
      isPlaying: Boolean(isPlaying),
      playbackRate: typeof playbackRate === "number" ? playbackRate : 1,
      serverTimestamp: serverTimestamp || Date.now(),
      hostId: hostId || "",
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
