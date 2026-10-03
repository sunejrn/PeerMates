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

export function roomUrl(code: string): string {
  const base =
    typeof window !== "undefined" ? window.location.origin : "";
  return `${base}/room/${code}`;
}

export function whatsappShareUrl(code: string, title?: string): string {
  const text = `Join my SyncMe watch party${title ? ` "${title}"` : ""}: ${roomUrl(code)}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function qrImageUrl(code: string, size = 192): string {
  // Free, no-key QR image (no npm dep, no server cost).
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(roomUrl(code))}`;
}
