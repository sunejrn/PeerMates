"use client";

import { useEffect } from "react";

/**
 * Applies the saved theme (system / light / dark) as a .dark/.light class
 * on <html> before paint, and follows OS changes while on "system".
 * Render once in the root layout — no visible UI.
 */
export function ThemeApplier() {
  useEffect(() => {
    const apply = (theme: string) => {
      const root = document.documentElement;
      root.classList.remove("dark", "light");
      const resolved =
        theme === "dark" ||
        (theme !== "light" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
          ? "dark"
          : "light";
      root.classList.add(resolved);
    };
    let theme = "system";
    try {
      const raw = window.localStorage.getItem("peermates:settings:v1");
      if (raw) theme = (JSON.parse(raw) as { theme?: string }).theme || "system";
    } catch {
      // default system
    }
    apply(theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      try {
        const raw = window.localStorage.getItem("peermates:settings:v1");
        const t = raw ? (JSON.parse(raw) as { theme?: string }).theme : "system";
        if (!t || t === "system") apply("system");
      } catch {
        // ignore
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return null;
}
