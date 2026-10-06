import { NextRequest, NextResponse } from "next/server";
import {
  appendMessage,
  getDeletedIds,
  getMessages,
  getReactions,
  markDeleted,
} from "@/lib/redis/chat";
import {
  expireAutoSlow,
  getHiddenMap,
  getViewedOnceIds,
  runChatGuard,
} from "@/lib/redis/guard";
import { checkChatGuard } from "@/lib/guard/engine";
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
import {
  checkSpam,
  maskProfanity,
} from "@/lib/chat/moderate";

type RouteParams = { params: Promise<{ slug: string }> };

/** Small inline media (Stream-unreachable fallback) must stay tiny. */
const MAX_INLINE_BYTES = 200 * 1024;

function sanitizeAttachment(raw: unknown):
  | {
      kind: "image" | "video" | "voice" | "file";
      url: string;
      name?: string;
      size?: number;
      mime?: string;
      duration?: number;
      waveform?: number[];
      viewOnce?: boolean;
    }
  | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  if (a.kind !== "image" && a.kind !== "video" && a.kind !== "voice" && a.kind !== "file") {
    return undefined;
  }
  if (typeof a.url !== "string" || !a.url) return undefined;
  const url = a.url.slice(0, 2_000_000);
  // Inline data: URLs bypass the CDN — hard cap keeps Redis healthy.
  if (url.startsWith("data:") && url.length > MAX_INLINE_BYTES) return undefined;
  if (!url.startsWith("data:") && !/^https?:\/\//.test(url)) return undefined;
  return {
    kind: a.kind,
    url,
    name: typeof a.name === "string" ? a.name.slice(0, 120) : undefined,
    size: typeof a.size === "number" && a.size >= 0 ? Math.min(a.size, 50 * 1024 * 1024) : undefined,
    mime: typeof a.mime === "string" ? a.mime.slice(0, 100) : undefined,
    duration:
      typeof a.duration === "number" && a.duration > 0
        ? Math.min(a.duration, 600)
        : undefined,
    waveform: Array.isArray(a.waveform)
      ? a.waveform.filter((n): n is number => typeof n === "number").slice(0, 96)
      : undefined,
    // WhatsApp-style view-once: images/videos only, burned on first open.
    viewOnce:
      a.viewOnce === true && (a.kind === "image" || a.kind === "video")
        ? true
        : undefined,
  };
}

// GET /api/rooms/[slug]/messages?since=<iso-timestamp>
// Cross-device chat history (Redis-backed). Merged client-side with
// Stream realtime messages by id. Includes the reactions map; deleted
// messages arrive as tombstones (text/attachment stripped).
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const [messages, reactions, deleted, hidden, viewed] = await Promise.all([
      getMessages(slug, 50),
      getReactions(slug),
      getDeletedIds(slug),
      getHiddenMap(slug),
      getViewedOnceIds(slug),
    ]);
    const withTombstones = messages.map((m) => {
      if (deleted.has(m.id)) {
        return { ...m, text: "", attachment: undefined, moment: undefined, deleted: true as const };
      }
      let out = m;
      // Burned view-once media: URL stripped for everyone (sender included —
      // they already saw it); the "Opened" shell remains.
      if (viewed.has(m.id) && m.attachment?.viewOnce) {
        out = { ...out, attachment: undefined, viewedOnce: true as const };
      }
      // Chat Guard collapse (content stays for tap-to-view).
      if (hidden[m.id]) {
        out = { ...out, hiddenByGuard: true as const, guardReason: hidden[m.id] };
      }
      return out;
    });
    const since = req.nextUrl.searchParams.get("since");
    const filtered = since
      ? withTombstones.filter((m) => m.createdAt > since)
      : withTombstones;
    return NextResponse.json({ messages: filtered, reactions });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}

// POST /api/rooms/[slug]/messages -> persist + broadcast a chat message.
// Enforces kicks, per-user mutes, mute-all, slow-mode, rate limits,
// profanity masking, and spam blocks. Accepts text and/or a rich payload
// (replyTo / attachment / moment pin).
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const body = await req.json();
    const { id, text, user, createdAt, replyTo, attachment, moment } = body ?? {};
    const rawText = typeof text === "string" ? text.trim() : "";
    const att = sanitizeAttachment(attachment);
    if (!rawText && !att) {
      return NextResponse.json(
        { error: "text or attachment is required" },
        { status: 400 }
      );
    }
    if (rawText.length > 4000) {
      return NextResponse.json(
        { error: "Message too long (max 4000 chars)." },
        { status: 400 }
      );
    }
    if (attachment !== undefined && !att) {
      return NextResponse.json(
        { error: "ATTACHMENT_TOO_LARGE", message: "That file is too large to send this way. Try a smaller image or shorter voice note." },
        { status: 413 }
      );
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
      // Auto slow-mode from Chat Guard expires on its own (2 min).
      expireAutoSlow(slug),
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

    // Content guards (client pre-checks too; the server is authoritative).
    const spam = checkSpam(rawText || "(media)");
    if (!spam.ok) {
      return NextResponse.json(
        { error: "SPAM", message: spam.reason || "Message blocked." },
        { status: 400 }
      );
    }
    const { clean } = maskProfanity(rawText);

    const replyRef =
      replyTo && typeof replyTo === "object"
        ? {
            id: String((replyTo as Record<string, unknown>).id ?? "").slice(0, 120),
            text: String((replyTo as Record<string, unknown>).text ?? "").slice(0, 140),
            userName: String(
              (replyTo as Record<string, unknown>).userName ?? "User"
            ).slice(0, 60),
          }
        : undefined;
    const momentPin =
      typeof moment === "number" && moment >= 0 && moment < 24 * 3600
        ? moment
        : undefined;

    const msg = {
      id:
        typeof id === "string" && id
          ? id.slice(0, 120)
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: clean.slice(0, 4000),
      user: {
        id: senderId,
        name: String(user.name).slice(0, 60),
        image: user.image ? String(user.image).slice(0, 500) : undefined,
      },
      createdAt:
        typeof createdAt === "string" ? createdAt : new Date().toISOString(),
      ...(replyRef && replyRef.id ? { replyTo: replyRef } : {}),
      ...(att ? { attachment: att } : {}),
      ...(momentPin !== undefined ? { moment: momentPin } : {}),
    };
    await appendMessage(slug, msg);

    // ---- Chat Guard (fail-open: never blocks the response path) ----
    // Runs AFTER persist so chat never waits on Python. Hosts/co-hosts are
    // allowlisted; system notices skip the guard entirely.
    const guardVerdict = await runChatGuard({
      slug,
      msgId: msg.id,
      senderId,
      privileged,
      rawText,
      slowModeSeconds: settings.slowModeSeconds,
    });
    if (guardVerdict?.blocked) {
      await markDeleted(slug, msg.id);
      return NextResponse.json(
        {
          error: "GUARD_BLOCK",
          message:
            "That message looked like a scam and wasn't sent. If this was a mistake, rephrase it and try again.",
        },
        { status: 403 }
      );
    }
    if (guardVerdict?.hidden) {
      return NextResponse.json({
        success: true,
        message: {
          ...msg,
          hiddenByGuard: true,
          guardReason: guardVerdict.reason,
        },
      });
    }
    return NextResponse.json({ success: true, message: msg });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: errMessage(error) },
      { status: 500 }
    );
  }
}
