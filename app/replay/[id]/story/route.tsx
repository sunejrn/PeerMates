import type { NextRequest } from "next/server";
import { ImageResponse } from "@vercel/og";
import { getReplayRow } from "@/lib/replay/store";
import { StoryArt, pickLocale } from "@/lib/replay/cardArt";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /replay/[id]/story — 9:16 (1080x1920) Party Wrapped story image for
 * Instagram Stories / WhatsApp Status download.
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const replay = await getReplayRow(id).catch(() => null);
    if (!replay) {
      return new Response("Replay not found.", { status: 404 });
    }
    const { code, dict } = pickLocale(req.headers.get("accept-language"));
    return new ImageResponse(<StoryArt replay={replay} dict={dict} locale={code} />, {
      width: 1080,
      height: 1920,
    });
  } catch (err) {
    console.error("story render failed:", err instanceof Error ? err.message : err);
    return new Response("Story render failed.", { status: 500 });
  }
}
