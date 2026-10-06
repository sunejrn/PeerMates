"use client";

import { useEffect, useState } from "react";

/**
 * useState persisted to localStorage — survives refresh / hard refresh and
 * coming back later. Values are validated against `valid` so a stale or
 * foreign value can never break the UI (falls back to `initial`).
 *
 * Used for room UI state (sidebar tabs, …): whatever the user or host last
 * had open is exactly what they return to.
 */
export function usePersistentState<T extends string>(
  key: string,
  initial: T,
  valid: readonly T[]
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw && (valid as readonly string[]).includes(raw)) {
        return raw as T;
      }
    } catch {
      // storage blocked — session-only state
    }
    return initial;
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // storage blocked — session-only state
    }
  }, [key, value]);

  return [value, setValue];
}
