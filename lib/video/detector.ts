export type VideoType = "youtube" | "hls" | "mp4" | "localfile";

export interface VideoDetectionResult {
  isValid: boolean;
  type: VideoType | null;
  videoId?: string; // YouTube video ID if applicable
  cleanUrl: string;
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
    };
  }

  // 2. Check HLS (.m3u8 — anywhere in path or query)
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.toLowerCase();
    const hrefLower = parsed.href.toLowerCase();
    const host = parsed.hostname.toLowerCase();
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
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
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
