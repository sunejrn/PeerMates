"use client";

/**
 * Chat media helpers: MediaRecorder mime picking (Opus/WebM on Android,
 * AAC/MP4 on iOS Safari), client-side image compression, waveform peaks,
 * file size limits + type icons.
 */

export const VOICE_MAX_SECONDS = 60;
export const VOICE_MIN_SECONDS = 1;
export const IMAGE_MAX_DIM = 1280;
export const IMAGE_QUALITY = 0.72;
/** Generic file attachments (Stream CDN path). */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Inline data: URL fallback when Stream is unreachable (keeps Redis tiny). */
export const INLINE_MAX_BYTES = 200 * 1024;

export function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  // iOS Safari: no WebM/Opus — AAC inside MP4 works.
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/aac",
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // ignore
    }
  }
  return "";
}

export function audioExtension(mime: string): string {
  if (mime.includes("mp4") || mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

/** Evenly-sampled 0..1 peaks for waveform rendering (no download needed). */
export function peaksFromSamples(
  samples: Float32Array | number[],
  bars = 40
): number[] {
  const out: number[] = [];
  if (samples.length === 0) return out;
  const per = Math.max(1, Math.floor(samples.length / bars));
  for (let i = 0; i < bars; i++) {
    let max = 0;
    const start = i * per;
    for (let j = start; j < Math.min(start + per, samples.length); j += 4) {
      const v = Math.abs(samples[j] ?? 0);
      if (v > max) max = v;
    }
    out.push(Math.min(1, max * 1.6));
  }
  // Normalize so the loudest bar hits ~1.
  const peak = Math.max(...out, 0.01);
  return out.map((v) => Math.round((v / peak) * 100) / 100);
}

/**
 * Compress an image client-side (never upload the raw camera file):
 * max 1280px, JPEG 0.72. Reports progress through the (fast) stages.
 */
export async function compressImage(
  file: File,
  onProgress?: (stage: "decode" | "encode", fraction: number) => void
): Promise<{ blob: Blob; width: number; height: number }> {
  onProgress?.("decode", 0);
  const bitmap = await createImageBitmap(file);
  try {
    onProgress?.("decode", 1);
    const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable.");
    ctx.drawImage(bitmap, 0, 0, width, height);
    onProgress?.("encode", 0.5);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", IMAGE_QUALITY)
    );
    onProgress?.("encode", 1);
    if (!blob) throw new Error("Image compression failed.");
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Type icon + label for a generic file attachment. */
export function fileIcon(name: string, mime = ""): { icon: string; label: string } {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (["pdf"].includes(ext) || mime === "application/pdf")
    return { icon: "📕", label: "PDF" };
  if (["doc", "docx", "odt", "rtf", "txt", "md"].includes(ext))
    return { icon: "📝", label: "Document" };
  if (["xls", "xlsx", "csv", "ods"].includes(ext))
    return { icon: "📊", label: "Spreadsheet" };
  if (["ppt", "pptx", "odp", "key"].includes(ext))
    return { icon: "📽️", label: "Slides" };
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext))
    return { icon: "🗜️", label: "Archive" };
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(ext))
    return { icon: "🎵", label: "Audio" };
  if (["mp4", "mov", "mkv", "webm", "avi"].includes(ext))
    return { icon: "🎬", label: "Video" };
  if (["jpg", "jpeg", "png", "gif", "heic", "webp", "avif", "bmp"].includes(ext))
    return { icon: "🖼️", label: "Image" };
  return { icon: "📎", label: "File" };
}
