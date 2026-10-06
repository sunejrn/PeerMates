import {
  embedUrlFor,
  isKnownProviderHost,
  parseProviderUrl,
  PROVIDER_LABELS,
  type ControlLevel,
  type ProviderId,
} from "./parseUrl";

export type VideoType = "youtube" | "hls" | "mp4" | "localfile" | "embed";

export interface VideoDetectionResult {
  isValid: boolean;
  type: VideoType | null;
  videoId?: string; // YouTube video ID if applicable
  cleanUrl: string;
  /** Provider classification for embed/guided sources. */
  provider?: ProviderId;
  providerId?: string;
  control?: ControlLevel;
  /** Friendly reason when a known provider link isn't usable. */
  detail?: string;
}

/**
 * "My Files" (bring-your-own-video) rooms. The actual bytes stay on each
 * person's device — nothing is uploaded. videoSource stores a stable
 * `localfile:<fpId>` pointer while the full fingerprint (size, duration,
 * chunk hashes) lives in Redis for viewers to compare against.
 */
export const LOCALFILE_PREFIX = "localfile:";

export function isLocalFileSource(src: string): boolean {
  return typeof src === "string" && src.startsWith(LOCALFILE_PREFIX);
}

export function localFileSourceFor(fpId: string): string {
  return `${LOCALFILE_PREFIX}${fpId}`;
}

export function localFileFpId(src: string): string | null {
  if (!isLocalFileSource(src)) return null;
  const id = src.slice(LOCALFILE_PREFIX.length).trim();
  return id ? id : null;
}

/**
 * Embedded/guided sources. videoSource stores `embed:<provider>:<id>` — the
 * id is encodeURIComponent'd, decoded with parseEmbedSource(). The iframe
 * URL is rebuilt client-side from the id (official embeds only).
 */
export const EMBED_PREFIX = "embed:";

export function isEmbedSource(src: string): boolean {
  return typeof src === "string" && src.startsWith(EMBED_PREFIX);
}

export function embedSourceFor(provider: ProviderId, id: string): string {
  return `${EMBED_PREFIX}${provider}:${encodeURIComponent(id)}`;
}

