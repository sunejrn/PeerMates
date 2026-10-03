import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug } from "@/lib/rooms/store";
import { getRole, type RoomRole } from "@/lib/redis/roles";
import {
  getSubtitleMeta,
  setSubtitleMeta,
  getVtt,
  setVtt,
  subtitleHash,
} from "@/lib/redis/subtitles";
import { parseSubtitleFile, cuesToVtt } from "@/lib/subtitles/parse";
import { broadcastRoomEvent } from "@/lib/stream/server";
import { resolveActorId, forbidden, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

const MAX_UPLOAD_CHARS = 400 * 1024;

/**
 * GET /api/rooms/[slug]/subtitles?lang=orig|xx
 * Any room member. Late joiners fetch the latest subtitle state from Redis.
 * Returns { meta, vtt, lang, translated } or { meta: null } when no
 * subtitles were uploaded yet. A requested translation that isn't cached
 * yet returns 404 { available: false } so the client can offer Translate.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const meta = await getSubtitleMeta(slug);
    if (!meta) return NextResponse.json({ meta: null });

    const lang = (new URL(req.url).searchParams.get("lang") || "orig")
      .toLowerCase()
      .slice(0, 8);
    if (lang === "orig" || lang === meta.sourceLang) {
      const vtt = await getVtt(meta.hash, "orig");
      return NextResponse.json({ meta, vtt, lang: "orig", translated: false });
    }
    const vtt = await getVtt(meta.hash, lang);
    if (!vtt) {
      return NextResponse.json(
        { meta, vtt: null, lang, translated: false, available: false },
        { status: 404 }
      );
    }
    return NextResponse.json({ meta, vtt, lang, translated: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/rooms/[slug]/subtitles
 * HOST + CO-HOST ONLY (server-enforced via Upstash role check): upload the
 * room subtitles. Body: { vtt, name, sourceLang?, actorId }. Accepts clean
 * VTT text or SRT text (converted server-side) — the client parses locally
 * and posts text so no multipart is needed. Broadcasts room.subtitles_changed
 * so everyone refetches; polling covers the rest.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const actorRole: RoomRole = await getRole(slug, actorId, room.hostId);
    if (actorRole !== "host" && actorRole !== "cohost") {
      return forbidden("Only hosts and co-hosts can upload subtitles.");
    }

    const raw = typeof body?.vtt === "string" ? body.vtt : "";
    const name = typeof body?.name === "string" ? body.name.slice(0, 80) : "subtitles";
    if (!raw || raw.length > MAX_UPLOAD_CHARS) {
      return NextResponse.json(
        { error: "Subtitle text is required (max 400KB)." },
        { status: 400 }
      );
    }
    // Normalize through the parser: validates cues, converts SRT→VTT.
    let vtt: string;
    let cueCount = 0;
    try {
      const looksSrt = !/^\s*WEBVTT/m.test(raw.slice(0, 200));
      const cues = parseSubtitleFile(raw, looksSrt ? "upload.srt" : "upload.vtt");
      cueCount = cues.length;
      vtt = cuesToVtt(cues);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid subtitle file." },
        { status: 400 }
      );
    }

    const sourceLang =
      typeof body?.sourceLang === "string" && /^[a-z]{2,8}$/.test(body.sourceLang)
        ? body.sourceLang.toLowerCase()
        : "auto";
    const hash = subtitleHash(vtt);
    await setVtt(hash, "orig", vtt);
    const meta = {
      hash,
      name,
      sourceLang,
      cueCount,
      langs: [] as string[],
      updatedAt: Date.now(),
    };
    await setSubtitleMeta(slug, meta);

    await broadcastRoomEvent(slug, {
      type: "room.subtitles_changed",
      hash,
      name,
    });

    return NextResponse.json({ success: true, meta });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
