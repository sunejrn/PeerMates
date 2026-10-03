import { createHash } from "crypto";
import { redis } from "@/lib/redis/client";

/**
 * Room subtitle state + AI caches, Redis-backed with in-memory fallback
 * (mirrors lib/redis/roles.ts so local dev works without Upstash).
 *
 * Keys:
 * - room:{slug}:subtitles      room subtitle meta (TTL 7d, like roles)
 * - subs:vtt:{hash}:{lang}     translated VTT (NO expiry per spec)
 * - subs:recap:{hash}:{bucket}  "catch me up" recap (NO expiry per spec)
 */

export interface RoomSubtitleMeta {
  hash: string;
  name: string;
  /** ISO-639-1 source language guess or "auto". */
  sourceLang: string;
  cueCount: number;
  /** Translated languages ready to serve (besides "orig"). */
  langs: string[];
  updatedAt: number;
}

const META_KEY = (slug: string) => `room:${slug}:subtitles`;
const VTT_KEY = (hash: string, lang: string) => `subs:vtt:${hash}:${lang}`;
const RECAP_KEY = (hash: string, bucket: number) => `subs:recap:${hash}:${bucket}`;

const META_TTL = 60 * 60 * 24 * 7; // 7 days, like roles/settings
const MAX_VTT_BYTES = 400 * 1024; // Upstash value guard

// ---- In-memory fallbacks (single-instance local dev only) ----
const memMeta = new Map<string, RoomSubtitleMeta>();
const memVtt = new Map<string, string>();
const memRecap = new Map<string, string>();

/** Content hash: translation cache key + dedupe id. */
export function subtitleHash(vtt: string): string {
  return createHash("sha256").update(vtt, "utf8").digest("hex").slice(0, 32);
}

// ---- Room meta ----

export async function getSubtitleMeta(slug: string): Promise<RoomSubtitleMeta | null> {
  if (redis) {
    try {
      const raw = await redis.get<string | RoomSubtitleMeta>(META_KEY(slug));
      if (!raw) return null;
      const meta = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (meta && typeof meta.hash === "string") return meta as RoomSubtitleMeta;
      return null;
    } catch (err) {
      console.warn("Redis getSubtitleMeta failed, using memory:", err);
    }
  }
  return memMeta.get(slug) ?? null;
}

export async function setSubtitleMeta(slug: string, meta: RoomSubtitleMeta): Promise<void> {
  if (redis) {
    try {
      await redis.set(META_KEY(slug), JSON.stringify(meta), { ex: META_TTL });
      return;
    } catch (err) {
      console.warn("Redis setSubtitleMeta failed, using memory:", err);
    }
  }
  memMeta.set(slug, meta);
}

export async function addSubtitleLang(slug: string, lang: string): Promise<void> {
  const meta = await getSubtitleMeta(slug);
  if (!meta || meta.langs.includes(lang)) return;
  meta.langs = [...meta.langs, lang].slice(0, 12);
  await setSubtitleMeta(slug, meta);
}

// ---- VTT payloads (translations cached with NO expiry) ----

export async function getVtt(hash: string, lang: string): Promise<string | null> {
  if (redis) {
    try {
      const raw = await redis.get<string>(VTT_KEY(hash, lang));
      return typeof raw === "string" && raw ? raw : null;
    } catch (err) {
      console.warn("Redis getVtt failed, using memory:", err);
    }
  }
  return memVtt.get(`${hash}:${lang}`) ?? null;
}

export async function setVtt(hash: string, lang: string, vtt: string): Promise<void> {
  if (vtt.length > MAX_VTT_BYTES) {
    throw new Error("Subtitles are too large to cache (400KB limit).");
  }
  if (redis) {
    try {
      // No EX — translation cache has no expiry per spec.
      await redis.set(VTT_KEY(hash, lang), vtt);
      return;
    } catch (err) {
      console.warn("Redis setVtt failed, using memory:", err);
    }
  }
  memVtt.set(`${hash}:${lang}`, vtt);
}

// ---- Recap cache (hash + minute bucket, NO expiry) ----

export async function getRecap(hash: string, bucket: number): Promise<string | null> {
  if (redis) {
    try {
      const raw = await redis.get<string>(RECAP_KEY(hash, bucket));
      return typeof raw === "string" && raw ? raw : null;
    } catch (err) {
      console.warn("Redis getRecap failed, using memory:", err);
    }
  }
  return memRecap.get(`${hash}:${bucket}`) ?? null;
}

export async function setRecap(hash: string, bucket: number, recap: string): Promise<void> {
  if (redis) {
    try {
      await redis.set(RECAP_KEY(hash, bucket), recap.slice(0, 4000));
      return;
    } catch (err) {
      console.warn("Redis setRecap failed, using memory:", err);
    }
  }
  memRecap.set(`${hash}:${bucket}`, recap.slice(0, 4000));
}