export function parseEmbedSource(src: string): { provider: ProviderId; id: string } | null {
  if (!isEmbedSource(src)) return null;
  const rest = src.slice(EMBED_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const provider = rest.slice(0, sep) as ProviderId;
  const id = decodeURIComponent(rest.slice(sep + 1));
  if (!provider || !id) return null;
  return { provider, id };
}

/** Provider label + sync level for chips (picker, room info, badges). */
export function describeSource(
  videoType: VideoType,
  videoSource: string
): { label: string; control: ControlLevel } {
  if (videoType === "localfile") return { label: "My File", control: "full" };
  if (videoType === "embed") {
    const e = parseEmbedSource(videoSource);
    if (e) return { label: PROVIDER_LABELS[e.provider] ?? e.provider, control: "guided" };
    return { label: "Embed", control: "guided" };
  }
  if (videoType === "youtube") return { label: "YouTube", control: "full" };
  if (videoType === "hls") return { label: "HLS stream", control: "full" };
  return { label: "Direct file", control: "full" };
}

export function extractYouTubeId(url: string): string | null {
  try {
    const trimmed = url.trim();
    // Patterns:
    // youtube.com/watch?v=ID
    // youtu.be/ID
    // youtube.com/embed/ID
    // youtube.com/v/ID
    // youtube.com/shorts/ID
    // youtube.com/live/ID
    // music.youtube.com/watch?v=ID
    // youtube-nocookie.com/embed/ID
    const regExp =
      /(?:youtube(?:-nocookie)?\.com\/(?:shorts\/|live\/|embed\/|v\/|[^?#]*[?&]v=|[^?#]*\/)|youtu\.be\/|music\.youtube\.com\/(?:watch\?.*[?&]v=|shorts\/))([^"&?#\/\s]{11})/;
    const match = trimmed.match(regExp);
    if (match && match[1].length === 11) return match[1];
    // Fallback: explicit v= query param parse (covers playlists, si tokens, etc.)
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      if (host.includes("youtube.com") || host.includes("youtu.be")) {
        if (host === "youtu.be" || host.endsWith(".youtu.be")) {
          const id = parsed.pathname.split("/").filter(Boolean)[0];
          if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
        }
        const v = parsed.searchParams.get("v");
        if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      }
    } catch {
      // ignore URL parse failure — regex already tried
    }
    return null;
  } catch {
    return null;
  }
}

/** Friendly guidance when a known provider link isn't usable. */export function providerHint(provider: ProviderId): string {
  switch (provider) {
    case "twitch":
      return "Only Twitch past broadcasts (twitch.tv/videos/…) work — live channels and clips can't sync.";
    case "drive":
      return "That Google Drive link isn't a file preview — use Share → Copy link on the file itself.";
    case "facebook":
      return "This Facebook video can't be embedded. Ask the owner to make it public, then paste the video link.";
    default:
      return "That link isn't a supported video page — paste a full video link from the provider.";
  }
}

export function detectVideoSource(url: string): VideoDetectionResult {
  const trimmed = url.trim();
  if (!trimmed) {
    return { isValid: false, type: null, cleanUrl: "" };
  }

  // 1. Check YouTube
  const ytId = extractYouTubeId(trimmed);
  if (ytId) {
    return {
      isValid: true,
      type: "youtube",
      videoId: ytId,
      cleanUrl: `https://www.youtube.com/watch?v=${ytId}`,
      provider: "youtube",
      control: "full",
    };
  }

  // 2. Provider links (Facebook, Vimeo, TikTok, Drive, …). Full-control
  //    resolutions (Dropbox direct, Archive files) become plain mp4 rooms;
  //    everything else becomes an embed/guided room.
  const parsed = parseProviderUrl(trimmed);
  if (parsed) {
    if (parsed.provider === "dropbox" || parsed.provider === "archive") {
      if (parsed.control === "full") {
        return {
          isValid: true,
          type: "mp4",
          cleanUrl: parsed.id,
          provider: parsed.provider,
          control: "full",
        };
      }
    }
    if (parsed.control === "guided") {
      if (!embedUrlFor(parsed)) {
        return {
          isValid: false,
          type: null,
          cleanUrl: trimmed,
          provider: parsed.provider,
          detail:
            "That link can't be embedded here — open the video in its app and paste a full video link instead.",
        };
      }
      return {
        isValid: true,
        type: "embed",
        cleanUrl: embedSourceFor(parsed.provider, parsed.id),
        provider: parsed.provider,
        providerId: parsed.id,
        control: "guided",
      };
    }
  }
  // Known provider host, but an unsupported form (live Twitch, TikTok clip…).
  const knownHost = isKnownProviderHost(trimmed);
  if (knownHost && knownHost !== "youtube") {
    return {
      isValid: false,
      type: null,
      cleanUrl: trimmed,
      provider: knownHost,
      detail: providerHint(knownHost),
    };
  }

  // 2. Check HLS (.m3u8 — anywhere in path or query)
  try {
    const parsedUrl = new URL(trimmed);
    const pathname = parsedUrl.pathname.toLowerCase();
    const hrefLower = parsedUrl.href.toLowerCase();
    const host = parsedUrl.hostname.toLowerCase();
    if (pathname.endsWith(".m3u8") || hrefLower.includes(".m3u8")) {
      return {
        isValid: true,
        type: "hls",
        cleanUrl: trimmed,
      };
    }

    // Googlevideo progressive links (YouTube "as MP4" extractions) carry no
    // file extension — mime=video/mp4 or an .mp4 signature in the URL.
    const looksLikeMp4 =
      pathname.endsWith(".mp4") ||
      pathname.endsWith(".webm") ||
      pathname.endsWith(".mov") ||
      pathname.endsWith(".m4v") ||
      pathname.endsWith(".ogv") ||
      pathname.endsWith(".ogm") ||
      host.includes("googlevideo.com") ||
      hrefLower.includes("mime=video%2fmp4") ||
      hrefLower.includes("mime=video/mp4") ||
      /[?&](format|filetype|ext)=mp4\b/.test(hrefLower);

    // 3. Check MP4/WebM direct video (extension OR googlevideo-style link)
    if (looksLikeMp4) {
      return {
        isValid: true,
        type: "mp4",
        cleanUrl: trimmed,
      };
    }

    // Fallback: If it's a valid HTTP(S) URL, default to MP4 direct video attempt
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      return {
        isValid: true,
        type: "mp4",
        cleanUrl: trimmed,
      };
    }
  } catch {
    return { isValid: false, type: null, cleanUrl: trimmed };
  }

  return { isValid: false, type: null, cleanUrl: trimmed };
}
