import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { setRoomState, getRoomState } from "@/lib/redis/roomState";
import { db } from "@/db/drizzle";
import { rooms } from "@/db/schema";
import { eq } from "drizzle-orm";

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

    // Update in-memory room
    room.hostId = newHostId;

    // Update in database if configured
    try {
      if (process.env.DATABASE_URL) {
        await db
          .update(rooms)
          .set({ hostId: newHostId, updatedAt: new Date() })
          .where(eq(rooms.slug, slug));
      }
    } catch (err) {
      console.warn("Could not update host in database:", err);
    }

    // Update live Redis room state
    const currentState = await getRoomState(slug);
    if (currentState) {
      currentState.hostId = newHostId;
      await setRoomState(slug, currentState);
    }

    return NextResponse.json({ success: true, newHostId });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
