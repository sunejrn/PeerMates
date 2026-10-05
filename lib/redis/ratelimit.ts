import { redis } from "./client";

/**
 * Fixed-window rate limiter on top of Upstash Redis (free tier friendly:
 * 1 INCR + 1 EXPIRE per check). Falls back to in-memory counters for local
 * dev without Upstash.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const memBuckets = new Map<string, Bucket>();

function memCheck(key: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const existing = memBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    memBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, retryAfter: 0 };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.ceil((existing.resetAt - now) / 1000),
    };
  }
  existing.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; retryAfter: number }> {
  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }
      if (count > limit) {
        const ttl = await redis.ttl(key);
        return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSeconds };
      }
      return { allowed: true, retryAfter: 0 };
    } catch (err) {
      console.warn("Rate-limit Redis check failed, using memory:", err);
    }
  }
  return memCheck(`rl:${key}`, limit, windowSeconds);
}

/** Per-endpoint budgets (free-tier safe, generous enough for heartbeats). */
export const RATE_LIMITS = {
  /** Playback state writes (host events + 3s heartbeat). */
  stateWrite: { limit: 60, windowSeconds: 60 },
  /** Chat messages (slow-mode is enforced separately). */
  message: { limit: 20, windowSeconds: 60 },
  /** Presence heartbeats (5s interval = ~12/min). */
  presence: { limit: 40, windowSeconds: 60 },
  /** Role promote/demote. */
  roleChange: { limit: 10, windowSeconds: 60 },
  /** Viewer "request control" hand-raises. */
  controlRequest: { limit: 3, windowSeconds: 60 },
  /** Kick / mute / slow-mode / source changes. */
  moderation: { limit: 20, windowSeconds: 60 },
  /** WebRTC signaling envelopes (setup only; trickle ICE is bursty). */
  signaling: { limit: 60, windowSeconds: 60 },
  /** Emoji reaction toggles (tap-happy but bounded). */
  reaction: { limit: 30, windowSeconds: 60 },
  /** Room creation (per IP — free-tier abuse guard). */
  roomCreate: { limit: 6, windowSeconds: 3600 },
  /** Room joins / presence joins (per room+IP budget). */
  roomJoin: { limit: 30, windowSeconds: 60 },
  /** AI translate/recap per user (free-tier guard). */
  aiPerUser: { limit: 10, windowSeconds: 3600 },
  /** AI translate/recap global room budget (free-tier guard). */
  aiGlobal: { limit: 60, windowSeconds: 3600 },
  /** Replay event capture per user (500-viewer bursts stay smooth). */
  replayEvent: { limit: 120, windowSeconds: 60 },
  /** Replay event capture global room budget (burst headroom). */
  replayGlobal: { limit: 2000, windowSeconds: 60 },
  /** Movie Night Picker adds/votes (one vote pp enforced separately). */
  picker: { limit: 30, windowSeconds: 60 },
  /** Movie Buddy questions per user (AI guard). */
  buddyPerUser: { limit: 10, windowSeconds: 3600 },
  /** Movie Buddy global room budget. */
  buddyGlobal: { limit: 60, windowSeconds: 3600 },
  /** Class Mode writes (polls/questions/notes/attendance). */
  classWrite: { limit: 60, windowSeconds: 60 },
} as const;
