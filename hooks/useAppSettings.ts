"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export type ChatFontSize = "s" | "m" | "l";

export interface AppSettings {
  /** Auto-delete rooms from All Rooms after 30 days. Default ON. */
  autoDeleteRooms: boolean;
  /** Room toast notifications (file received, promotions, etc.). Default ON. */
  notifications: boolean;
  /** Appearance. Default system. */
  theme: ThemeChoice;
  /** Global live-chat visibility. When OFF the chat tab shows a
   *  "host disabled live chat" notice. Default ON. */
  liveChatEnabled: boolean;
  /** Data Saver default for new rooms. Default OFF. */
  dataSaverDefault: boolean;
  /** Autoplay attempt on join (still subject to browser policy). Default ON. */
  autoplayDefault: boolean;
  /** Start rooms with audio-only mode on. Default OFF. */
  audioOnlyDefault: boolean;
  /** Show presence avatars in the Watching list. Default ON. */
  showAvatars: boolean;
  /** WhatsApp-style "X is typing…" bubbles in chat. Default ON. */
  typingIndicators: boolean;
  /** Soft chime when a new message arrives from someone else. Default OFF. */
  messageSounds: boolean;
  /** Ask for confirmation before leaving a room. Default OFF. */
  confirmBeforeLeave: boolean;
  /** Minimize animations and transitions. Default OFF. */
  reduceMotion: boolean;
  /** Chat message text size. Default medium. */
  chatFontSize: ChatFontSize;
  /** Data-cost estimate region ("" = auto-detect from locale). */
  priceRegion: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  autoDeleteRooms: true,
  notifications: true,
  theme: "system",
  liveChatEnabled: true,
  dataSaverDefault: false,
  autoplayDefault: true,
  audioOnlyDefault: false,
  showAvatars: true,
  typingIndicators: true,
  messageSounds: false,
  confirmBeforeLeave: false,
  reduceMotion: false,
  chatFontSize: "m",
  priceRegion: "",
};

export const SETTINGS_EVENT = "peermates:settings-changed";

const KEY = "peermates:settings:v1";

function readSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      autoDeleteRooms: parsed.autoDeleteRooms !== false,
      notifications: parsed.notifications !== false,
      theme:
        parsed.theme === "light" || parsed.theme === "dark" || parsed.theme === "system"
          ? parsed.theme
          : "system",
      liveChatEnabled: parsed.liveChatEnabled !== false,
      dataSaverDefault: parsed.dataSaverDefault === true,
      autoplayDefault: parsed.autoplayDefault !== false,
      audioOnlyDefault: parsed.audioOnlyDefault === true,
      showAvatars: parsed.showAvatars !== false,
      typingIndicators: parsed.typingIndicators !== false,
      messageSounds: parsed.messageSounds === true,
      confirmBeforeLeave: parsed.confirmBeforeLeave === true,
      reduceMotion: parsed.reduceMotion === true,
      chatFontSize:
        parsed.chatFontSize === "s" || parsed.chatFontSize === "l" ? parsed.chatFontSize : "m",
      priceRegion:
        typeof parsed.priceRegion === "string" ? parsed.priceRegion.slice(0, 8) : "",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applyTheme(theme: ThemeChoice): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("dark", "light");
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.add("light");
  try {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", resolved === "dark" ? "#333333" : "#fafaf9");
  } catch {
    // ignore
  }
}

function applyReduceMotion(on: boolean): void {
  if (typeof document === "undefined") return;
  try {
    document.documentElement.classList.toggle("reduce-motion", on);
  } catch {
    // ignore
  }
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSettings(readSettings());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    applyTheme(settings.theme);
    applyReduceMotion(settings.reduceMotion);
  }, [settings.theme, settings.reduceMotion, loaded]);

  // Follow OS changes while on "system".
  useEffect(() => {
    if (!loaded || settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [loaded, settings.theme]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage blocked — keep in-memory
      }
      try {
        window.dispatchEvent(new Event(SETTINGS_EVENT));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(new Event(SETTINGS_EVENT));
    } catch {
      // ignore
    }
  }, []);

  return { settings, loaded, update, reset };
}

/** Toast gate: respects the notifications toggle (new event toasts only). */
export function notificationsEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return true;
    return (JSON.parse(raw) as Partial<AppSettings>).notifications !== false;
  } catch {
    return true;
  }
}
