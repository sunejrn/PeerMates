import { redis } from "./client";
import { appendMessage, getMessages } from "./chat";
import { getSettings, setSettings } from "./roles";
import { broadcastRoomEvent } from "@/lib/stream/server";
import { checkChatGuard } from "@/lib/guard/engine";
import type { ChatMessage } from "@/lib/stream/realtimeClient";
import { nanoid } from "nanoid";

/**
 * Chat Guard state (Upstash Redis + in-memory dev fallback).
 *
 * Keys:
 * - room:{slug}:guard:hidden    hash msgId -> reason (collapsed bars)
 * - room:{slug}:guard:flood     counter of hides in the last 60s
 * - room:{slug}:guard:settings  {enabled, sensitivity, autoSlowUntil, autoSlowPrev}
 * - room:{slug}:guard:viewed    set of view-once msgIds already opened
 */

export type GuardSensitivity = "low" | "medium" | "high";

export interface GuardSettings {
  enabled: boolean;
  sensitivity: GuardSensitivity;
  /** Epoch ms until which auto slow-mode holds (0 = none). */
  autoSlowUntil: number;
  /** Slow-mode value to restore when auto slow-mode expires. */
  autoSlowPrev: number;
}

const HIDDEN_KEY = (slug: string) => `room:${slug}:guard:hidden`;
const FLOOD_KEY = (slug: string) => `room:${slug}:guard:flood`;
const SETTINGS_KEY = (slug: string) => `room:${slug}:guard:settings`;
const VIEWED_KEY = (slug: string) => `room:${slug}:guard:viewed`;

const SETTINGS_TTL = 60 * 60 * 24 * 7; // 7 days
const HIDDEN_TTL = 86400; // 24h, like chat
const FLOOD_WINDOW = 60; // seconds
export const FLOOD_SLOWMO_THRESHOLD = 5; // hides/min before auto slow-mode
export const AUTO_SLOW_SECONDS = 15;
export const AUTO_SLOW_MS = 2 * 60 * 1000; // 2 minutes

const DEFAULTS: GuardSettings = {
  enabled: true,
  sensitivity: "medium",
  autoSlowUntil: 0,
  autoSlowPrev: 0,
};

const memHidden = new Map<string, Map<string, string>>();
const memFlood = new Map<string, { count: number; resetAt: number }>();
const memSettings = new Map<string, GuardSettings>();
const memViewed = new Map<string, Set<string>>();

function validSensitivity(s: unknown): GuardSensitivity {
  return s === "low" || s === "medium" || s === "high" ? s : "medium";
}

// ---- Settings ----

export async function getGuardSettings(slug: string): Promise<GuardSettings> {
  if (redis) {
    try {
      const raw = await redis.get<string | GuardSettings>(SETTINGS_KEY(slug));
      if (!raw) return { ...DEFAULTS };
      const p = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        enabled: p.enabled !== false,
        sensitivity: validSensitivity(p.sensitivity),
        autoSlowUntil: typeof p.autoSlowUntil === "number" ? p.autoSlowUntil : 0,
        autoSlowPrev: typeof p.autoSlowPrev === "number" ? p.autoSlowPrev : 0,
      };
    } catch (err) {
      console.warn("Redis getGuardSettings failed, using memory:", err);
    }
  }
  return { ...(memSettings.get(slug) ?? DEFAULTS) };
}

export async function setGuardSettings(
  slug: string,
  patch: Partial<Pick<GuardSettings, "enabled" | "sensitivity" | "autoSlowUntil" | "autoSlowPrev">>
): Promise<GuardSettings> {
  const cur = await getGuardSettings(slug);
  const next: GuardSettings = {
    enabled: patch.enabled ?? cur.enabled,
    sensitivity: patch.sensitivity ? validSensitivity(patch.sensitivity) : cur.sensitivity,
    autoSlowUntil: patch.autoSlowUntil ?? cur.autoSlowUntil,
    autoSlowPrev: patch.autoSlowPrev ?? cur.autoSlowPrev,
  };
  if (redis) {
    try {
      await redis.set(SETTINGS_KEY(slug), JSON.stringify(next), { ex: SETTINGS_TTL });
      return next;
    } catch (err) {
      console.warn("Redis setGuardSettings failed, using memory:", err);
    }
  }
  memSettings.set(slug, next);
  return next;
}

// ---- Hidden flags ----

export async function markHidden(slug: string, messageId: string, reason: string): Promise<void> {
  if (redis) {
    try {
      await redis.hset(HIDDEN_KEY(slug), { [messageId]: reason.slice(0, 160) });
      await redis.expire(HIDDEN_KEY(slug), HIDDEN_TTL);
      return;
    } catch (err) {
      console.warn("Redis markHidden failed, using memory:", err);
    }
  }
  let m = memHidden.get(slug);
  if (!m) {
    m = new Map();
    memHidden.set(slug, m);
  }
  m.set(messageId, reason.slice(0, 160));
}

export async function unhideMessage(slug: string, messageId: string): Promise<void> {
  if (redis) {
    try {
      await redis.hdel(HIDDEN_KEY(slug), messageId);
      return;
    } catch (err) {
      console.warn("Redis unhideMessage failed, using memory:", err);
    }
  }
  memHidden.get(slug)?.delete(messageId);
}

export async function getHiddenMap(slug: string): Promise<Record<string, string>> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(HIDDEN_KEY(slug));
      if (!raw) return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string" && v) out[k] = v;
        else if (v != null) out[k] = String(v);
      }
      return out;
    } catch (err) {
      console.warn("Redis getHiddenMap failed, using memory:", err);
    }
  }
  return Object.fromEntries(memHidden.get(slug)?.entries() ?? []);
}

// ---- Flood counter (hides in the last 60s) ----

