/**
 * Clarity Engine — client-only video enhancement. No server code, no
 * network, no paid services.
 *
 * Tiers:
 * - off:   untouched video.
 * - light: CSS filter (contrast + saturation lift). Works on every source,
 *          including YouTube/embeds, because it styles the frame, not pixels.
 * - ultra: WebGL canvas pipeline that redraws the native <video> frame with
 *          an edge-aware sharpen + contrast/saturation shader. Native
 *          MP4/HLS/My-Files only, CORS-clean only — anything else falls
 *          back to Light.
 *
 * WebGPU is feature-detected for reporting; WebGL is the render default.
 */

export type ClarityTier = "off" | "light" | "ultra";

/** Light tier: subtle lift that reads as "clearer" without artifacts. */
export const LIGHT_FILTER =
  "contrast(1.08) saturate(1.14) brightness(1.02)";

export interface ClarityCaps {
  webgl: boolean;
  webgpu: boolean;
}

export function clarityCapabilities(): ClarityCaps {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return { webgl: false, webgpu: false };
  }
  let webgl = false;
  try {
    const c = document.createElement("canvas");
    webgl = !!(
      c.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
      c.getContext("webgl", { failIfMajorPerformanceCaveat: true })
    );
  } catch {
    webgl = false;
  }
  let webgpu = false;
  try {
    webgpu =
      typeof (navigator as Navigator & { gpu?: unknown }).gpu !== "undefined";
  } catch {
    webgpu = false;
  }
  return { webgl, webgpu };
}

/** Ultra needs real pixels: native video only (never iframes). */
export function ultraSupportedFor(videoType: string): boolean {
  return videoType === "mp4" || videoType === "hls" || videoType === "localfile";
}

/** 3s perf gate: below ~24fps (or stalled) the device can't hold Ultra. */
export function ultraPerfOk(frames: number, elapsedMs: number): boolean {
  if (elapsedMs < 2500 || frames < 12) return false;
  return frames / (elapsedMs / 1000) >= 24;
}
