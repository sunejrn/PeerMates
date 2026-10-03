"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production only (dev + SW caching = stale dev).
 * Update-safe: the worker calls skipWaiting + clients.claim on activate.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // PWA is an enhancement — the app works fully without it
      }
    };
    // Defer past first paint on slow mobile networks.
    if (document.readyState === "complete") {
      void register();
    } else {
      window.addEventListener("load", () => void register(), { once: true });
    }
  }, []);

  return null;
}