export async function recordHideAndGetFlood(slug: string): Promise<number> {
  if (redis) {
    try {
      const count = await redis.incr(FLOOD_KEY(slug));
      if (count === 1) await redis.expire(FLOOD_KEY(slug), FLOOD_WINDOW);
      return count;
    } catch (err) {
      console.warn("Redis flood incr failed, using memory:", err);
    }
  }
  const now = Date.now();
  const cur = memFlood.get(slug);
  if (!cur || cur.resetAt <= now) {
    memFlood.set(slug, { count: 1, resetAt: now + FLOOD_WINDOW * 1000 });
    return 1;
  }
  cur.count += 1;
  return cur.count;
}

// ---- View-once burns ----

export async function markViewedOnce(slug: string, messageId: string): Promise<void> {
  if (redis) {
    try {
      await redis.sadd(VIEWED_KEY(slug), messageId);
      await redis.expire(VIEWED_KEY(slug), HIDDEN_TTL);
      return;
    } catch (err) {
      console.warn("Redis markViewedOnce failed, using memory:", err);
    }
  }
  let s = memViewed.get(slug);
  if (!s) {
    s = new Set();
    memViewed.set(slug, s);
  }
  s.add(messageId);
}

export async function getViewedOnceIds(slug: string): Promise<Set<string>> {
  if (redis) {
    try {
      const ids = await redis.smembers(VIEWED_KEY(slug));
      return new Set((ids ?? []).map(String));
    } catch (err) {
      console.warn("Redis getViewedOnceIds failed, using memory:", err);
    }
  }
  return new Set(memViewed.get(slug) ?? []);
}

// ---- System notices (centered room lines, e.g. auto slow-mode) ----

export async function postSystemNotice(slug: string, text: string): Promise<void> {
  const msg: ChatMessage = {
    id: `sys-${Date.now()}-${nanoid(6)}`,
    text: text.slice(0, 200),
    user: { id: "system-peermates", name: "PeerMates" },
    createdAt: new Date().toISOString(),
    system: true,
  };
  try {
    await appendMessage(slug, msg);
  } catch (err) {
    console.warn("postSystemNotice failed:", err);
  }
}

// ---- Auto slow-mode expiry (Chat Guard calm-down) ----

/** Restore the previous slow-mode once a Guard calm-down expires. */
export async function expireAutoSlow(slug: string): Promise<void> {
  try {
    const gs = await getGuardSettings(slug);
    if (!gs.autoSlowUntil || Date.now() < gs.autoSlowUntil) return;
    const cur = await getSettings(slug);
    await setGuardSettings(slug, { autoSlowUntil: 0, autoSlowPrev: 0 });
    if (cur.slowModeSeconds === AUTO_SLOW_SECONDS) {
      await setSettings(slug, { ...cur, slowModeSeconds: gs.autoSlowPrev });
      await broadcastRoomEvent(slug, {
        type: "room_settings_changed",
        slowModeSeconds: gs.autoSlowPrev,
      });
      await postSystemNotice(slug, "Slow mode is off — chat is calm again 🌤️");
    }
  } catch (err) {
    console.warn("expireAutoSlow failed:", err);
  }
}

// ---- Guard verdict runner (fail-open wrapper) ----

export async function runChatGuard(args: {
  slug: string;
  msgId: string;
  senderId: string;
  privileged: boolean;
  rawText: string;
  slowModeSeconds: number;
}): Promise<{ blocked: boolean; hidden: boolean; reason?: string } | null> {
  const { slug, msgId, senderId, privileged, rawText, slowModeSeconds } = args;
  try {
    if (privileged || senderId.startsWith("system-")) return null;
    const gs = await getGuardSettings(slug);
    if (!gs.enabled) return null;

    const now = Date.now();
    const recent = (await getMessages(slug, 50))
      .filter((m) => m.user.id === senderId && !m.deleted && m.text)
      .slice(-5)
      .map((m) => ({
        text: m.text.slice(0, 200),
        secondsAgo: Math.max(
          0,
          Math.round((now - new Date(m.createdAt).getTime()) / 1000)
        ),
      }));

    const verdict = await checkChatGuard({
      text: rawText,
      senderId,
      sensitivity: gs.sensitivity,
      recent,
      slowModeSeconds,
    });
    if (verdict.action === "block") {
      return { blocked: true, hidden: false };
    }
    if (verdict.action !== "hide") return null;

    const reason = verdict.reasons[0] || "flagged by Chat Guard";
    await markHidden(slug, msgId, reason);

    const flood = await recordHideAndGetFlood(slug);
    if (flood >= FLOOD_SLOWMO_THRESHOLD) {
      const [cur, gs2] = await Promise.all([getSettings(slug), getGuardSettings(slug)]);
      const alreadyAuto =
        cur.slowModeSeconds === AUTO_SLOW_SECONDS && gs2.autoSlowUntil > Date.now();
      const prev = alreadyAuto ? gs2.autoSlowPrev : cur.slowModeSeconds;
      await setGuardSettings(slug, {
        autoSlowUntil: Date.now() + AUTO_SLOW_MS,
        autoSlowPrev: prev,
      });
      if (!alreadyAuto && cur.slowModeSeconds < AUTO_SLOW_SECONDS) {
        await setSettings(slug, { ...cur, slowModeSeconds: AUTO_SLOW_SECONDS });
        await broadcastRoomEvent(slug, {
          type: "room_settings_changed",
          slowModeSeconds: AUTO_SLOW_SECONDS,
        });
      }
      await postSystemNotice(slug, "Slow mode turned on to calm chat 🐢");
    }
    return { blocked: false, hidden: true, reason };
  } catch (err) {
    console.warn("runChatGuard failed open:", err);
    return null;
  }
}
