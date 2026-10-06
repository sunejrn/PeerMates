/**
 * Provider URL parser (client-safe: no DOM, no Node APIs).
 *
 * Detects the video provider from a pasted link and extracts the id the
 * embed/player needs — including short and mobile forms. Pure functions so
 * the same file runs in the browser, in `node --test`, and (bundled) on
 * the server for allowlist validation.
 *
 * Only official embeds/players are ever used downstream: nothing is
 * scraped, downloaded, or proxied by our server.
 */

export type ProviderId =
  | "youtube"
  | "facebook"
  | "vimeo"
  | "dailymotion"
  | "twitch"
  | "tiktok"
  | "instagram"
  | "drive"
  | "streamable"
  | "loom"
  | "archive"
  | "dropbox"
  | "hls"
  | "mp4";

/** Full sync = host controls playback; guided = countdown + manual play. */
export type ControlLevel = "full" | "guided";

export interface ParsedProvider {
  provider: ProviderId;
  control: ControlLevel;
  /** Opaque id the embed builder needs (numeric id, file id, or full URL). */
  id: string;
  /** Provider display name. */
  label: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pathParts(url: string): string[] {
  try {
    return new URL(url.trim()).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function queryOf(url: string): URLSearchParams {
  try {
    return new URL(url.trim()).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

/** Hostnames we knowingly handle (everything else is not a provider link). */
export const PROVIDER_HOSTS: Record<string, ProviderId> = {
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "music.youtube.com": "youtube",
  "youtube-nocookie.com": "youtube",
  "facebook.com": "facebook",
  "fb.watch": "facebook",
  "m.facebook.com": "facebook",
  "vimeo.com": "vimeo",
  "player.vimeo.com": "vimeo",
  "dailymotion.com": "dailymotion",
  "dai.ly": "dailymotion",
  "geo.dailymotion.com": "dailymotion",
  "twitch.tv": "twitch",
  "m.twitch.tv": "twitch",
  "tiktok.com": "tiktok",
  "m.tiktok.com": "tiktok",
  "vm.tiktok.com": "tiktok",
  "vt.tiktok.com": "tiktok",
  "instagram.com": "instagram",
  "m.instagram.com": "instagram",
  "drive.google.com": "drive",
  "streamable.com": "streamable",
  "loom.com": "loom",
  "archive.org": "archive",
  "ia800000.us.archive.org": "archive",
  "dropbox.com": "dropbox",
  "dl.dropboxusercontent.com": "dropbox",
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  vimeo: "Vimeo",
  dailymotion: "Dailymotion",
  twitch: "Twitch",
  tiktok: "TikTok",
  instagram: "Instagram",
  drive: "Google Drive",
  streamable: "Streamable",
  loom: "Loom",
  archive: "Internet Archive",
  dropbox: "Dropbox",
  hls: "HLS stream",
  mp4: "Direct file",
};

const GUIDED: Record<ProviderId, boolean> = {
  youtube: false,
  facebook: true,
  vimeo: true,
  dailymotion: true,
  twitch: true,
  tiktok: true,
  instagram: true,
  drive: true,
  streamable: true,
  loom: true,
  archive: true,
  dropbox: false,
  hls: false,
  mp4: false,
};

function done(
  provider: ProviderId,
  id: string,
  extra?: Partial<ParsedProvider>
): ParsedProvider | null {
  if (!id) return null;
  return {
    provider,
    control: GUIDED[provider] ? "guided" : "full",
    id,
    label: PROVIDER_LABELS[provider],
    ...extra,
  };
}

function parseFacebook(url: string, host: string): ParsedProvider | null {
  const parts = pathParts(url);
  const q = queryOf(url);
  // Short share link carries no id — the embed accepts the share URL itself.
  if (host === "fb.watch") return done("facebook", url.trim());
  const v = q.get("v");
  if (v && /^\d{6,}$/.test(v)) return done("facebook", url.trim());
  const vi = parts.indexOf("videos");
  if (vi >= 0 && parts[vi + 1]) return done("facebook", url.trim());
  if (parts[0] === "reel" && parts[1]) return done("facebook", url.trim());
  return null;
}

function parseVimeo(url: string, host: string): ParsedProvider | null {
  const parts = pathParts(url);
  if (host === "player.vimeo.com" && parts[0] === "video" && /^\d+$/.test(parts[1] || "")) {
    return done("vimeo", parts[1]);
  }
  const numeric = [...parts].reverse().find((p) => /^\d{6,}$/.test(p));
  if (numeric) return done("vimeo", numeric);
  return null;
}

function parseDailymotion(url: string, host: string): ParsedProvider | null {
  const parts = pathParts(url);
  if (host === "dai.ly" && parts[0]) return done("dailymotion", parts[0]);
  const vi = parts.indexOf("video");
  if (vi >= 0 && parts[vi + 1] && /^x[a-z0-9]+$/i.test(parts[vi + 1])) {
    return done("dailymotion", parts[vi + 1]);
  }
  const embed = parts.indexOf("embed");
  if (embed >= 0 && parts[embed + 1] === "video" && parts[embed + 2]) {
    return done("dailymotion", parts[embed + 2]);
  }
  // geo/player share links carry the id as ?video=x...
  const qv = queryOf(url).get("video");
  if (qv && /^x[a-z0-9]+$/i.test(qv)) return done("dailymotion", qv);
  return null;
}

function parseTwitch(url: string): ParsedProvider | null {
  // VODs only (live channels and clips can't be countdown-synced).
  const m = url.match(/twitch\.tv\/videos\/(\d+)/i);
  if (m) return done("twitch", m[1]);
  return null;
}

function parseTiktok(url: string, host: string): ParsedProvider | null {
  const m = url.match(/\/(?:video|v)\/(\d{8,})/);
  if (m) return done("tiktok", m[1]);
  // Short links (vm/vt) resolve via redirect — the embed accepts the URL.
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    return done("tiktok", url.trim());
  }
  return null;
}

function parseInstagram(url: string): ParsedProvider | null {
  const m = url.match(/instagram\.com\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  // The official embed endpoint takes the post URL, so keep it whole.
  if (m) return done("instagram", url.trim().split("?")[0]);
  return null;
}

function parseDrive(url: string): ParsedProvider | null {
  const m = url.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m) return done("drive", m[1]);
  const id = queryOf(url).get("id");
  if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return done("drive", id);
  return null;
}

function parseStreamable(url: string): ParsedProvider | null {
  const parts = pathParts(url);
  // Player paths (/e/, /o/) prefix the id; plain links are the id itself.
  const id = parts[0] === "e" || parts[0] === "o" ? parts[1] : parts[0];
  if (id && /^[a-z0-9]+$/i.test(id) && id.length >= 4) {
    return done("streamable", id);
  }
  return null;
}

function parseLoom(url: string): ParsedProvider | null {
  const m = url.match(/loom\.com\/share\/([a-f0-9]{32})/i);
  if (m) return done("loom", m[1]);
  return null;
}

function parseArchive(url: string): ParsedProvider | null {
  const parts = pathParts(url);
  if (parts[0] === "details" && parts[1]) {
    // Details pages play through the official archive.org embed.
    return done("archive", parts[1]);
  }
  if (parts[0] === "embed" && parts[1]) return done("archive", parts[1]);
  if (
    parts[0] === "download" ||
    parts.includes("items") ||
    /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(url)
  ) {
    // Direct file links play in the normal HTML5 player (full sync).
    return { ...done("archive", url.trim())!, control: "full" };
  }
  return null;
}

function parseDropbox(url: string): ParsedProvider | null {
  // Shared links convert to direct playable links (dl=1 style).
  if (!/dropbox\.com|dropboxusercontent\.com/.test(url)) return null;
  try {
    const u = new URL(url.trim());
    u.searchParams.set("dl", "1");
    u.searchParams.delete("raw");
    return { ...done("dropbox", u.toString())!, control: "full" };
  } catch {
    return null;
  }
}

/**
 * Detect a provider link. Returns null for non-provider URLs (the caller
 * falls back to YouTube/HLS/MP4 detection). Note: a null return for a
 * KNOWN provider host means "recognized but unsupported form".
 */
export function parseProviderUrl(url: string): ParsedProvider | null {
  const trimmed = (url || "").trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const host = hostOf(trimmed);
  const provider = PROVIDER_HOSTS[host];
  if (!provider || provider === "youtube" || provider === "hls" || provider === "mp4") {
    return null;
  }
  switch (provider) {
    case "facebook":
      return parseFacebook(trimmed, host);
    case "vimeo":
      return parseVimeo(trimmed, host);
    case "dailymotion":
      return parseDailymotion(trimmed, host);
    case "twitch":
      return parseTwitch(trimmed);
    case "tiktok":
      return parseTiktok(trimmed, host);
    case "instagram":
      return parseInstagram(trimmed);
    case "drive":
      return parseDrive(trimmed);
    case "streamable":
      return parseStreamable(trimmed);
    case "loom":
      return parseLoom(trimmed);
    case "archive":
      return parseArchive(trimmed);
    case "dropbox":
      return parseDropbox(trimmed);
    default:
      return null;
  }
}

/** True when the URL belongs to a known provider host (even if unparsable). */
export function isKnownProviderHost(url: string): ProviderId | null {
  const host = hostOf(url);
  return (host && PROVIDER_HOSTS[host]) || null;
}

/** Official iframe embed URL for guided providers (null = not embeddable). */
export function embedUrlFor(parsed: ParsedProvider, parentHost?: string): string | null {
  const id = parsed.id;
  switch (parsed.provider) {
    case "facebook":
      return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(id)}&show_text=false`;
    case "vimeo":
      return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : null;
    case "dailymotion":
      return `https://www.dailymotion.com/embed/video/${id}`;
    case "twitch":
      return /^\d+$/.test(id)
        ? `https://player.twitch.tv/?video=${id}&parent=${encodeURIComponent(parentHost || "localhost")}&autoplay=false`
        : null;
    case "tiktok":
      // Numeric ids embed directly; short links (vm/vt) can't resolve
      // without following redirects, so the player links out instead.
      return /^\d+$/.test(id) ? `https://www.tiktok.com/embed/v2/${id}` : null;
    case "instagram":
      return id.startsWith("http") ? `${id.replace(/\/$/, "")}/embed` : null;
    case "drive":
      return `https://drive.google.com/file/d/${id}/preview`;
    case "streamable":
      return `https://streamable.com/e/${id}`;
    case "loom":
      return `https://www.loom.com/embed/${id}`;
    case "archive":
      return id.startsWith("http") ? id : `https://archive.org/embed/${id}`;
    default:
      return null;
  }
}
