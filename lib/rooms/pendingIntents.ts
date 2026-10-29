/**
 * Sign-in continuation intents.
 *
 * Social sign-in is a full-page redirect, so in-memory React state is lost.
 * These tiny localStorage records let the app resume exactly where the user
 * stopped once they come back signed in: finish creating the room they were
 * setting up, or join the party whose code they entered.
 */

import type { LocalFingerprint } from "@/lib/video/localfile";

const CREATE_KEY = "peermates:pending-create:v1";
const JOIN_KEY = "peermates:pending-join:v1";

export interface PendingCreateIntent {
  title: string;
  fp: LocalFingerprint;
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked/full — continuation is best-effort
  }
}

function read<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function savePendingCreate(intent: PendingCreateIntent): void {
  write(CREATE_KEY, intent);
}

export function readPendingCreate(): PendingCreateIntent | null {
  const intent = read<PendingCreateIntent>(CREATE_KEY);
  if (!intent || !intent.fp || typeof intent.fp.fpId !== "string") return null;
  return intent;
}

export function clearPendingCreate(): void {
  remove(CREATE_KEY);
}

export function savePendingJoin(slug: string): void {
  if (!slug) return;
  write(JOIN_KEY, { slug });
}

export function readPendingJoin(): string | null {
  const value = read<{ slug?: unknown }>(JOIN_KEY);
  return typeof value?.slug === "string" && value.slug ? value.slug : null;
}

export function clearPendingJoin(): void {
  remove(JOIN_KEY);
}
