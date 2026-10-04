/**
 * Room code helpers — shared by the lobby join box and the room page.
 * Codes are the 6-char nanoid slugs (lowercase alnum). Users paste either
 * the bare code or a full invite URL — both resolve to the same slug.
 */

export function extractRoomCode(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;
  // Full URL? Take the last path segment (…/room/abc123?x=…).
  const urlMatch = input.match(/\/room\/([A-Za-z0-9_-]{4,16})/);
  if (urlMatch) return urlMatch[1].toLowerCase();
  const bare = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (bare.length >= 4 && bare.length <= 16) return bare;
  return null;
}

export function isValidRoomCode(code: string): boolean {
  return /^[a-z0-9]{4,16}$/.test(code);
}

/**
 * Canonical site origin. NEXT_PUBLIC_SITE_URL wins so invite links, QR
 * codes, and shares always point at production
 * (https://peermates.vercel.app) even when the host is browsing localhost.
 * Falls back to the current origin (local dev without the env var).
 */
export function siteOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  if (configured) return configured;
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return "";
}

export function roomUrl(code: string): string {
  return `${siteOrigin()}/room/${code}`;
}

export function replayLink(id: string): string {
  return `${siteOrigin()}/replay/${id}`;
}

export function whatsappShareUrl(code: string, title?: string): string {
  const text = `Join my PeerMates party${title ? ` "${title}"` : ""}: ${roomUrl(code)}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function qrImageUrl(code: string, size = 192): string {
  // Free, no-key QR image (no npm dep, no server cost).
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(roomUrl(code))}`;
}
