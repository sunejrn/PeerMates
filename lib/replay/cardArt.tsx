/**
 * Shared Party Wrapped artwork for next/og renders (OG 1200x630 + 9:16
 * story). Inline styles only — no Tailwind, no external fetches — so the
 * edge runtime renders identically everywhere, including WhatsApp unfurls.
 */

import type { ReplayRow } from "@/lib/replay/store";
import { fmtClock } from "@/lib/replay/highlights";

type Dict = {
  replay: string;
  viewers: string;
  peak: string;
  topVibe: string;
  madeWith: string;
};

const STRINGS: Record<string, Dict> = {
  en: { replay: "PARTY WRAPPED", viewers: "viewers", peak: "Peak moment", topVibe: "top vibe", madeWith: "Made with PeerMates" },
  es: { replay: "RESUMEN DE FIESTA", viewers: "espectadores", peak: "Momento cumbre", topVibe: "mejor vibra", madeWith: "Hecho con PeerMates" },
  fr: { replay: "RÉSUMÉ DE SOIRÉE", viewers: "spectateurs", peak: "Moment fort", topVibe: "top ambiance", madeWith: "Fait avec PeerMates" },
  de: { replay: "PARTY-RÜCKBLICK", viewers: "Zuschauer", peak: "Top-Moment", topVibe: "Top-Stimmung", madeWith: "Erstellt mit PeerMates" },
  pt: { replay: "RESUMO DA FESTA", viewers: "espectadores", peak: "Melhor momento", topVibe: "melhor clima", madeWith: "Feito com PeerMates" },
};

/** Locale from Accept-Language (country-localized card text). */
export function pickLocale(header: string | null): { code: string; dict: Dict } {
  const tag = (header || "").split(",")[0].split(";")[0].trim().slice(0, 2).toLowerCase();
  const dict = STRINGS[tag] ?? STRINGS.en;
  return { code: STRINGS[tag] ? tag : "en", dict };
}

export function formatDay(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function initials(name: string): string {
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function crowdInitials(replay: ReplayRow): string[] {
  const names: string[] = [];
  if (replay.hostName) names.push(replay.hostName);
  const h = (replay.highlights ?? {}) as Record<string, { name?: string }>;
  if (h.chatter?.name) names.push(h.chatter.name);
  if (h.firstReactor?.name) names.push(h.firstReactor.name);
  const seen = new Set<string>();
  return names.map(initials).filter((i) => {
    if (seen.has(i)) return false;
    seen.add(i);
    return true;
  }).slice(0, 5);
}

function HeatLine({ buckets, w, h }: { buckets: number[]; w: number; h: number }) {
  const max = Math.max(1, ...buckets);
  const pts = buckets.map((c, i) => {
    const x = buckets.length <= 1 ? w / 2 : (i / (buckets.length - 1)) * w;
    const y = h - 4 - (c / max) * (h - 10);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h}>
      <defs>
        <linearGradient id="pmog" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="url(#pmog)"
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const AV = ["#8b5cf6", "#ec4899", "#06b6d4", "#f59e0b", "#10b981"];

export function OgArt({ replay, dict, locale }: { replay: ReplayRow; dict: Dict; locale: string }) {
  const peakT = replay.peaks[0]?.t ?? 0;
  const crowd = crowdInitials(replay);
  return (
    <div
      style={{
        width: 1200, height: 630, display: "flex", flexDirection: "column",
        justifyContent: "space-between", padding: 56,
        background: "linear-gradient(135deg,#0b0614 0%,#17102b 55%,#2b0f2e 100%)",
        color: "#fff", fontFamily: "system-ui,sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 26, letterSpacing: 6, color: "#c4b5fd", fontWeight: 700 }}>
          {`🎉 ${dict.replay}`}
        </div>
        <div style={{ fontSize: 24, color: "#a1a1aa" }}>
          {`${formatDay(replay.endedAt, locale)} · ${replay.viewerCount} ${dict.viewers}`}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", gap: 40, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>
            {replay.title.slice(0, 42)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 20 }}>
            <HeatLine buckets={replay.buckets} w={640} h={110} />
          </div>
          <div style={{ fontSize: 28, color: "#f9a8d4", marginTop: 12 }}>
            {`${dict.peak}: ${fmtClock(peakT)}`}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 130 }}>{replay.topEmoji || "🎬"}</div>
          <div style={{ fontSize: 24, color: "#a1a1aa" }}>{dict.topVibe}</div>
          <div style={{ display: "flex", flexDirection: "row", marginTop: 8 }}>
            {crowd.map((ini, i) => (
              <div
                key={i}
                style={{
                  width: 64, height: 64, borderRadius: 32, marginLeft: i === 0 ? 0 : -14,
                  background: AV[i % AV.length], display: "flex",
                  alignItems: "center", justifyContent: "center",
                  fontSize: 26, fontWeight: 800, border: "3px solid #17102b",
                }}
              >
                {ini}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 24, color: "#71717a" }}>{dict.madeWith}</div>
    </div>
  );
}

export function StoryArt({ replay, dict, locale }: { replay: ReplayRow; dict: Dict; locale: string }) {
  const peakT = replay.peaks[0]?.t ?? 0;
  const crowd = crowdInitials(replay);
  return (
    <div
      style={{
        width: 1080, height: 1920, display: "flex", flexDirection: "column",
        justifyContent: "space-between", padding: 72,
        background: "linear-gradient(180deg,#0b0614 0%,#1c1033 45%,#3b0f33 100%)",
        color: "#fff", fontFamily: "system-ui,sans-serif",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 34, letterSpacing: 8, color: "#c4b5fd", fontWeight: 700 }}>
          {`🎉 ${dict.replay}`}
        </div>
        <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>
          {replay.title.slice(0, 48)}
        </div>
        <div style={{ fontSize: 36, color: "#a1a1aa" }}>
          {`${formatDay(replay.endedAt, locale)} · ${replay.viewerCount} ${dict.viewers}`}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
        <div style={{ fontSize: 220 }}>{replay.topEmoji || "🎬"}</div>
        <div style={{ fontSize: 36, color: "#a1a1aa" }}>{dict.topVibe}</div>
        <HeatLine buckets={replay.buckets} w={900} h={200} />
        <div style={{ fontSize: 44, color: "#f9a8d4", fontWeight: 700 }}>
          {`${dict.peak}: ${fmtClock(peakT)}`}
        </div>
        <div style={{ display: "flex", marginTop: 8 }}>
          {crowd.map((ini, i) => (
            <div
              key={i}
              style={{
                width: 96, height: 96, borderRadius: 48, marginLeft: i === 0 ? 0 : -20,
                background: AV[i % AV.length], display: "flex",
                alignItems: "center", justifyContent: "center",
                fontSize: 40, fontWeight: 800, border: "4px solid #1c1033",
              }}
            >
              {ini}
            </div>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 34, color: "#71717a", textAlign: "center" }}>
        {dict.madeWith}
      </div>
    </div>
  );
}
