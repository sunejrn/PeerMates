"use client";

import { useCallback, useState } from "react";

const STORAGE_KEY = "syncme:data-saver";
const AUDIO_KEY = "syncme:audio-only";

function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const coarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;
  const touch =
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints > 0 &&
    Math.min(window.screen.width, window.screen.height) < 820;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 500;
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData === true;
  return coarse || touch || smallScreen || saveData;
}

function readStored(key: string, fallback: boolean | null): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // private mode etc.
  }
  return fallback;
}

/**
 * Data Saver preference. Defaults ON for mobile (coarse pointer, small
 * screen, or browser Save-Data hint) and OFF for desktop; any explicit
 * choice persists in localStorage.
 */
export function useDataSaver() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    const stored = readStored(STORAGE_KEY, null);
    if (stored !== null) return stored;
    return isMobileDevice();
  });
  const [audioOnly, setAudioOnlyState] = useState<boolean>(() => {
    return readStored(AUDIO_KEY, false) === true;
  });

  const setEnabled = useCallback((on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const setAudioOnly = useCallback((on: boolean) => {
    setAudioOnlyState(on);
    try {
      localStorage.setItem(AUDIO_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  return { dataSaver: enabled, audioOnly, setEnabled, setAudioOnly };
}
