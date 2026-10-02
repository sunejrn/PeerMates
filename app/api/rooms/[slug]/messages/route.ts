import { NextRequest, NextResponse } from "next/server";
import { appendMessage, getMessages } from "@/lib/redis/chat";
import { getRoomBySlug } from "@/lib/rooms/store";

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
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// POST /api/rooms/[slug]/messages -> persist + broadcast a chat message
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
    const msg = {
      id:
        typeof id === "string" && id
          ? id
          : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: text.trim().slice(0, 1000),
      user: {
        id: String(user.id),
        name: String(user.name),
        image: user.image ? String(user.image) : undefined,
      },
      createdAt:
        typeof createdAt === "string" ? createdAt : new Date().toISOString(),
    };
    await appendMessage(slug, msg);
    return NextResponse.json({ success: true, message: msg });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
