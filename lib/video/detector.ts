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
    const regExp =
      /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = trimmed.match(regExp);
    return match && match[1].length === 11 ? match[1] : null;
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

  // 2. Check HLS (.m3u8)
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.endsWith(".m3u8") || parsed.href.includes(".m3u8")) {
      return {
        isValid: true,
        type: "hls",
        cleanUrl: trimmed,
      };
    }

    // 3. Check MP4/WebM direct video
    if (
      pathname.endsWith(".mp4") ||
      pathname.endsWith(".webm") ||
      pathname.endsWith(".mov") ||
      pathname.endsWith(".m4v")
    ) {
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
