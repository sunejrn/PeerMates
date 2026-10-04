import { ImageResponse } from "@vercel/og";
import { headers } from "next/headers";
import { getReplayRow } from "@/lib/replay/store";
import { OgArt, pickLocale } from "@/lib/replay/cardArt";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Link-preview image (1200x630) served automatically for /replay/[id] —
 * renders correctly when pasted into WhatsApp, X, and iMessage.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const replay = await getReplayRow(id).catch(() => null);
  const h = await headers();
  const { code, dict } = pickLocale(h.get("accept-language"));

  if (!replay) {
    return new ImageResponse(
      (
        <div
          style={{
            width: 1200, height: 630, display: "flex", alignItems: "center",
            justifyContent: "center", background: "#0b0614", color: "#fff",
            fontSize: 48, fontFamily: "system-ui,sans-serif",
          }}
        >
          PeerMates Party Replay
        </div>
      ),
      { ...size }
    );
  }
  return new ImageResponse(<OgArt replay={replay} dict={dict} locale={code} />, {
    ...size,
  });
}
