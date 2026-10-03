import { redis } from "./client";

/**
 * WebRTC signaling transport over Upstash Redis (free-tier friendly).
 *
 * No websocket server needed: each user polls their own mailbox
 * (`GET ?for=<userId>`) and delivery is destructive (RPOP drains the
 * queue). Messages are SDP/ICE envelopes — tiny JSON, TTL'd.
 */

export type SignalKind =
  | "p2p-join" // viewer -> host: "I want your stream"
  | "p2p-offer" // host -> viewer: SDP offer
  | "p2p-answer" // viewer -> host: SDP answer
  | "p2p-ice" // either -> peer: ICE candidate
  | "p2p-leave" // viewer -> host: "I'm done"
  | "p2p-full" // host/server -> viewer: "room full"
  | "p2p-decline"; // host -> viewer: "not sharing right now"

export interface SignalMessage {
  id: string;
  from: string;
  fromName?: string;
  kind: SignalKind;
  /** SDP / ICE candidate / reason — small JSON only. */
  payload: unknown;
  at: number;
}

const MAILBOX_KEY = (slug: string, userId: string) =>
  `room:${slug}:sig:${userId}`;
const MAILBOX_TTL = 60 * 5; // 5 minutes — setup only, never media
const MAX_MAILBOX = 50;

// In-memory fallback (single-instance local dev only)
const memMail = new Map<string, SignalMessage[]>();

export async function pushSignal(
  slug: string,
  toUserId: string,
  msg: Omit<SignalMessage, "id" | "at">
): Promise<SignalMessage> {
  const full: SignalMessage = {
    ...msg,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  };
  if (redis) {
    try {
      const key = MAILBOX_KEY(slug, toUserId);
      await redis.lpush(key, JSON.stringify(full));
      await redis.ltrim(key, 0, MAX_MAILBOX - 1);
      await redis.expire(key, MAILBOX_TTL);
      return full;
    } catch (err) {
      console.warn("Redis signal push failed, using memory:", err);
    }
  }
  const boxKey = `${slug}:${toUserId}`;
  const list = memMail.get(boxKey) ?? [];
  list.unshift(full);
  memMail.set(boxKey, list.slice(0, MAX_MAILBOX));
  return full;
}

/** Drain + return all pending signals for a user (newest last). */
export async function drainSignals(
  slug: string,
  userId: string,
  limit = 50
): Promise<SignalMessage[]> {
  if (redis) {
    try {
      const key = MAILBOX_KEY(slug, userId);
      const out: SignalMessage[] = [];
      for (let i = 0; i < limit; i++) {
        const raw = await redis.rpop<string>(key);
        if (!raw) break;
        try {
          out.push(
            (typeof raw === "string" ? JSON.parse(raw) : raw) as SignalMessage
          );
        } catch {
          // skip corrupt entries
        }
      }
      return out;
    } catch (err) {
      console.warn("Redis signal drain failed, using memory:", err);
    }
  }
  const boxKey = `${slug}:${userId}`;
  const list = memMail.get(boxKey) ?? [];
  memMail.set(boxKey, []);
  return list.reverse().slice(0, limit);
}
