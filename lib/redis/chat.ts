import { redis } from "./client";
import type { ChatMessage } from "@/lib/stream/realtimeClient";

const CHAT_KEY = (slug: string) => `room:${slug}:chat`;
const REACTIONS_KEY = (slug: string) => `room:${slug}:chat:reactions`;
const DELETED_KEY = (slug: string) => `room:${slug}:chat:deleted`;
const MAX_MESSAGES = 100;
const CHAT_TTL = 86400;

// In-memory fallback for local dev without Upstash
const inMemoryChat = new Map<string, ChatMessage[]>();
const inMemoryReactions = new Map<string, Map<string, Record<string, string[]>>>();
const inMemoryDeleted = new Map<string, Set<string>>();

function memReactions(slug: string) {
  let m = inMemoryReactions.get(slug);
  if (!m) {
    m = new Map();
    inMemoryReactions.set(slug, m);
  }
  return m;
}

function memDeleted(slug: string) {
  let s = inMemoryDeleted.get(slug);
  if (!s) {
    s = new Set();
    inMemoryDeleted.set(slug, s);
  }
  return s;
}

export async function appendMessage(
  slug: string,
  msg: ChatMessage
): Promise<void> {
  if (redis) {
    try {
      await redis.rpush(CHAT_KEY(slug), JSON.stringify(msg));
      await redis.ltrim(CHAT_KEY(slug), -MAX_MESSAGES, -1);
      await redis.expire(CHAT_KEY(slug), 86400);
      return;
    } catch (err) {
      console.warn("Redis chat write failed, using memory:", err);
    }
  }
  const list = inMemoryChat.get(slug) || [];
  list.push(msg);
  inMemoryChat.set(slug, list.slice(-MAX_MESSAGES));
}

export async function getMessages(
  slug: string,
  limit = 50
): Promise<ChatMessage[]> {
  if (redis) {
    try {
      const raw = await redis.lrange<string>(CHAT_KEY(slug), -limit, -1);
      if (!raw) return [];
      return raw
        .map((item) => {
          try {
            return (
              typeof item === "string" ? JSON.parse(item) : item
            ) as ChatMessage;
          } catch {
            return null;
          }
        })
        .filter((m): m is ChatMessage => m !== null);
    } catch (err) {
      console.warn("Redis chat read failed, using memory:", err);
    }
  }
  return (inMemoryChat.get(slug) || []).slice(-limit);
}

/**
 * Toggle a user's emoji reaction. Returns the updated per-message map
 * (emoji -> user ids), or null when the message doesn't exist.
 */
export async function toggleReaction(
  slug: string,
  messageId: string,
  emoji: string,
  userId: string
): Promise<Record<string, string[]> | null> {
  if (redis) {
    try {
      const key = REACTIONS_KEY(slug);
      const raw = await redis.hget<string | Record<string, string[]>>(key, messageId);
      // Upstash auto-deserializes JSON values: may arrive as object already.
      const map: Record<string, string[]> =
        typeof raw === "string"
          ? JSON.parse(raw)
          : raw && typeof raw === "object"
            ? { ...(raw as Record<string, string[]>) }
            : {};
      const users = new Set(map[emoji] ?? []);
      if (users.has(userId)) users.delete(userId);
      else users.add(userId);
      if (users.size === 0) delete map[emoji];
      else map[emoji] = Array.from(users).slice(0, 500);
      if (Object.keys(map).length === 0) {
        await redis.hdel(key, messageId);
      } else {
        await redis.hset(key, { [messageId]: JSON.stringify(map) });
        await redis.expire(key, CHAT_TTL);
      }
      return map;
    } catch (err) {
      console.warn("Redis reaction write failed, using memory:", err);
    }
  }
  const store = memReactions(slug);
  const map: Record<string, string[]> = store.get(messageId) ?? {};
  const users = new Set(map[emoji] ?? []);
  if (users.has(userId)) users.delete(userId);
  else users.add(userId);
  if (users.size === 0) delete map[emoji];
  else map[emoji] = Array.from(users);
  if (Object.keys(map).length === 0) store.delete(messageId);
  else store.set(messageId, map);
  return map;
}

export async function getReactions(
  slug: string
): Promise<Record<string, Record<string, string[]>>> {
  if (redis) {
    try {
      const raw = await redis.hgetall<Record<string, string>>(
        REACTIONS_KEY(slug)
      );
      if (!raw) return {};
      const out: Record<string, Record<string, string[]>> = {};
      for (const [msgId, value] of Object.entries(raw)) {
        try {
          const parsed = typeof value === "string" ? JSON.parse(value) : value;
          if (parsed && typeof parsed === "object") out[msgId] = parsed;
        } catch {
          // skip corrupt entries
        }
      }
      return out;
    } catch (err) {
      console.warn("Redis reactions read failed, using memory:", err);
    }
  }
  return Object.fromEntries(memReactions(slug).entries());
}

/** Tombstone a message (author or moderator). Content is stripped on read. */
export async function markDeleted(slug: string, messageId: string): Promise<void> {
  if (redis) {
    try {
      await redis.sadd(DELETED_KEY(slug), messageId);
      await redis.expire(DELETED_KEY(slug), CHAT_TTL);
      return;
    } catch (err) {
      console.warn("Redis delete mark failed, using memory:", err);
    }
  }
  memDeleted(slug).add(messageId);
}

export async function getDeletedIds(slug: string): Promise<Set<string>> {
  if (redis) {
    try {
      const ids = await redis.smembers(DELETED_KEY(slug));
      return new Set((ids ?? []).map(String));
    } catch (err) {
      console.warn("Redis deleted read failed, using memory:", err);
    }
  }
  return new Set(memDeleted(slug));
}

/** Find a stored message by id (for delete-permission checks). */
export async function findMessage(
  slug: string,
  messageId: string
): Promise<ChatMessage | null> {
  const list = await getMessages(slug, MAX_MESSAGES);
  return list.find((m) => m.id === messageId) ?? null;
}
