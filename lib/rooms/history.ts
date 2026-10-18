/**
 * Per-user "All Rooms" history (localStorage).
 *
 * Every room visit records { slug, title, videoType, hostName, lastVisit }.
 * The All Rooms page lists them newest-first; entries auto-expire after
 * 30 days when the settings toggle `autoDeleteRooms` is ON (default).
 *
 * History is bucketed by a scope so each account only ever sees its own
 * rooms (a signed-in user's rooms are keyed by their user id; guests fall
 * back to their per-device guest id).
 */

export interface RoomHistoryEntry {
  slug: string;
  title: string;
  videoType?: string;
  hostName?: string;
  /** First visit timestamp (ms). */
  createdAt: number;
  /** Most recent visit timestamp (ms). */
  lastVisit: number;
}

const KEY = "peermates:rooms:v1";
export const ROOM_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SETTINGS_KEY = "peermates:settings:v1";
const GUEST_ID_KEY = "syncme_guest_id";

/** Storage bucket for a scope. User-scoped so each account's rooms stay
 *  private even on a shared device; the base key is only the anonymous
 *  fallback (never shown by the auth-gated All Rooms page). */
function storageKey(scope?: string | null): string {
  return scope ? `${KEY}:u:${scope}` : KEY;
}

/** Resolve the history scope: the signed-in user id, else the device guest id. */
export function resolveRoomScope(userId?: string | null): string | null {
  if (userId) return userId;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(GUEST_ID_KEY);
  } catch {
    return null;
  }
}

function readAll(scope?: string | null): RoomHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RoomHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.slug === "string");
  } catch {
    return [];
  }
}

function writeAll(list: RoomHistoryEntry[], scope?: string | null): void {
  try {
    window.localStorage.setItem(
      storageKey(scope),
      JSON.stringify(list.slice(0, 200))
    );
  } catch {
    // storage full/blocked — history is best-effort
  }
}

function autoDeleteEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return true; // default ON
    const parsed = JSON.parse(raw) as { autoDeleteRooms?: boolean };
    return parsed.autoDeleteRooms !== false;
  } catch {
    return true;
  }
}

export function recordRoomVisit(
  entry: {
    slug: string;
    title: string;
    videoType?: string;
    hostName?: string;
  },
  scope?: string | null
): void {
  if (typeof window === "undefined" || !entry.slug) return;
  const now = Date.now();
  const list = readAll(scope);
  const idx = list.findIndex((e) => e.slug === entry.slug);
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      title: entry.title || list[idx].title,
      videoType: entry.videoType ?? list[idx].videoType,
      hostName: entry.hostName ?? list[idx].hostName,
      lastVisit: now,
    };
  } else {
    list.unshift({
      slug: entry.slug,
      title: entry.title || `Room ${entry.slug}`,
      videoType: entry.videoType,
      hostName: entry.hostName,
      createdAt: now,
      lastVisit: now,
    });
  }
  writeAll(list, scope);
}

/** Newest-first, with 30-day expiry applied when the toggle is ON. */
export function getRoomHistory(scope?: string | null): RoomHistoryEntry[] {
  const now = Date.now();
  const list = readAll(scope);
  if (autoDeleteEnabled()) {
    const fresh = list.filter((e) => now - e.lastVisit < ROOM_TTL_MS);
    if (fresh.length !== list.length) writeAll(fresh, scope);
    return fresh.sort((a, b) => b.lastVisit - a.lastVisit);
  }
  return [...list].sort((a, b) => b.lastVisit - a.lastVisit);
}

export function deleteRoomFromHistory(
  slug: string,
  scope?: string | null
): void {
  writeAll(
    readAll(scope).filter((e) => e.slug !== slug),
    scope
  );
}

export function clearRoomHistory(scope?: string | null): void {
  writeAll([], scope);
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo <= 1 ? "a month ago" : `${mo}mo ago`;
}
