"use client";

import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import type { useRoomSubtitles, SubtitleSize } from "@/hooks/useRoomSubtitles";

type Subs = ReturnType<typeof useRoomSubtitles>;

const LANG_PRESETS = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "tw", label: "Twi" },
  { code: "de", label: "German" },
  { code: "yo", label: "Yoruba" },
  { code: "hi", label: "Hindi" },
] as const;

const SIZES: { id: SubtitleSize; label: string }[] = [
  { id: "s", label: "Small" },
  { id: "m", label: "Medium" },
  { id: "l", label: "Large" },
];

/**
 * Subtitles + AI panel. Host/co-hosts upload .srt/.vtt (server-enforced);
 * everyone picks a language, per-user size, Translate, and "Catch me up".
 * Mobile-first 44px targets, safe-area aware, loading + error states.
 */
export function SubtitlesPanel({
  subs,
  canUpload,
  getCurrentTime,
}: {
  subs: Subs;
  canUpload: boolean;
  getCurrentTime: () => number;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [customLang, setCustomLang] = useState("");

  const handleFile = (f: File | undefined) => {
    if (!f) return;
    if (!/\.(srt|vtt)$/i.test(f.name)) {
      toast.error("Upload a .srt or .vtt file.");
      return;
    }
    void subs.upload(f);
  };

  return (
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-none space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          💬 Subtitles &amp; AI
        </h3>
        {subs.meta && (
          <span className="text-[11px] text-muted-foreground font-mono">
            {subs.meta.cueCount} cues · {subs.meta.name}
          </span>
        )}
      </div>

      {subs.youtubeBlocked && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          ⚠️ Custom subtitles don&apos;t apply to YouTube embeds — switch to an
          MP4, HLS, or My Files source to use them.
        </p>
      )}

      {/* Upload (host/co-host only — server re-checks on every upload) */}
      {canUpload && !subs.youtubeBlocked && (
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept=".srt,.vtt"
            className="hidden"
            aria-label="Upload subtitle file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              handleFile(f);
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={subs.uploading}
            className="w-full min-h-11 text-xs cursor-pointer"
          >
            {subs.uploading ? (
              <span className="flex items-center gap-2">
                <Spinner className="text-violet-500" />
                Syncing subtitles…
              </span>
            ) : (
              <>📄 Upload .srt / .vtt for everyone</>
            )}
          </Button>
        </div>
      )}

      {/* No subtitles yet */}
      {!subs.metaLoading && !subs.meta && (
        <p className="text-xs text-muted-foreground" role="status">
          {canUpload
            ? "No subtitles yet — upload a file to get started."
            : "The host hasn't added subtitles yet."}
        </p>
      )}
      {subs.metaLoading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Spinner className="size-3.5 shrink-0 text-violet-500" />
          Loading subtitles…
        </p>
      )}

      {subs.meta && (
        <>
          {/* Language row */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Language (per person)
            </span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Subtitle language">
              <button
                type="button"
                onClick={() => subs.setLang("orig")}
                aria-pressed={subs.lang === "orig"}
                className={`min-h-11 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                  subs.lang === "orig"
                    ? "border-violet-500 bg-violet-500/15 text-foreground"
                    : "border-border bg-background/60 text-muted-foreground"
                }`}
              >
                Original
              </button>
              {subs.meta.langs.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => subs.setLang(l)}
                  aria-pressed={subs.lang === l}
                  className={`min-h-11 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                    subs.lang === l
                      ? "border-violet-500 bg-violet-500/15 text-foreground"
                      : "border-border bg-background/60 text-muted-foreground"
                  }`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            {/* Translate into a new language */}
            <div className="flex gap-1.5">
              <div className="flex flex-wrap gap-1.5 flex-1">
                {LANG_PRESETS.filter((p) => !subs.meta?.langs.includes(p.code)).slice(0, 4).map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    onClick={() => void subs.translate(p.code)}
                    disabled={subs.translating}
                    title={`Translate to ${p.label}`}
                    className="min-h-11 px-2.5 rounded-lg border border-dashed border-border text-[11px] text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
            </div>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (customLang.trim()) void subs.translate(customLang.trim());
                setCustomLang("");
              }}
            >
              <Input
                value={customLang}
                onChange={(e) => setCustomLang(e.target.value)}
                placeholder="Other language code (e.g. ga, ee)…"
                aria-label="Custom language code"
                maxLength={8}
                className="h-11 min-h-11 flex-1 text-xs"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={subs.translating || !customLang.trim()}
                className="h-11 min-h-11 px-4 text-xs cursor-pointer shrink-0"
              >
                🌐
              </Button>
            </form>
            {(subs.translating || subs.trackLoading) && (
              <p className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status">
                <Spinner className="size-3.5 shrink-0 text-violet-500" />
                {subs.translating ? "Translating (cached for next time)…" : "Loading captions…"}
              </p>
            )}
            {subs.translateAvailable && !subs.translating && (
              <p className="text-[11px] text-muted-foreground">
                No {subs.lang.toUpperCase()} version yet — tap a + language above
                to translate (originals keep playing meanwhile).
              </p>
            )}
          </div>

          {/* Size row (per-user, instant, no server round-trip) */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Caption size (just for you)
            </span>
            <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Caption size">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => subs.setSize(s.id)}
                  aria-pressed={subs.size === s.id}
                  className={`min-h-11 rounded-lg border text-xs font-semibold cursor-pointer ${
                    subs.size === s.id
                      ? "border-violet-500 bg-violet-500/15 text-foreground"
                      : "border-border bg-background/60 text-muted-foreground"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Catch me up */}
          <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/20 p-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => void subs.fetchRecap(getCurrentTime())}
              disabled={subs.recapLoading}
              className="w-full min-h-11 text-xs font-semibold cursor-pointer"
            >
              {subs.recapLoading ? (
                <span className="flex items-center gap-2">
                  <Spinner className="text-violet-500" />
                  Catching you up…
                </span>
              ) : (
                <>⚡ Catch me up</>
              )}
            </Button>
            {subs.recap && (
              <p className="text-xs leading-relaxed text-foreground" role="status">
                {subs.recap}
              </p>
            )}
          </div>
        </>
      )}

      {subs.error && (
        <p className="text-[11px] text-amber-700 dark:text-amber-300" role="alert">
          ⚠️ {subs.error}
        </p>
      )}
    </Card>
  );
}
