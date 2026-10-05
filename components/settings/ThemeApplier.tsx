"use client";

import { useEffect } from "react";

/**
 * Applies the saved display settings (theme system/light/dark +
 * reduce-motion) as classes on <html> before paint, and follows OS changes
 * while on "system". Render once in the root layout — no visible UI.
 */
export function ThemeApplier() {
  useEffect(() => {
    const apply = () => {
      let theme = "system";
      let reduceMotion = false;
      try {
        const raw = window.localStorage.getItem("peermates:settings:v1");
        if (raw) {
          const parsed = JSON.parse(raw) as { theme?: string; reduceMotion?: boolean };
          theme = parsed.theme || "system";
          reduceMotion = parsed.reduceMotion === true;
        }
      } catch {
        // defaults
      }
      const root = document.documentElement;
      root.classList.remove("dark", "light");
      const resolved =
        theme === "dark" ||
        (theme !== "light" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
          ? "dark"
          : "light";
      root.classList.add(resolved);
      root.classList.toggle("reduce-motion", reduceMotion);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    const onSettings = () => apply();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "peermates:settings:v1") apply();
    };
    mq.addEventListener("change", onChange);
    window.addEventListener("peermates:settings-changed", onSettings);
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("peermates:settings-changed", onSettings);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
