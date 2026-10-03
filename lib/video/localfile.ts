/**
 * "My Files" (bring-your-own-video) helpers.
 *
 * Nothing is ever uploaded: each person plays the same movie from their own
 * device via URL.createObjectURL + the native <video> element, so multi-GB
 * files work without ever reading the whole file into memory. Only tiny
 * data (the fingerprint below + playback timestamps) travels the network.
 *
 * NOTE: no "use client" directive on purpose — server routes import the
 * fingerprint *validation* below. Nothing touches the DOM at module scope.
 */

export interface LocalFingerprint {
  v: 1;
  /** Original file name (display only). */
  name: string;
  /** File size in bytes. */
  size: number;
  /** Duration in seconds (from metadata). */
  duration: number;
  /** Browser-reported MIME type (may be empty). */
  mime: string;
  /** SHA-256 hex of [first 1MB, middle 1MB, last 1MB]. */
  chunks: [string, string, string];
  /** Short id derived from the fingerprint (used in videoSource). */
  fpId: string;
}

/** Bytes hashed per sample — the whole file is NEVER read into memory. */
export const CHUNK_BYTES = 1024 * 1024;
/** Duration tolerance (seconds) when comparing two fingerprints. */
export const DURATION_TOLERANCE = 1.5;
/** Max P2P "Stream from host" receivers (mesh does not scale further). */
export const P2P_MAX_RECEIVERS = 8;

export const RIGHTS_NOTICE =
  "Only play content you have the right to use — your own videos or files you are licensed to play. Nothing is uploaded; playback happens locally on your device.";

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  if (!crypto?.subtle) {
    throw new Error("WebCrypto is unavailable (needs HTTPS or localhost).");
  }
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256OfString(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

function readSlice(file: File, start: number, length: number): Promise<ArrayBuffer> {
  const end = Math.min(file.size, start + length);
  return file.slice(start, end).arrayBuffer();
}

function probeDuration(file: File, objectUrl: string, timeoutMs = 15000): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    const timer = window.setTimeout(() => {
      video.removeAttribute("src");
      reject(new Error("Timed out reading video metadata."));
    }, timeoutMs);
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const d = video.duration;
      video.removeAttribute("src");
      if (!Number.isFinite(d) || d <= 0) {
        reject(new Error("Could not read this file's duration."));
      } else {
        resolve(d);
      }
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("This browser cannot decode the file's metadata."));
    };
    video.src = objectUrl;
  });
}

export interface FingerprintProgress {
  stage: "metadata" | "hashing" | "done";
  /** 0..1 across the hashing stage. */
  fraction: number;
}

/**
 * Fingerprint a file WITHOUT reading it fully into memory: metadata
 * duration plus SHA-256 of three 1MB slices (first / middle / last).
 * Works for multi-GB movies; shows progress for the (fast) hashing stage.
 */
export async function fingerprintFile(
  file: File,
  onProgress?: (p: FingerprintProgress) => void
): Promise<LocalFingerprint> {
  if (!file || file.size === 0) {
    throw new Error("That file looks empty. Pick a video file to continue.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    onProgress?.({ stage: "metadata", fraction: 0 });
    const duration = await probeDuration(file, objectUrl);

    const mid = Math.max(0, Math.floor(file.size / 2 - CHUNK_BYTES / 2));
    const starts = [0, mid, Math.max(0, file.size - CHUNK_BYTES)];
    const hashes: string[] = [];
    for (let i = 0; i < starts.length; i++) {
      onProgress?.({ stage: "hashing", fraction: i / starts.length });
      const buf = await readSlice(file, starts[i], CHUNK_BYTES);
      hashes.push(await sha256Hex(buf));
    }
    onProgress?.({ stage: "hashing", fraction: 1 });

    const fpId = (
      await sha256OfString(
        `${file.size}|${duration.toFixed(3)}|${hashes[0]}|${hashes[1]}|${hashes[2]}`
      )
    ).slice(0, 12);

    onProgress?.({ stage: "done", fraction: 1 });
    return {
      v: 1,
      name: file.name,
      size: file.size,
      duration,
      mime: file.type || "",
      chunks: [hashes[0], hashes[1], hashes[2]],
      fpId,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export interface FingerprintComparison {
  match: boolean;
  reasons: string[];
}

/** Shape-check a client-supplied fingerprint (server-side gate). */
export function isValidFingerprint(fp: unknown): fp is LocalFingerprint {
  if (!fp || typeof fp !== "object") return false;
  const r = fp as Record<string, unknown>;
  if (r.v !== 1) return false;
  if (typeof r.name !== "string" || r.name.length === 0 || r.name.length > 255)
    return false;
  if (typeof r.size !== "number" || !(r.size > 0) || r.size > 100 * 1024 ** 3)
    return false;
  if (
    typeof r.duration !== "number" ||
    !(r.duration > 0) ||
    r.duration > 24 * 3600
  )
    return false;
  if (typeof r.mime !== "string" || r.mime.length > 128) return false;
  if (!Array.isArray(r.chunks) || r.chunks.length !== 3) return false;
  if (!r.chunks.every((c) => typeof c === "string" && /^[0-9a-f]{64}$/.test(c)))
    return false;
  if (typeof r.fpId !== "string" || !/^[0-9a-f]{12}$/.test(r.fpId)) return false;
  return true;
}

/** Compare a viewer's file against the host fingerprint. */
export function compareFingerprints(
  host: LocalFingerprint,
  mine: LocalFingerprint
): FingerprintComparison {
  const reasons: string[] = [];
  if (host.size !== mine.size) {
    reasons.push(
      `Size differs (host ${formatBytes(host.size)} vs yours ${formatBytes(mine.size)}).`
    );
  }
  if (Math.abs(host.duration - mine.duration) > DURATION_TOLERANCE) {
    reasons.push(
      `Duration differs (host ${formatDuration(host.duration)} vs yours ${formatDuration(mine.duration)}).`
    );
  }
  const chunkNames = ["start", "middle", "end"] as const;
  host.chunks.forEach((h, i) => {
    if (mine.chunks[i] !== h) {
      reasons.push(`Content differs near the ${chunkNames[i]} of the file.`);
    }
  });
  return { match: reasons.length === 0, reasons };
}

// ---- Compatibility pre-flight ----

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = (navigator as Navigator & { platform?: string }).platform || "";
  const maxTouch = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints || 0;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && maxTouch > 1) // iPadOS desktop-mode Safari
  );
}

export function isSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
}

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogm: 'video/ogg',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
};

