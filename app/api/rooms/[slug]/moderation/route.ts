import { NextRequest, NextResponse } from "next/server";
import {
  getRoomBySlug,
  changeRoomSource,
} from "@/lib/rooms/store";
import {
  getRole,
  getSettings,
  setSettings,
  kickUser,
  muteUser,
  unmuteUser,
  removeControlRequest,
  type RoomRole,
} from "@/lib/redis/roles";
import { removePresence } from "@/lib/redis/presence";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { detectVideoSource } from "@/lib/video/detector";
import {
  removeStreamMember,
  broadcastRoomEvent,
} from "@/lib/stream/server";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * POST /api/rooms/[slug]/moderation
 * HOST + CO-HOST ONLY (server-enforced on every action):
 * - kick / mute / unmute a viewer (host may also moderate co-hosts;
 *   co-hosts may only moderate viewers; the host can never be kicked)
 * - slowmode { seconds: 0|5|10|30 } — chat slow mode for big rooms
 * - muteall { muted: boolean } — viewers read-only, privileged still chat
 * - source { videoUrl } — change the video source for everyone
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await checkRateLimit(
      `mod:${slug}:${actorId}`,
      RATE_LIMITS.moderation.limit,
      RATE_LIMITS.moderation.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const actorRole: RoomRole = await getRole(slug, actorId, room.hostId);
    if (actorRole !== "host" && actorRole !== "cohost") {
      return forbidden("Only hosts and co-hosts can moderate.");
    }

    const { action } = body ?? {};

    // ---- Member moderation (kick / mute / unmute) ----
    if (action === "kick" || action === "mute" || action === "unmute") {
      const target =
        typeof body?.targetUserId === "string" ? body.targetUserId : "";
      if (!target) {
        return NextResponse.json(
          { error: "targetUserId is required" },
          { status: 400 }
        );
      }
      if (target === room.hostId) {
        return forbidden("The host cannot be moderated.");
      }
      if (target === actorId) {
        return NextResponse.json(
          { error: "You cannot moderate yourself." },
          { status: 400 }
        );
      }
      const targetRole = await getRole(slug, target, room.hostId);
      if (actorRole === "cohost" && targetRole !== "viewer") {
        return forbidden("Co-hosts can only moderate viewers.");
      }

      if (action === "kick") {
        await kickUser(slug, target);
        await removePresence(slug, target);
        await removeControlRequest(slug, target);
        await removeStreamMember(slug, target);
        await broadcastRoomEvent(slug, {
          type: "room.kicked",
          userId: target,
        });
        return NextResponse.json({ success: true, action, userId: target });
      }
      if (action === "mute") {
        await muteUser(slug, target);
        return NextResponse.json({ success: true, action, userId: target });
      }
      await unmuteUser(slug, target);
      return NextResponse.json({ success: true, action, userId: target });
    }

    // ---- Chat slow mode ----
    if (action === "slowmode") {
      const seconds = Number(body?.seconds);
      const allowed = [0, 5, 10, 30];
      if (!allowed.includes(seconds)) {
        return NextResponse.json(
          { error: "seconds must be one of 0, 5, 10, 30" },
          { status: 400 }
        );
      }
      const settings = await getSettings(slug);
      settings.slowModeSeconds = seconds;
      await setSettings(slug, settings);
      await broadcastRoomEvent(slug, {
        type: "room.settings_changed",
        slowModeSeconds: seconds,
      });
      return NextResponse.json({ success: true, settings });
    }

    // ---- Mute-all (viewers read-only) ----
    if (action === "muteall") {
      const settings = await getSettings(slug);
      settings.chatMuted = body?.muted !== false;
      await setSettings(slug, settings);
      await broadcastRoomEvent(slug, {
        type: "room.settings_changed",
        chatMuted: settings.chatMuted,
      });
      return NextResponse.json({ success: true, settings });
    }

    // ---- Video source change ----
    if (action === "source") {
      const videoUrl =
        typeof body?.videoUrl === "string" ? body.videoUrl.trim() : "";
      if (!videoUrl) {
        return NextResponse.json(
          { error: "videoUrl is required" },
          { status: 400 }
        );
      }
      const detection = detectVideoSource(videoUrl);
      if (!detection.isValid || !detection.type) {
        return NextResponse.json(
          { error: "Invalid video URL. Use YouTube, HLS (.m3u8), or MP4." },
          { status: 400 }
        );
      }
      const updated = await changeRoomSource(
        slug,
        detection.cleanUrl,
        detection.type
      );
      if (!updated) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, room: updated });
    }

    return NextResponse.json(
      {
        error:
          'action must be "kick", "mute", "unmute", "slowmode", "muteall", or "source"',
      },
      { status: 400 }
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
