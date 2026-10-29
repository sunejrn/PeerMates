import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { localFileSourceFor } from "@/lib/video/detector";
import { isValidFingerprint } from "@/lib/video/localfile";
import { setRoomFingerprint } from "@/lib/redis/localfile";
import { createRoomInDb, getRecentRooms } from "@/lib/rooms/store";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { rateLimited } from "@/lib/rooms/actor";
import { nanoid } from "nanoid";

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) || "unknown";
}

export async function POST(req: NextRequest) {
  // Rate-limit room creation (free-tier guard, per IP).
  const { allowed, retryAfter } = await checkRateLimit(
    `room-create:${clientIp(req)}`,
    RATE_LIMITS.roomCreate.limit,
    RATE_LIMITS.roomCreate.windowSeconds
  );
  if (!allowed) return rateLimited(retryAfter);
  try {
    // Rooms can only be created by a signed-in user — no guest path.
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return NextResponse.json(
        {
          error: "AUTH_REQUIRED",
          message: "Sign in with Google or GitHub to create a party.",
        },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { title, localFile } = body;

    // Only "My Files" rooms are supported: the host picked a file on their
    // device. Only the tiny fingerprint travels; bytes stay local.
    if (!localFile || typeof localFile !== "object") {
      return NextResponse.json(
        { error: "Pick a movie file to create a PeerMates party." },
        { status: 400 }
      );
    }
    if (!isValidFingerprint(localFile)) {
      return NextResponse.json(
        { error: "Invalid file fingerprint. Re-select your file and try again." },
        { status: 400 }
      );
    }

    const fingerprint = localFile;
    const videoType = "localfile" as const;
    const videoSource = localFileSourceFor(localFile.fpId);
    const hostId = session.user.id;
    const hostName = session.user.name;
    const hostImage = session.user.image || undefined;

    // Generate short shareable slug (e.g. 6 chars)
    const slug = nanoid(6).toLowerCase();

    const room = await createRoomInDb({
      slug,
      title: title && String(title).trim() ? String(title).trim() : "PeerMates Party",
      hostId,
      hostName,
      hostImage,
      videoSource,
      videoType,
    });

    // Persist the host fingerprint (Redis + durable DB) so viewers can compare
    // their own file and the host is never asked to re-pick it.
    await setRoomFingerprint(slug, fingerprint);

    return NextResponse.json({
      success: true,
      slug: room.slug,
      room,
    });
  } catch (error: unknown) {
    console.error("Failed to create room:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const recent = await getRecentRooms();
    return NextResponse.json({ rooms: recent });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch rooms",
      },
      { status: 500 }
    );
  }
}
