import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import {
  getSubtitleMeta,
  getVtt,
  setVtt,
  addSubtitleLang,
} from "@/lib/redis/subtitles";
import { vttToCues, cuesToVtt, type SubCue } from "@/lib/subtitles/parse";
import { generate, AIQuotaError } from "@/lib/ai";
import { broadcastRoomEvent } from "@/lib/stream/server";
import { resolveActorId, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

/** 200–300 subtitle lines per request per spec (keeps prompts bounded). */
const CHUNK_LINES = 250;

function chunkCues(cues: SubCue[]): SubCue[][] {
  const out: SubCue[][] = [];
  for (let i = 0; i < cues.length; i += CHUNK_LINES) {
    out.push(cues.slice(i, i + CHUNK_LINES));
  }
  return out;
}

function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/**
 * Translate ONE chunk. Timestamps are never sent — only ordered text lines —
 * so they can't be altered; the server re-attaches the original timings.
 */
async function translateChunk(lines: string[], targetLang: string): Promise<string[]> {
  const prompt =
    `Translate the following subtitle lines into ${targetLang}. ` +
    `Rules: keep the exact same number of lines in the exact same order; ` +
    `translate meaning only, keep timestamps untouched (none are included); ` +
    `preserve line breaks inside a line as \\n; do not add commentary. ` +
    `Return JSON only: {"lines": ["...", ...]}.\n\n` +
    JSON.stringify({ lines });
  const raw = await generate(prompt);
  const parsed = JSON.parse(stripFences(raw)) as { lines?: unknown };
  if (!Array.isArray(parsed.lines) || parsed.lines.length !== lines.length) {
    throw new Error("Model returned a mismatched translation.");
  }
  return parsed.lines.map((l) => String(l ?? ""));
}

async function assertAiBudget(slug: string, actorId: string): Promise<Response | null> {
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
  return null;
}

/**
 * POST /api/rooms/[slug]/subtitles/translate
 * Any room member (per-user language). Body: { lang, actorId }.
 * Cache (hash + language, no expiry) is checked before EVERY provider call.
 * Large files go out in 200–300 line chunks, then merge into one VTT.
 * On free-quota exhaustion: 429 "Translation is busy, try again later" —
 * the client keeps the original subtitles playing.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const lang =
      typeof body?.lang === "string" ? body.lang.toLowerCase().slice(0, 8) : "";
    if (!/^[a-z]{2,8}$/.test(lang)) {
      return NextResponse.json(
        { error: "lang is required (e.g. es, fr, tw)." },
        { status: 400 }
      );
    }

    const meta = await getSubtitleMeta(slug);
    if (!meta) {
      return NextResponse.json({ error: "No subtitles in this room yet." }, { status: 404 });
    }

    // Cache first — before rate limits and before every provider call.
    const cached = await getVtt(meta.hash, lang);
    if (cached) {
      await addSubtitleLang(slug, lang);
      return NextResponse.json({ vtt: cached, lang, cached: true });
    }

    const limited = await assertAiBudget(slug, actorId);
    if (limited) return limited;

    const origVtt = await getVtt(meta.hash, "orig");
    if (!origVtt) {
      return NextResponse.json({ error: "Original subtitles expired." }, { status: 404 });
    }
    const cues = vttToCues(origVtt);
    if (cues.length === 0) {
      return NextResponse.json({ error: "No usable cues to translate." }, { status: 400 });
    }

    try {
      const translatedTexts: string[] = [];
      for (const chunk of chunkCues(cues)) {
        // Re-check the cache before every provider call (a parallel
        // request may have finished this hash+lang meanwhile).
        const stillMissing = await getVtt(meta.hash, lang);
        if (stillMissing) {
          await addSubtitleLang(slug, lang);
          return NextResponse.json({ vtt: stillMissing, lang, cached: true });
        }
        const out = await translateChunk(chunk.map((c) => c.text), lang);
        translatedTexts.push(...out);
      }
      const merged = cues.map((c, i) => ({ ...c, text: translatedTexts[i] ?? c.text }));
      const vtt = cuesToVtt(merged);
      await setVtt(meta.hash, lang, vtt);
      await addSubtitleLang(slug, lang);
      await broadcastRoomEvent(slug, { type: "room.subtitles_changed", hash: meta.hash, lang });
      return NextResponse.json({ vtt, lang, cached: false });
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
