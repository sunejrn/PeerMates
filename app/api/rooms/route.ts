import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { detectVideoSource } from "@/lib/video/detector";
import { createRoomInDb, getRecentRooms } from "@/lib/rooms/store";
import { nanoid } from "nanoid";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, videoUrl } = body;

    if (!videoUrl || typeof videoUrl !== "string") {
      return NextResponse.json(
        { error: "A valid video URL is required." },
        { status: 400 }
      );
    }

    const detection = detectVideoSource(videoUrl);
    if (!detection.isValid || !detection.type) {
      return NextResponse.json(
        {
          error:
            "Invalid video URL. Please provide a YouTube link, an HLS (.m3u8) stream, or a direct MP4 file URL.",
        },
        { status: 400 }
      );
    }

    // Check user session
    let hostId = "guest_" + nanoid(6);
    let hostName = "Guest Host";
    let hostImage: string | undefined;
    let isAuthenticated = false;

    try {
      const session = await auth.api.getSession({
        headers: req.headers,
      });
      if (session?.user) {
        hostId = session.user.id;
        hostName = session.user.name;
        hostImage = session.user.image || undefined;
        isAuthenticated = true;
      }
    } catch {
      // Unauthenticated
    }

    // GATING: If user is not authenticated, check if they've already created once
    const hasCreatedCookie = req.cookies.get("watchtogether_has_created_once");
    if (!isAuthenticated && hasCreatedCookie?.value === "true") {
      return NextResponse.json(
        {
          error: "AUTH_REQUIRED",
          message:
            "You have already used your 1 free watch party creation. Please sign in with GitHub to create unlimited watch parties.",
        },
        { status: 403 }
      );
    }

    // Generate short shareable slug (e.g. 6 chars)
    const slug = nanoid(6).toLowerCase();

    const room = await createRoomInDb({
      slug,
      title: title && title.trim() ? title.trim() : "Watch Party",
      hostId,
      hostName,
      hostImage,
      videoSource: detection.cleanUrl,
      videoType: detection.type,
    });

    const response = NextResponse.json({
      success: true,
      slug: room.slug,
      room,
    });

    // Set cookie if unauthenticated so hard refreshes cannot bypass the 1-time limit
    if (!isAuthenticated) {
      response.cookies.set("watchtogether_has_created_once", "true", {
        path: "/",
        maxAge: 60 * 60 * 24 * 365, // 1 year
        sameSite: "lax",
        httpOnly: true,
      });
    }

    return response;
  } catch (error: any) {
    console.error("Failed to create room:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const recent = await getRecentRooms();
    return NextResponse.json({ rooms: recent });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch rooms" },
      { status: 500 }
    );
  }
}
