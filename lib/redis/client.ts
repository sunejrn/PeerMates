import { Redis } from "@upstash/redis";

export const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

// Helper to safely access Redis with informative fallback for development
export function getRedis() {
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Upstash Redis is not configured in production.");
    }
    console.warn("⚠️ Upstash Redis not configured. Using in-memory fallback for local dev.");
  }
  return redis;
}
