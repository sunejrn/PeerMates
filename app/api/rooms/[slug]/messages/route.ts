import { NextRequest, NextResponse } from "next/server";
import { appendMessage, getMessages } from "@/lib/redis/chat";
import { getRoomBySlug } from "@/lib/rooms/store";
import {
  getRole,
  getSettings,
  isKicked,
  isMutedChat,
  checkAndRecordChatSend,
} from "@/lib/redis/roles";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

// GET /api/rooms/[slug]/messages?since=<iso-timestamp>
// Cross-device chat history (Redis-backed). Merged client-side with
// Stream realtime messages by id.
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const messages = await getMessages(slug, 50);
    const since = req.nextUrl.searchParams.get("since");
    const filtered = since
      ? messages.filter((m) => m.createdAt > since)
      : messages;
    return NextResponse.json({ messages: filtered });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}

// POST /api/rooms/[slug]/messages -> persist + broadcast a chat message.
// Enforces kicks, per-user mutes, mute-all, slow-mode, and rate limits.
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const body = await req.json();
    const { id, text, user, createdAt } = body ?? {};
    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if (!user?.id || !user?.name) {
      return NextResponse.json(
        { error: "user.id and user.name are required" },
        { status: 400 }
      );
    }

    const { actorId } = await resolveActorId(req, { userId: user?.id });
    const senderId = actorId || String(user.id);

    if (await isKicked(slug, senderId)) {
      return NextResponse.json(
        { error: "KICKED", message: "You were removed from this room." },
        { status: 403 }
      );
    }
    if (await isMutedChat(slug, senderId)) {
      return forbidden("You are muted in this room.");
    }

    const [role, settings] = await Promise.all([
      getRole(slug, senderId, room.hostId),
      getSettings(slug),
    ]);
    const privileged = role === "host" || role === "cohost";
    if (settings.chatMuted && !privileged) {
      return forbidden("Chat is muted for viewers right now.");
    }

    const { waitSeconds } = await checkAndRecordChatSend(
      slug,
      senderId,
      settings.slowModeSeconds
    );
    if (waitSeconds > 0) {
      return NextResponse.json(
        {
          error: "SLOW_MODE",
          message: `Slow mode is on. Wait ${waitSeconds}s.`,
          retryAfter: waitSeconds,
        },
        { status: 429 }
      );
    }

    const rl = await checkRateLimit(
      `msg:${slug}:${senderId}`,
      RATE_LIMITS.message.limit,
      RATE_LIMITS.message.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const msg = {
      id:
        typeof id === "string" && id
          ? id
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim().slice(0, 1000),
      user: {
        id: senderId,
        name: String(user.name),
        image: user.image ? String(user.image) : undefined,
      },
      createdAt:
        typeof createdAt === "string" ? createdAt : new Date().toISOString(),
    };
    await appendMessage(slug, msg);
    return NextResponse.json({ success: true, message: msg });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
