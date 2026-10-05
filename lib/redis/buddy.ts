import { createHash } from "crypto";
import { redis } from "@/lib/redis/client";

/**
 * Movie Buddy answer cache (Upstash, 7d TTL, in-memory fallback).
 * Key: buddy:{fileHash}:{bucket}:{normalizedQuestion}
 * bucket = floor(timestamp / 30) — 30s buckets keep follow-ups coherent
 * while a scene plays.
 */

const KEY = (h: string, b: number, q: string) => `buddy:${h}:${b}:${q}`;
const TTL = 60 * 60 * 24 * 7;
const mem = new Map<string, string>();

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 200);
}

export function buddyHashKey(fileHash: string): string {
  return fileHash.slice(0, 32) || "nohash";
}

export function buddyKey(
  fileHash: string,
  timestampSec: number,
  question: string
): { key: string; bucket: number; norm: string } {
  const bucket = Math.floor(Math.max(0, timestampSec) / 30);
  const norm = normalizeQuestion(question);
  const qh = createHash("sha256").update(norm, "utf8").digest("hex").slice(0, 24);
  return { key: KEY(buddyHashKey(fileHash), bucket, qh), bucket, norm };
}

export async function getBuddyAnswer(key: string): Promise<string | null> {
  if (redis) {
    try {
      const v = await redis.get<string>(key);
      return typeof v === "string" && v ? v : null;
    } catch (err) {
      console.warn("Redis buddy get failed, using memory:", err);
    }
  }
  return mem.get(key) ?? null;
}

export async function setBuddyAnswer(key: string, answer: string): Promise<void> {
  const clean = answer.slice(0, 2000);
  if (redis) {
    try {
      await redis.set(key, clean, { ex: TTL });
      return;
    } catch (err) {
      console.warn("Redis buddy set failed, using memory:", err);
    }
  }
  mem.set(key, clean);
}

export const BUDDY_SYSTEM_PROMPT =
  `You are Movie Buddy, a watch-party helper. Answer ONLY from the subtitle ` +
  `text provided below, which covers everything shown up to the room's current ` +
  `timestamp. Rules: use only that text; if the answer is not in it, reply ` +
  `exactly "that hasn't been shown yet"; never speculate, invent, or describe ` +
  `anything beyond the provided text; keep answers to 2-4 short sentences. ` +
  `Return JSON only: {"answer": "..."}.`;
