import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { auth } from "@/lib/auth";
import { db } from "@/db/drizzle";
import { roomParticipants, user } from "@/db/schema";
import { nanoid } from "nanoid";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Identify user
    let userId = "guest_" + nanoid(6);
    let userName = "Guest Viewer";
    let userImage: string | undefined;

    try {
      const session = await auth.api.getSession({
        headers: req.headers,
      });
      if (session?.user) {
        userId = session.user.id;
        userName = session.user.name;
        userImage = session.user.image || undefined;
      }
    } catch {
      // Continue as guest
    }

    const isHost = room.hostId === userId;
    const role = isHost ? "host" : "viewer";

    // Record participant in DB if available
    try {
      if (process.env.DATABASE_URL) {
        await db
          .insert(user)
          .values({
            id: userId,
            name: userName,
            email: `${userId}@watchtogether.local`,
            emailVerified: true,
            image: userImage || null,
          })
          .onConflictDoNothing();

        await db
          .insert(roomParticipants)
          .values({
            roomId: room.id,
            userId,
            role,
          })
          .onConflictDoNothing();
      }
    } catch (err) {
      console.warn("Could not insert participant to DB:", err);
    }

    return NextResponse.json({
      success: true,
      room,
      participant: {
        userId,
        userName,
        userImage,
        role,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}
