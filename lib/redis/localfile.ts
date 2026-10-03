import { redis } from "./client";
import type { LocalFingerprint } from "@/lib/video/localfile";

const FP_KEY = (slug: string) => `room:${slug}:localfile`;
const P2P_RECEIVERS_KEY = (slug: string) => `room:${slug}:p2p:receivers`;
const P2P_SHARING_KEY = (slug: string) => `room:${slug}:p2p:sharing`;

const FP_TTL = 60 * 60 * 24 * 7; // 7 days
const P2P_TTL = 60 * 60 * 6; // 6 hours
const SHARING_TTL = 60 * 15; // 15 min — host re-asserts on every share start

// In-memory fallbacks (single-instance local dev only)
const memFp = new Map<string, LocalFingerprint>();
const memReceivers = new Map<string, Map<string, number>>();

function memRecvMap(slug: string) {
  let m = memReceivers.get(slug);
  if (!m) {
    m = new Map();
    memReceivers.set(slug, m);
  }
  return m;
}

// ---- Host fingerprint (what "the same movie" means) ----

export async function setRoomFingerprint(
  slug: string,
  fp: LocalFingerprint
): Promise<void> {
  if (redis) {
    try {
      await redis.set(FP_KEY(slug), JSON.stringify(fp), { ex: FP_TTL });
      return;
    } catch (err) {
      console.warn("Redis fingerprint write failed, using memory:", err);
    }
  }
  memFp.set(slug, fp);
}

export async function getRoomFingerprint(
  slug: string
): Promise<LocalFingerprint | null> {
  if (redis) {
    try {
      const raw = await redis.get<string | LocalFingerprint>(FP_KEY(slug));
      if (!raw) return null;
      const parsed =
        typeof raw === "string" ? JSON.parse(raw) : (raw as LocalFingerprint);
      if (parsed && parsed.v === 1 && typeof parsed.size === "number") {
        return parsed;
      }
      return null;
    } catch (err) {
      console.warn("Redis fingerprint read failed, using memory:", err);
    }
  }
  return memFp.get(slug) ?? null;
}

// ---- P2P "Stream from host" receivers (capped small group) ----

export async function addP2PReceiver(
  slug: string,
  userId: string,
  maxReceivers: number
): Promise<{ added: boolean; count: number; full: boolean }> {
  if (redis) {
    try {
      const count = await redis.scard(P2P_RECEIVERS_KEY(slug));
      if (count >= maxReceivers) {
        const already = await redis.sismember(P2P_RECEIVERS_KEY(slug), userId);
        if (already === 1) return { added: false, count, full: false };
        return { added: false, count, full: true };
      }
      await redis.sadd(P2P_RECEIVERS_KEY(slug), userId);
      await redis.expire(P2P_RECEIVERS_KEY(slug), P2P_TTL);
      return { added: true, count: count + 1, full: false };
    } catch (err) {
      console.warn("Redis P2P add failed, using memory:", err);
    }
  }
  const m = memRecvMap(slug);
  if (m.has(userId)) return { added: false, count: m.size, full: false };
  if (m.size >= maxReceivers) return { added: false, count: m.size, full: true };
  m.set(userId, Date.now());
  return { added: true, count: m.size, full: false };
}

export async function removeP2PReceiver(
  slug: string,
  userId: string
): Promise<number> {
  if (redis) {
    try {
      await redis.srem(P2P_RECEIVERS_KEY(slug), userId);
      return (await redis.scard(P2P_RECEIVERS_KEY(slug))) ?? 0;
    } catch (err) {
      console.warn("Redis P2P remove failed, using memory:", err);
    }
  }
  const m = memRecvMap(slug);
  m.delete(userId);
  return m.size;
}

export async function getP2PReceiverCount(slug: string): Promise<number> {
  if (redis) {
    try {
      return (await redis.scard(P2P_RECEIVERS_KEY(slug))) ?? 0;
    } catch (err) {
      console.warn("Redis P2P count failed, using memory:", err);
    }
  }
  return memRecvMap(slug).size;
}

export async function isP2PReceiver(
  slug: string,
  userId: string
): Promise<boolean> {
  if (redis) {
    try {
      return (await redis.sismember(P2P_RECEIVERS_KEY(slug), userId)) === 1;
    } catch {
      return false;
    }
  }
  return memRecvMap(slug).has(userId);
}

// ---- Host "am sharing" flag (viewers get instant feedback) ----

const memSharing = new Map<string, number>();

/** Host asserts sharing (15-min TTL — re-asserted on every share start). */
export async function setP2PSharing(slug: string, on: boolean): Promise<void> {
  if (redis) {
    try {
      if (on) {
        await redis.set(P2P_SHARING_KEY(slug), "1", { ex: SHARING_TTL });
      } else {
        await redis.del(P2P_SHARING_KEY(slug));
      }
      return;
    } catch (err) {
      console.warn("Redis P2P sharing flag failed, using memory:", err);
    }
  }
  if (on) memSharing.set(slug, Date.now() + SHARING_TTL * 1000);
  else memSharing.delete(slug);
}

export async function isP2PSharing(slug: string): Promise<boolean> {
  if (redis) {
    try {
      return (await redis.get(P2P_SHARING_KEY(slug))) != null;
    } catch (err) {
      console.warn("Redis P2P sharing read failed, using memory:", err);
    }
  }
  const until = memSharing.get(slug);
  if (!until) return false;
  if (until < Date.now()) {
    memSharing.delete(slug);
    return false;
  }
  return true;
}
