import { redis } from "./client";

/**
 * Guided-sync shared clock (embed providers that can't be remote-controlled).
 *
 * The host taps "Start countdown" → startedAt = now + 3s is stored; every
 * client polls, shows 3-2-1, then runs a shared expected-position timer.
 * Restart writes a new startedAt; stop clears it. TTL 7 days, like settings.
 */

export interface GuidedState {
  /** Epoch ms the countdown targets (0 = idle, nothing started). */
  startedAt: number;
  /** Monotonic version so clients notice restarts. */
  version: number;
}

const GUIDED_KEY = (slug: string) => `room:${slug}:guided`;
const GUIDED_TTL = 60 * 60 * 24 * 7;
const COUNTDOWN_MS = 3000;

const memGuided = new Map<string, GuidedState>();

export async function getGuidedState(slug: string): Promise<GuidedState> {
  if (redis) {
    try {
      const raw = await redis.get<string | GuidedState>(GUIDED_KEY(slug));
      if (!raw) return { startedAt: 0, version: 0 };
      const p = typeof raw === "string" ? JSON.parse(raw) : raw;
      return {
        startedAt: typeof p.startedAt === "number" ? p.startedAt : 0,
        version: typeof p.version === "number" ? p.version : 0,
      };
    } catch (err) {
      console.warn("Redis getGuidedState failed, using memory:", err);
    }
  }
  return memGuided.get(slug) ?? { startedAt: 0, version: 0 };
}

export async function startGuidedCountdown(slug: string): Promise<GuidedState> {
  const next: GuidedState = {
    startedAt: Date.now() + COUNTDOWN_MS,
    version: Date.now(),
  };
  if (redis) {
    try {
      await redis.set(GUIDED_KEY(slug), JSON.stringify(next), { ex: GUIDED_TTL });
      return next;
    } catch (err) {
      console.warn("Redis startGuidedCountdown failed, using memory:", err);
    }
  }
  memGuided.set(slug, next);
  return next;
}

export async function stopGuidedCountdown(slug: string): Promise<GuidedState> {
  const next: GuidedState = { startedAt: 0, version: Date.now() };
  if (redis) {
    try {
      await redis.set(GUIDED_KEY(slug), JSON.stringify(next), { ex: GUIDED_TTL });
      return next;
    } catch (err) {
      console.warn("Redis stopGuidedCountdown failed, using memory:", err);
    }
  }
  memGuided.set(slug, next);
  return next;
}

export function formatGuidedClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
