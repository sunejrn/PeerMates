import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { getSubtitleMeta, getVtt } from "@/lib/redis/subtitles";
import { vttToCues, cuesTextUpTo } from "@/lib/subtitles/parse";
import { generate, AIQuotaError, AIError } from "@/lib/ai";
import { buddyKey, getBuddyAnswer, setBuddyAnswer, BUDDY_SYSTEM_PROMPT } from "@/lib/redis/buddy";
import { resolveActorId, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

/**
 * POST /api/rooms/[slug]/buddy
 * "Movie Buddy": answer a question ONLY from subtitle text shown so far.
 * Body: { question, currentTime, actorId }.
 * - Server sends the model only subtitle text up to currentTime + question.
 * - System prompt: answer only from that text, "that hasn't been shown yet"
 *   when unsure, never speculate beyond it.
 * - Cache: file hash + 30s timestamp bucket + normalized question.
 * - Rate-limit per user + global; quota errors -> friendly 429 message.
 * - Keys stay server-side (only this route imports lib/ai.ts).
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const question = String(body?.question ?? "").trim().slice(0, 500);
    if (!question) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
    const currentTime = Number(body?.currentTime);
    if (!Number.isFinite(currentTime) || currentTime < 0) {
      return NextResponse.json({ error: "currentTime is required." }, { status: 400 });
    }

    const meta = await getSubtitleMeta(slug);
    if (!meta) {
      return NextResponse.json({ error: "No subtitles in this room yet — Movie Buddy needs captions." }, { status: 404 });
    }

    const { key, bucket } = buddyKey(meta.hash, Math.floor(currentTime), question);
    const cached = await getBuddyAnswer(key);
    if (cached) return NextResponse.json({ answer: cached, cached: true, bucket });

    const perUser = await checkRateLimit(
      `buddy:user:${actorId}`,
      RATE_LIMITS.buddyPerUser.limit,
      RATE_LIMITS.buddyPerUser.windowSeconds
    );
    if (!perUser.allowed) return rateLimited(perUser.retryAfter);
    const global = await checkRateLimit(
      `buddy:room:${slug}`,
      RATE_LIMITS.buddyGlobal.limit,
      RATE_LIMITS.buddyGlobal.windowSeconds
    );
    if (!global.allowed) return rateLimited(global.retryAfter);

    const origVtt = await getVtt(meta.hash, "orig");
    if (!origVtt) {
      return NextResponse.json({ error: "Original subtitles expired." }, { status: 404 });
    }
    const text = cuesTextUpTo(vttToCues(origVtt), currentTime);
    if (!text) {
      return NextResponse.json({ answer: "that hasn't been shown yet", cached: false, bucket });
    }

    try {
      const prompt =
        `${BUDDY_SYSTEM_PROMPT}\n\nSUBTITLES SO FAR:\n${text}\n\nQUESTION: ${question}`;
      const raw = await generate(prompt);
      const parsed = JSON.parse(stripFences(raw)) as { answer?: unknown };
      let answer = String(parsed.answer || "").trim().slice(0, 2000);
      if (!answer) answer = "that hasn't been shown yet";
      await setBuddyAnswer(key, answer);
      return NextResponse.json({ answer, cached: false, bucket });
    } catch (err) {
      if (err instanceof AIQuotaError) {
        return NextResponse.json(
          { error: "Movie Buddy is busy right now — try again in a bit." },
          { status: 429 }
        );
      }
      if (err instanceof AIError) {
        return NextResponse.json(
          { error: "Movie Buddy couldn't answer that. Try again." },
          { status: 502 }
        );
      }
      throw err;
    }
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