export function guessMime(fileName: string, reportedType: string): string {
  if (reportedType) return reportedType;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return EXT_MIME[ext] || "";
}

export interface PreflightResult {
  playable: boolean;
  /** "yes" | "maybe" | "" from canPlayType, plus metadata outcome. */
  canPlay: string;
  mime: string;
  ext: string;
  isiOS: boolean;
  duration: number | null;
  /** Fatal problem — do not attempt playback. */
  fatal: string | null;
  /** Non-fatal heads-up shown alongside success. */
  warning: string | null;
  /** Actionable fix tip shown when not playable. */
  tip: string | null;
}

/**
 * Before joining with a local file: check canPlayType + metadata load.
 * Never throws — returns a result with messages the UI renders.
 */
export async function preflightFile(file: File): Promise<PreflightResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const mime = guessMime(file.name, file.type);
  const isiOS = isIOS();
  const base: Omit<PreflightResult, "playable" | "canPlay" | "duration" | "fatal" | "warning" | "tip"> = {
    mime,
    ext,
    isiOS,
  };

  // Known-bad containers up front with a clear fix tip.
  if (isiOS && (ext === "mkv" || mime === "video/x-matroska")) {
    return {
      ...base,
      playable: false,
      canPlay: "",
      duration: null,
      fatal: "iPhone Safari cannot play MKV files.",
      warning: null,
      tip: "Fix: remux to MP4 (e.g. free HandBrake or ffmpeg -c copy) — no re-encode needed — then pick the .mp4 here.",
    };
  }
  if (isiOS && (ext === "avi" || mime === "video/x-msvideo")) {
    return {
      ...base,
      playable: false,
      canPlay: "",
      duration: null,
      fatal: "iPhone Safari cannot play AVI files.",
      warning: null,
      tip: "Fix: convert to MP4 (H.264 + AAC) with HandBrake or VLC, then pick the .mp4 here.",
    };
  }
  if (isiOS && (ext === "webm" || mime === "video/webm")) {
    return {
      ...base,
      playable: false,
      canPlay: "",
      duration: null,
      fatal: "iPhone Safari cannot play WebM files.",
      warning: null,
      tip: "Fix: convert to MP4 (H.264 + AAC), or ask the host for an MP4 copy.",
    };
  }

  let canPlay = "";
  try {
    const probe = document.createElement("video");
    if (mime && typeof probe.canPlayType === "function") {
      canPlay = probe.canPlayType(mime).replace(/no/g, "");
    }
  } catch {
    canPlay = "";
  }

  // HEVC heads-up: some iPhones handle it, older ones and Chrome-on-iOS do not.
  let warning: string | null = null;
  if ((ext === "mov" || ext === "mp4" || ext === "m4v") && !canPlay) {
    try {
      const probe = document.createElement("video");
      const hevc = probe.canPlayType('video/mp4; codecs="hvc1"');
      if (!hevc) {
        warning =
          "This device reports no HEVC support — if this file is HEVC/H.265 it may not play. An H.264 MP4 is the safest choice.";
      }
    } catch {
      // ignore
    }
  }

  // Metadata load = the real proof the browser can open this file.
  const objectUrl = URL.createObjectURL(file);
  try {
    const duration = await probeDuration(file, objectUrl);
    const playable = canPlay !== "" || Number.isFinite(duration);
    if (!playable) {
      return {
        ...base,
        playable: false,
        canPlay,
        duration: null,
        fatal: "This browser refused to open the file.",
        warning: null,
        tip: isiOS
          ? "Fix: use an MP4 (H.264 + AAC) file — iPhone Safari plays those natively."
          : "Fix: try an MP4 (H.264 + AAC) file, or open this room in Chrome.",
      };
    }
    return {
      ...base,
      playable: true,
      canPlay: canPlay || "maybe",
      duration,
      fatal: null,
      tip: null,
      warning:
        warning ||
        (isiOS
          ? "iPhone note: playback starts only after you tap play (iOS blocks autoplay with sound), and fullscreen uses the native player."
          : null),
    };
  } catch (err) {
    return {
      ...base,
      playable: false,
      canPlay,
      duration: null,
      fatal:
        err instanceof Error
          ? err.message
          : "Could not read this file.",
      warning: null,
      tip: isiOS
        ? "Fix: use an MP4 (H.264 + AAC) file. MKV / AVI / WebM never play on iPhone Safari."
        : "Fix: make sure the file isn't corrupt, then try an MP4 (H.264 + AAC).",
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// ---- Small formatting + object-URL helpers ----

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Create a blob: URL for local playback. Revoke with revokeLocalObjectUrl. */
export function createLocalObjectUrl(file: File): string {
  return URL.createObjectURL(file);
}

export function revokeLocalObjectUrl(url: string | null): void {
  if (url && url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // already revoked
    }
  }
}

export const LOCAL_FILE_ACCEPT =
  "video/*,.mkv,.avi,.mov,.m4v,.mp4,.webm,.ogv,.ogm";
