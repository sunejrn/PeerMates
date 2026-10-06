"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseSubtitleFile, cuesToVtt } from "@/lib/subtitles/parse";
import { toast } from "sonner";

export type SubtitleSize = "s" | "m" | "l";

export interface SubtitleMeta {
  hash: string;
  name: string;
  sourceLang: string;
  cueCount: number;
  langs: string[];
  updatedAt: number;
}

interface UseRoomSubtitlesOpts {
  slug: string;
  actorId: string;
  videoType?: string;
}

const LANG_KEY = "syncme_sub_lang";
const SIZE_KEY = "syncme_sub_size";

/**
 * Room subtitles: poll meta (late joiners converge via Redis), fetch VTT per
 * language into a blob URL for the <track> element, upload (host/co-host),
 * translate (cached hash+lang), and "catch me up" recap. Loading + error
 * states throughout; quota errors keep the original subtitles playing.
 */
export function useRoomSubtitles({ slug, actorId, videoType }: UseRoomSubtitlesOpts) {
  const [meta, setMeta] = useState<SubtitleMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [lang, setLangState] = useState("orig");
  const [size, setSizeState] = useState<SubtitleSize>("m");
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateAvailable, setTranslateAvailable] = useState(false);
  const [recap, setRecap] = useState<string | null>(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trackUrlRef = useRef<string | null>(null);

  // Per-user prefs (language + size survive reloads).
  useEffect(() => {
    try {
      const l = localStorage.getItem(LANG_KEY);
      if (l) setLangState(l.slice(0, 8));
      const s = localStorage.getItem(SIZE_KEY);
      if (s === "s" || s === "m" || s === "l") setSizeState(s);
    } catch {
      // private mode — defaults stand
    }
  }, []);

  const setLang = useCallback((l: string) => {
    const clean = l.toLowerCase().slice(0, 8) || "orig";
    setLangState(clean);
    setRecap(null);
    try {
      localStorage.setItem(LANG_KEY, clean);
    } catch {
      // ignore
    }
  }, []);

  const setSize = useCallback((s: SubtitleSize) => {
    setSizeState(s);
    try {
      localStorage.setItem(SIZE_KEY, s);
    } catch {
      // ignore
    }
  }, []);

  const fetchMeta = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${slug}/subtitles`);
      if (!res.ok) return;
      const data = await res.json();
      setMeta(data.meta ?? null);
    } catch {
      // polling is best-effort
    } finally {
      setMetaLoading(false);
    }
  }, [slug]);

  // Meta poll: converges late joiners + picks up host uploads / new langs.
  useEffect(() => {
    if (!slug) return;
    setMetaLoading(true);
    void fetchMeta();
    const t = setInterval(fetchMeta, 10000);
    return () => clearInterval(t);
  }, [slug, fetchMeta]);

  // VTT → blob URL for the <track> element. Revoke the old URL first.
  const loadVtt = useCallback(
    async (wantedLang: string) => {
      if (!meta) {
        if (trackUrlRef.current) {
          URL.revokeObjectURL(trackUrlRef.current);
          trackUrlRef.current = null;
        }
        setTrackUrl(null);
        setTranslateAvailable(false);
        return;
      }
      setTrackLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/rooms/${slug}/subtitles?lang=${encodeURIComponent(wantedLang)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data.vtt) {
            const blob = new Blob([data.vtt], { type: "text/vtt" });
            const url = URL.createObjectURL(blob);
            if (trackUrlRef.current) URL.revokeObjectURL(trackUrlRef.current);
            trackUrlRef.current = url;
            setTrackUrl(url);
            setTranslateAvailable(false);
            return;
          }
        } else if (res.status === 404) {
          const data = await res.json().catch(() => ({}));
          if (data?.available === false) {
            // Translation not cached yet — keep originals, offer Translate.
            setTranslateAvailable(true);
            if (wantedLang !== "orig") {
              const orig = await fetch(`/api/rooms/${slug}/subtitles?lang=orig`);
              if (orig.ok) {
                const d = await orig.json();
                if (d.vtt) {
                  const blob = new Blob([d.vtt], { type: "text/vtt" });
                  const url = URL.createObjectURL(blob);
                  if (trackUrlRef.current) URL.revokeObjectURL(trackUrlRef.current);
                  trackUrlRef.current = url;
                  setTrackUrl(url);
                  return;
                }
              }
            }
          }
        }
        throw new Error("Couldn't load subtitles.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load subtitles.");
      } finally {
        setTrackLoading(false);
      }
    },
    [slug, meta]
  );

  useEffect(() => {
    void loadVtt(lang);
  }, [lang, loadVtt]);

  useEffect(() => {
    return () => {
      if (trackUrlRef.current) URL.revokeObjectURL(trackUrlRef.current);
    };
  }, []);

  /** Host/co-host upload: parse locally, post clean VTT text. */
  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const text = await file.text();
        const cues = parseSubtitleFile(text, file.name);
        const vtt = cuesToVtt(cues);
        const res = await fetch(`/api/rooms/${slug}/subtitles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vtt,
            name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "subtitles",
            actorId,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Upload failed.");
        setMeta(data.meta ?? null);
        setLang("orig");
        toast.success(`Subtitles synced for everyone (${cues.length} cues).`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        setError(msg);
        toast.error(msg);
      } finally {
        setUploading(false);
      }
    },
    [slug, actorId, setLang]
  );

  /** Translate into lang (cache-first server-side; 429 keeps originals). */
  const translate = useCallback(
    async (targetLang: string) => {
      const clean = targetLang.toLowerCase().slice(0, 8);
      if (!/^[a-z]{2,8}$/.test(clean)) {
        toast.error("Pick a language first.");
        return;
      }
      setTranslating(true);
      setError(null);
      try {
        const res = await fetch(`/api/rooms/${slug}/subtitles/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lang: clean, actorId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            res.status === 429
              ? "Translation is busy, try again later"
              : data?.error || "Translation failed."
          );
        }
        await fetchMeta();
        setLang(clean);
        toast.success(
          data?.cached ? "Loaded cached translation." : "Translated — enjoy!"
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Translation failed.";
        setError(msg);
        // Originals keep playing — this is informational, not fatal.
        toast.warning(msg);
      } finally {
        setTranslating(false);
      }
    },
    [slug, actorId, fetchMeta, setLang]
  );

  /** "Catch me up": recap of everything said up to currentTime. */
  const fetchRecap = useCallback(
    async (currentTime: number) => {
      setRecapLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/rooms/${slug}/recap`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentTime: Math.max(0, Math.floor(currentTime)), actorId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            res.status === 429
              ? "Translation is busy, try again later"
              : data?.error || "Couldn't catch you up."
          );
        }
        setRecap(String(data.recap || ""));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't catch you up.";
        setError(msg);
        toast.warning(msg);
      } finally {
        setRecapLoading(false);
      }
    },
    [slug, actorId]
  );

  // Custom tracks can't attach to YouTube or provider iframes — native
  // MP4/HLS/My Files only.
  const youtubeBlocked = videoType === "youtube" || videoType === "embed";

  return {
    meta,
    metaLoading,
    lang,
    setLang,
    size,
    setSize,
    trackUrl,
    trackLoading,
    uploading,
    translating,
    translateAvailable,
    recap,
    recapLoading,
    error,
    upload,
    translate,
    fetchRecap,
    refresh: fetchMeta,
    youtubeBlocked,
  };
}
