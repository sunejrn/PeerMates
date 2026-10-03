import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import {
  getRoomFingerprint,
  getP2PReceiverCount,
  isP2PSharing,
} from "@/lib/redis/localfile";
import { P2P_MAX_RECEIVERS } from "@/lib/video/localfile";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/rooms/[slug]/localfile
 * Returns the host's file fingerprint (for "same movie?" comparison),
 * the room's file label, and P2P receiver availability. Tiny JSON —
 * media bytes never touch the server.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    if (room.videoType !== "localfile") {
      return NextResponse.json(
        { error: "This room does not use a local file." },
        { status: 400 }
      );
    }
    const [fingerprint, p2pCount, sharing] = await Promise.all([
      getRoomFingerprint(slug),
      getP2PReceiverCount(slug),
      isP2PSharing(slug),
    ]);
    if (!fingerprint) {
      return NextResponse.json(
        { error: "Host fingerprint missing. Ask the host to re-pick the file." },
        { status: 404 }
      );
    }
    return NextResponse.json({
      fingerprint,
      sharing,
      p2p: {
        receivers: p2pCount,
        max: P2P_MAX_RECEIVERS,
        available: p2pCount < P2P_MAX_RECEIVERS,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
