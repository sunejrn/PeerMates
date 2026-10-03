import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import { getSubtitleMeta, getVtt, getRecap, setRecap } from "@/lib/redis/subtitles";
import { vttToCues, cuesTextUpTo } from "@/lib/subtitles/parse";
import { generate, AIQuotaError } from "@/lib/ai";
import { resolveActorId, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * POST /api/rooms/[slug]/recap
 * "Catch me up": summarizes ONLY subtitle text up to the viewer's current
 * timestamp. Body: { currentTime, actorId }. The model is instructed to
 * summarize only the provided text and never speculate beyond it.
 * Cached by file hash + minute bucket (no expiry). Rate-limited per user
 * and globally. Quota exhaustion → 429 busy message.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const currentTime = Number(body?.currentTime);
    if (!Number.isFinite(currentTime) || currentTime < 0) {
      return NextResponse.json({ error: "currentTime is required." }, { status: 400 });
    }

    const meta = await getSubtitleMeta(slug);
    if (!meta) {
      return NextResponse.json({ error: "No subtitles in this room yet." }, { status: 404 });
    }

    const bucket = Math.floor(currentTime / 60);
    const cached = await getRecap(meta.hash, bucket);
    if (cached) return NextResponse.json({ recap: cached, cached: true, bucket });

    const perUser = await checkRateLimit(
      `ai:user:${actorId}`,
      RATE_LIMITS.aiPerUser.limit,
      RATE_LIMITS.aiPerUser.windowSeconds
    );
    if (!perUser.allowed) return rateLimited(perUser.retryAfter);
    const global = await checkRateLimit(
      `ai:room:${slug}`,
      RATE_LIMITS.aiGlobal.limit,
      RATE_LIMITS.aiGlobal.windowSeconds
    );
    if (!global.allowed) return rateLimited(global.retryAfter);

    const origVtt = await getVtt(meta.hash, "orig");
    if (!origVtt) {
      return NextResponse.json({ error: "Original subtitles expired." }, { status: 404 });
    }
    const text = cuesTextUpTo(vttToCues(origVtt), currentTime);
    if (!text) {
      return NextResponse.json({ error: "Nothing has been said yet." }, { status: 400 });
    }

    try {
      const prompt =
        `Summarize ONLY the following video subtitles so a viewer who just ` +
        `joined can catch up. Rules: use only the text below; never speculate, ` +
        `invent, or describe anything beyond it; keep it to 3-5 short sentences. ` +
        `Return JSON only: {"recap": "..."}.\n\n` +
        `SUBTITLES:\n${text}`;
      const raw = await generate(prompt);
      const parsed = JSON.parse(stripFences(raw)) as { recap?: unknown };
      const recap = String(parsed.recap || "").trim().slice(0, 2000);
      if (!recap) throw new Error("Model returned an empty recap.");
      await setRecap(meta.hash, bucket, recap);
      return NextResponse.json({ recap, cached: false, bucket });
    } catch (err) {
      if (err instanceof AIQuotaError) {
        return NextResponse.json(
          { error: "Translation is busy, try again later" },
          { status: 429 }
        );
      }
      throw err;
    }
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
