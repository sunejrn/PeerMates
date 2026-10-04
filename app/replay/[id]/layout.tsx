import type { Metadata } from "next";
import { getReplayRow } from "@/lib/replay/store";

function siteUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return base.replace(/\/+$/, "");
}

type Props = { params: Promise<{ id: string }> };

/**
 * Absolute OG tags so the Wrapped card unfurls in WhatsApp / X / iMessage.
 * The 1200x630 image itself comes from ./opengraph-image.tsx.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const base = siteUrl();
  const replay = await getReplayRow(id).catch(() => null);
  if (!replay) {
    return { title: "Replay not found — PeerMates" };
  }
  const title = `${replay.title} — Party Replay | PeerMates`;
  const description = `Relive "${replay.title}": ${replay.viewerCount} viewers, peak moment and highlights. Made with PeerMates.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      url: `${base}/replay/${id}`,
      images: [{ url: `${base}/replay/${id}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${base}/replay/${id}/opengraph-image`],
    },
  };
}

export default function ReplayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
