/**
 * Per-device "All Rooms" history (localStorage, no signup needed).
 *
 * Every room visit records { slug, title, videoType, hostName, lastVisit }.
 * The All Rooms page lists them newest-first; entries auto-expire after
 * 30 days when the settings toggle `autoDeleteRooms` is ON (default).
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

function readAll(): RoomHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RoomHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.slug === "string");
  } catch {
    return [];
  }
}

function writeAll(list: RoomHistoryEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
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

export function recordRoomVisit(entry: {
  slug: string;
  title: string;
  videoType?: string;
  hostName?: string;
}): void {
  if (typeof window === "undefined" || !entry.slug) return;
  const now = Date.now();
  const list = readAll();
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
  writeAll(list);
}

/** Newest-first, with 30-day expiry applied when the toggle is ON. */
export function getRoomHistory(): RoomHistoryEntry[] {
  const now = Date.now();
  const list = readAll();
  if (autoDeleteEnabled()) {
    const fresh = list.filter((e) => now - e.lastVisit < ROOM_TTL_MS);
    if (fresh.length !== list.length) writeAll(fresh);
    return fresh.sort((a, b) => b.lastVisit - a.lastVisit);
  }
  return [...list].sort((a, b) => b.lastVisit - a.lastVisit);
}

export function deleteRoomFromHistory(slug: string): void {
  writeAll(readAll().filter((e) => e.slug !== slug));
}

export function clearRoomHistory(): void {
  writeAll([]);
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
