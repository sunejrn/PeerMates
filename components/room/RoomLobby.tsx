"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { detectVideoSource, VideoType } from "@/lib/video/detector";
import { PROVIDER_LABELS } from "@/lib/video/parseUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { AuthModal } from "@/components/auth/AuthModal";
import { JoinByCode } from "@/components/room/JoinByCode";
import { useLocalFilePick } from "@/hooks/useLocalFilePick";
import {
  formatBytes,
  formatDuration,
  LOCAL_FILE_ACCEPT,
  RIGHTS_NOTICE,
} from "@/lib/video/localfile";

interface Preset {
  label: string;
  type: VideoType;
  url: string;
}

const PRESETS: Preset[] = [
  {
    label: "YouTube: Big Buck Bunny",
    type: "youtube",
    url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  },
  {
    label: "HLS: Tears of Steel (.m3u8)",
    type: "hls",
    url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
  },
  {
    label: "Direct MP4: Sintel Movie",
    type: "mp4",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
  },
  {
    label: "Direct MP4: Big Buck Bunny",
    type: "mp4",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
  },
];

interface ProviderShortcut {
  name: string;
  desc: string;
  example: string;
}

/** Other sources: tap fills the URL field (editable) — parser detects each. */
const PROVIDER_SHORTCUTS: ProviderShortcut[] = [
  { name: "YouTube", desc: "Full sync · watch, shorts & live links", example: "https://www.youtube.com/watch?v=aqz-KE-bpKQ" },
  { name: "Facebook", desc: "Guided sync · public videos", example: "https://www.facebook.com/watch/?v=1234567890123456" },
  { name: "Vimeo", desc: "Guided sync · vimeo.com links", example: "https://vimeo.com/123456789" },
  { name: "Dailymotion", desc: "Guided sync · videos", example: "https://www.dailymotion.com/video/x8abcdef" },
  { name: "Twitch", desc: "Guided sync · past broadcasts (VODs)", example: "https://www.twitch.tv/videos/1234567890" },
  { name: "TikTok", desc: "Guided sync · videos", example: "https://www.tiktok.com/@peermates/video/7234567890123456789" },
  { name: "Instagram", desc: "Guided sync · Reels", example: "https://www.instagram.com/reel/C1234567890abcdef/" },
  { name: "Google Drive", desc: "Guided sync · preview link", example: "https://drive.google.com/file/d/1ABCdefGhI1234567890/view" },
  { name: "Streamable", desc: "Guided sync · clips", example: "https://streamable.com/abcdef" },
  { name: "Loom", desc: "Guided sync · share links", example: "https://www.loom.com/share/1234567890abcdef1234567890abcdef" },
  { name: "Internet Archive", desc: "Full sync · details or download links", example: "https://archive.org/details/big_buck_bunny" },
  { name: "Dropbox", desc: "Full sync · shared file links", example: "https://www.dropbox.com/s/abc123def456/movie.mp4?dl=0" },
  { name: "HLS stream", desc: "Full sync · any .m3u8 link", example: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
  { name: "Direct MP4", desc: "Full sync · any video file link", example: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" },
];

export function RoomLobby() {
  const router = useRouter();
  const { data: session } = useSession();
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [sourceTab, setSourceTab] = useState<"link" | "myfiles">("link");
  const [rightsOk, setRightsOk] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  /** Step 2 of Other sources: provider picked, now title + own link. */
  const [sourceDraft, setSourceDraft] = useState<ProviderShortcut | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const filePick = useLocalFilePick();

  const closeSources = () => {
    setShowSources(false);
    setSourceDraft(null);
  };

  const pickProvider = (p: ProviderShortcut) => {
    setSourceDraft(p);
    setDraftTitle(title || `${p.name} watch party`);
    setDraftUrl(p.example);
  };

  const draftDetection = detectVideoSource(draftUrl);

  const useDraftLink = () => {
    if (!sourceDraft || !draftUrl.trim() || !draftDetection.isValid) return;
    setVideoUrl(draftUrl.trim());
    if (!title) setTitle(draftTitle.trim() || `${sourceDraft.name} watch party`);
    closeSources();
  };

  const detection = detectVideoSource(videoUrl);

  // Provider preview: best-effort official oEmbed title (YouTube/Vimeo),
  // otherwise the provider chip + control level. Never blocks creation.
  const [oembedTitle, setOembedTitle] = useState<string | null>(null);
  useEffect(() => {
    setOembedTitle(null);
    if (sourceTab !== "link" || !detection.isValid || !detection.cleanUrl) return;
    let cancelled = false;
    const run = async () => {
      try {
        let endpoint: string | null = null;
        if (detection.provider === "youtube" && detection.videoId) {
          endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(detection.cleanUrl)}&format=json`;
        } else if (detection.provider === "vimeo") {
          endpoint = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(detection.cleanUrl)}`;
        }
        if (!endpoint) return;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(endpoint, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok || cancelled) return;
        const data = await res.json().catch(() => null);
        if (data?.title && !cancelled) setOembedTitle(String(data.title).slice(0, 80));
      } catch {
        // preview is best-effort only
      }
    };
    const timer = setTimeout(run, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceTab, detection.isValid, detection.cleanUrl, detection.provider, detection.videoId]);

  const checkHasCreatedOnce = () => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("watchtogether_has_created_once") === "true";
  };

  /** Server error codes → human messages (never show raw codes in toasts). */
  const friendlyCreateError = (data: {
    error?: string;
    message?: string;
    retryAfter?: number;
  }) => {
    if (data.error === "RATE_LIMITED") {
      const wait =
        typeof data.retryAfter === "number" && data.retryAfter > 0
          ? ` Try again in ${data.retryAfter}s.`
          : "";
      return `Too many rooms created.${wait}`;
    }
    return data.message || data.error || "Failed to create room";
  };

  const handleSelectPreset = (preset: Preset) => {
    if (!session?.user && checkHasCreatedOnce()) {
      setShowAuthModal(true);
      return;
    }
    setVideoUrl(preset.url);
    if (!title) {
      setTitle(preset.label);
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session?.user && checkHasCreatedOnce()) {
      setShowAuthModal(true);
      return;
    }

    if (sourceTab === "myfiles") {
      await handleCreateLocalFileRoom();
      return;
    }

    if (!videoUrl.trim()) {
      toast.error("Please enter a video URL.");
      return;
    }

    if (!detection.isValid) {
      toast.error(
        detection.detail ||
          "Please enter a valid YouTube, HLS (.m3u8), or MP4/WebM video URL."
      );
      return;
    }

    try {
      setIsCreating(true);
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: videoUrl.trim(),
          title: title.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        if (data.error === "AUTH_REQUIRED") {
          setShowAuthModal(true);
          return;
        }
        throw new Error(friendlyCreateError(data));
      }

      if (!session?.user && typeof window !== "undefined") {
        localStorage.setItem("watchtogether_has_created_once", "true");
      }

      toast.success("PeerMates room created!");
      router.push(`/room/${data.slug}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to create party");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCreateLocalFileRoom = async () => {
    if (!filePick.file || !filePick.fp || filePick.phase !== "ready") {
      toast.error("Pick a playable video file first.");
      return;
    }
    if (!rightsOk) {
      toast.error("Please confirm you have the right to play this file.");
      return;
    }
    try {
      setIsCreating(true);
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:
            title.trim() ||
            filePick.file.name.replace(/\.[^.]+$/, "") ||
            "PeerMates Party",
          localFile: filePick.fp,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        if (data.error === "AUTH_REQUIRED") {
          setShowAuthModal(true);
          return;
        }
        throw new Error(friendlyCreateError(data));
      }

      if (!session?.user && typeof window !== "undefined") {
        localStorage.setItem("watchtogether_has_created_once", "true");
      }

      toast.success("PeerMates Party created! Pick the file again inside the room.");
      router.push(`/room/${data.slug}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to create party");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="w-full">
      {/* Three cards on lg/xl with gaps; single column on mobile/medium */}
      <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-3 items-stretch justify-center gap-6 max-w-6xl mx-auto">
        {/* Form Card */}
        <Card className="w-full border-border bg-card/70 p-5 sm:p-8 backdrop-blur-xl shadow-none rounded-2xl flex flex-col justify-between">
          <div className="space-y-2 mb-6 text-left">
            <h2 className="text-xl sm:text-2xl font-bold text-card-foreground tracking-tight flex items-center gap-2">
              Start a PeerMates Party
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Paste any YouTube URL, HLS stream (.m3u8), or direct video file link
              or bring your own movie with My Files to sync playback with your friends.
            </p>
          </div>

          <form onSubmit={handleCreateRoom} className="space-y-4 sm:space-y-5 text-left flex-1 flex flex-col justify-between">
            <div className="space-y-4">
              {/* Source tabs: link vs bring-your-own file */}
              <div
                className="grid grid-cols-2 gap-1 p-1 bg-muted/60 rounded-xl border border-border"
                role="tablist"
                aria-label="Video source"
              >
                {(
                  [
                    { id: "link", label: "🔗 Link / URL" },
                    { id: "myfiles", label: "📁 My Files" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={sourceTab === t.id}
                    onClick={() => setSourceTab(t.id)}
                    className={`min-h-11 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      sourceTab === t.id
                        ? "bg-background text-foreground shadow-none"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Party Title (Optional)
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Movie Night with Friends"
                  className="h-11 sm:h-10 bg-background/80 border-input text-foreground focus-visible:ring-violet-500 text-sm"
                />
              </div>

              {sourceTab === "link" ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Video URL
                  </label>
                  {videoUrl.trim() && (
                    <Badge
                      variant="outline"
                      className={
                        detection.isValid
                          ? detection.type === "youtube"
                            ? "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400"
                            : detection.type === "hls"
                            ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                            : "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      }
                    >
                      {detection.isValid
                        ? `Format: ${detection.type?.toUpperCase()}`
                        : "Invalid Format"}
                    </Badge>
                  )}
                </div>

                <Input
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="YouTube link — or Other sources below for more"
                  className="h-11 sm:h-10 bg-background/80 border-input text-foreground focus-visible:ring-violet-500 font-mono text-xs sm:text-sm"
                  required={sourceTab === "link"}
                />
                <button
                  type="button"
                  onClick={() => setShowSources(true)}
                  className="min-h-11 w-full rounded-lg border border-border bg-background/60 px-3 text-xs font-semibold text-foreground cursor-pointer hover:bg-muted"
                >
                  Other sources — Facebook, Vimeo, TikTok & more
                </button>
                {/* Auto-detect preview: provider + control level before starting */}
                {videoUrl.trim() && detection.isValid && detection.provider && (
                  <div className="space-y-1 rounded-lg border border-border bg-background/60 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-semibold">
                        {PROVIDER_LABELS[detection.provider] ?? detection.provider}
                      </span>
                      <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {detection.control === "guided" ? "Guided sync" : "Full sync"}
                      </span>
                    </div>
                    {oembedTitle ? (
                      <p className="truncate text-xs text-muted-foreground">{oembedTitle}</p>
                    ) : (
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {detection.providerId ?? detection.cleanUrl}
                      </p>
                    )}
                    {detection.control === "guided" && (
                      <p className="text-[11px] text-muted-foreground">
                        Countdown sync — everyone taps Play on their own player at GO.
                      </p>
                    )}
                  </div>
                )}
              </div>
              ) : (
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Your movie file
                </span>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Everyone picks the <strong className="text-foreground">same movie</strong> on
                  their own device — nothing is uploaded, so multi-GB files work. Only
                  timestamps sync.
                </p>
                <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-xs font-medium text-foreground hover:border-violet-500/50 transition-all">
                  <input
                    type="file"
                    accept={LOCAL_FILE_ACCEPT}
                    className="hidden"
                    aria-label="Choose a movie file on this device"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setRightsOk(false);
                      if (f && !title) {
                        setTitle(f.name.replace(/\.[^.]+$/, ""));
                      }
                      void filePick.pickFile(f);
                      e.target.value = "";
                    }}
                  />
                  📂 {filePick.file ? filePick.file.name : "Choose movie file…"}
                </label>

                {(filePick.phase === "preflight" || filePick.phase === "fingerprint") && (
                  <div className="space-y-1.5" role="status">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Spinner className="shrink-0 text-violet-500" />
                      {filePick.phase === "preflight"
                        ? "Checking compatibility…"
                        : `Fingerprinting (3 × 1 MB)… ${Math.round(filePick.progress * 100)}%`}
                    </div>
                    {filePick.phase === "fingerprint" && (
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-violet-500 transition-all"
                          style={{ width: `${Math.round(filePick.progress * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {filePick.phase === "error" && (
                  <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs space-y-1" role="alert">
                    <p className="font-semibold text-red-600 dark:text-red-400">❌ {filePick.error}</p>
                    {filePick.tip && <p className="text-muted-foreground">💡 {filePick.tip}</p>}
                  </div>
                )}

                {filePick.phase === "ready" && filePick.fp && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs space-y-1">
                    <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                      ✅ Playable here — {formatBytes(filePick.fp.size)} · {formatDuration(filePick.fp.duration)}
                    </p>
                    {filePick.preflight?.warning && (
                      <p className="text-amber-700 dark:text-amber-300">⚠️ {filePick.preflight.warning}</p>
                    )}
                    <p className="text-muted-foreground">
                      Viewers compare their copy against yours automatically. You&apos;ll pick the
                      file again inside the room (browsers can&apos;t keep it).
                    </p>
                  </div>
                )}

                <label className="flex items-start gap-2 cursor-pointer rounded-md px-1 py-2 min-h-11">
                  <input
                    type="checkbox"
                    checked={rightsOk}
                    onChange={(e) => setRightsOk(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-violet-600"
                  />
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {RIGHTS_NOTICE}
                  </span>
                </label>
              </div>
              )}

              {/* Presets live behind a button now — modal with all four */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowPresets(true)}
                  className="min-h-11 w-full rounded-lg border border-dashed border-border bg-background/60 px-3 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground"
                >
                  Test presets
                </button>
              </div>
            </div>

            {/* Submit Button - large 44px+ tap target */}
            <Button
              type="submit"
              disabled={
                isCreating ||
                (sourceTab === "link" && videoUrl.trim() !== "" && !detection.isValid) ||
                (sourceTab === "myfiles" &&
                  (filePick.phase !== "ready" || !filePick.fp || !rightsOk))
              }
              className="w-full h-12 sm:h-11 mt-4 bg-[#333] dark:bg-white dark:text-black border text-white font-semibold shadow-none transition-all cursor-pointer"
            >
              {isCreating ? (
                <span className="flex items-center gap-2">
                  <Spinner className="text-white" />
                  Creating Room...
                </span>
              ) : (
                "Create PeerMates Party"
              )}
            </Button>
          </form>
        </Card>

        {/* How PeerMates works — second column on lg/xl, stacked below on mobile */}
        <div className="flex w-full flex-col justify-between rounded-2xl border border-border bg-card/40 p-6 sm:p-8 backdrop-blur-md text-left space-y-6">
          <div className="space-y-3">
            <h3 className="text-2xl font-bold text-card-foreground">
              How PeerMates Works
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Engineered with a host-authoritative sync model, millisecond transit correction, and persistent Upstash Redis caching.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="space-y-0.5">
                <h4 className="text-sm font-semibold text-foreground">
                  Frame-Accurate Host Control
                </h4>
                <p className="text-xs text-muted-foreground">
                  Whenever the host plays, pauses, or seeks, followers reconcile within &plusmn;0.5s with zero seek-thrashing.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="space-y-0.5">
                <h4 className="text-sm font-semibold text-foreground">
                  Unified Player Engine
                </h4>
                <p className="text-xs text-muted-foreground">
                  Supports YouTube embeds, adaptive HLS (.m3u8) streams, and direct MP4 files through an identical control interface.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="space-y-0.5">
                <h4 className="text-sm font-semibold text-foreground">
                  Realtime Presence & Host Migration
                </h4>
                <p className="text-xs text-muted-foreground">
                  GetStream channel powers live chat, viewer presence avatars, and promotes the longest-tenured viewer if host leaves.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-border/60 text-[11px] text-muted-foreground flex items-center justify-between">
            <span>Powered by Next.js &amp; GetStream</span>
          </div>
        </div>

        {/* Join with a code — third column on lg/xl, stacked on mobile/medium */}
        <div className="flex w-full">
          <JoinByCode />
        </div>
      </div>

      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        title="Sign In Required"
        description="You have already used your 1 free party creation. Please sign in with Google or GitHub to create unlimited PeerMates parties and invite your friends."
      />

      {/* Other sources — two steps. Step 1 lists providers; tapping one
          keeps this open and docks a detail panel (title + your own link)
          beside it on desktop with a connector, or full-screen-normal
          on mobile. */}
      {showSources && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Other video sources">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={closeSources}
            aria-hidden
          />
          <div className="relative flex max-h-[80dvh] w-full max-w-md flex-col items-stretch md:max-w-4xl md:flex-row">
            {/* Step 1: provider list (hidden on mobile once step 2 opens) */}
            <div className={`${sourceDraft ? "hidden md:flex" : "flex"} max-h-[80dvh] w-full flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-none md:max-w-md`}>
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <h3 className="text-sm font-semibold">Other sources</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Pick a provider, then add your title + link.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeSources}
                  aria-label="Close other sources"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <div className="no-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">
                {PROVIDER_SHORTCUTS.map((p) => {
                  const selected = sourceDraft?.name === p.name;
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => pickProvider(p)}
                      aria-pressed={selected}
                      className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left cursor-pointer hover:bg-muted ${
                        selected ? "border-foreground bg-muted" : "border-border"
                      }`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-sm font-bold">
                        {p.name.charAt(0)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold">{p.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {p.desc}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground/70">
                          {p.example}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Figma-style connector (desktop only) */}
            {sourceDraft && (
              <div className="hidden w-14 shrink-0 items-center justify-center md:flex" aria-hidden>
                <svg viewBox="0 0 48 24" className="w-12 text-foreground" fill="none">
                  <line x1="8" y1="12" x2="40" y2="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />
                  <circle cx="6" cy="12" r="3" fill="currentColor" />
                  <circle cx="42" cy="12" r="3" fill="currentColor" />
                </svg>
              </div>
            )}

            {/* Step 2: title + own link (side panel on desktop, normal modal on mobile) */}
            {sourceDraft && (
              <div className="flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-none md:max-w-md">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold">
                      {sourceDraft.name} link
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      Add your title + paste your own {sourceDraft.name} URL.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSourceDraft(null)}
                    aria-label="Back to providers"
                    className="flex h-11 shrink-0 items-center rounded-lg px-3 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer md:hidden"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={closeSources}
                    aria-label="Close"
                    className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer md:flex"
                  >
                    ✕
                  </button>
                </div>
                <div className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="source-draft-title">
                      Party title
                    </label>
                    <Input
                      id="source-draft-title"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      placeholder={`${sourceDraft.name} watch party`}
                      className="h-11 bg-background/80 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" htmlFor="source-draft-url">
                      {sourceDraft.name} video URL
                    </label>
                    <Input
                      id="source-draft-url"
                      value={draftUrl}
                      onChange={(e) => setDraftUrl(e.target.value)}
                      placeholder={sourceDraft.example}
                      inputMode="url"
                      className="h-11 bg-background/80 font-mono text-xs"
                    />
                  </div>
                  {draftUrl.trim() && (
                    draftDetection.isValid ? (
                      <div className="space-y-1 rounded-lg border border-border bg-background/60 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-semibold">
                            {(draftDetection.provider && PROVIDER_LABELS[draftDetection.provider]) ?? "Video"}
                          </span>
                          <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {draftDetection.control === "guided" ? "Guided sync" : "Full sync"}
                          </span>
                        </div>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {draftDetection.providerId ?? draftDetection.cleanUrl}
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300" role="alert">
                        {draftDetection.detail || "That link doesn't look usable yet — keep editing."}
                      </p>
                    )
                  )}
                  <Button
                    type="button"
                    onClick={useDraftLink}
                    disabled={!draftUrl.trim() || !draftDetection.isValid}
                    className="min-h-11 w-full bg-foreground text-background text-xs font-semibold disabled:opacity-50"
                  >
                    Use this link
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Test presets modal — the four sample videos, organized */}
      {showPresets && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Test presets">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowPresets(false)}
            aria-hidden
          />
          <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-none">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">Test presets</h3>
                <p className="text-[11px] text-muted-foreground">
                  Sample videos to try PeerMates instantly.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowPresets(false)}
                aria-label="Close test presets"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="space-y-1 p-3">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    handleSelectPreset(p);
                    setShowPresets(false);
                  }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left cursor-pointer hover:bg-muted"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{p.label}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {p.url}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
