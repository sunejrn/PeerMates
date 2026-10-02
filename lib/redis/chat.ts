import { redis } from "./client";
import type { ChatMessage } from "@/lib/stream/realtimeClient";

const CHAT_KEY = (slug: string) => `room:${slug}:chat`;
const MAX_MESSAGES = 100;

// In-memory fallback for local dev without Upstash
const inMemoryChat = new Map<string, ChatMessage[]>();

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
