"use client";

import { useCallback, useState } from "react";

const NAME_KEY = "syncme_nickname";
const ID_KEY = "syncme_guest_id";

function loadGuestId(): string {
  if (typeof window === "undefined") return "guest_tmp";
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = `guest_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
    try {
      localStorage.setItem(ID_KEY, id);
    } catch {
      // private mode — session-only id
    }
  }
  return id;
}

function loadNickname(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

/**
 * Guest identity: nickname-only join (no signup). Persists a stable guest id
 * + nickname in localStorage so roles/presence survive reconnects.
 */
export function useGuestIdentity() {
  const [guestId] = useState(loadGuestId);
  const [nickname, setNicknameState] = useState<string | null>(loadNickname);

  const saveNickname = useCallback((name: string) => {
    const clean = name.trim().slice(0, 24);
    if (!clean) return false;
    try {
      localStorage.setItem(NAME_KEY, clean);
    } catch {
      // ignore — still join for this session
    }
    setNicknameState(clean);
    return true;
  }, []);

  const clearNickname = useCallback(() => {
    try {
      localStorage.removeItem(NAME_KEY);
    } catch {
      // ignore
    }
    setNicknameState(null);
  }, []);

  return { guestId, nickname, saveNickname, clearNickname };
}
