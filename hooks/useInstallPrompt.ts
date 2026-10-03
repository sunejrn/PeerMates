"use client";

import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform =
    (navigator as Navigator & { platform?: string }).platform || "";
  const maxTouch =
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints || 0;
  return (
    /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouch > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mql =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(display-mode: standalone)").matches
      : false;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
    true;
  return mql || iosStandalone;
}

/**
 * Install-prompt state for both platforms:
 * - Android/Chrome: captures beforeinstallprompt; prompt() on user tap
 *   (a user gesture is required).
 * - iOS Safari: no prompt event — show Share → "Add to Home Screen" steps.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isStandalone()
  );
  const [isIOSDevice] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isIOS()
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!deferred) return false;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
        setDeferred(null);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [deferred]);

  return {
    /** Android/Chrome: true once beforeinstallprompt was captured. */
    canPrompt: deferred !== null,
    isIOSDevice,
    installed,
    promptInstall,
  };
}
