"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { detectVideoSource, VideoType } from "@/lib/video/detector";
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

export function RoomLobby() {
  const router = useRouter();
  const { data: session } = useSession();
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [sourceTab, setSourceTab] = useState<"link" | "myfiles">("link");
  const [rightsOk, setRightsOk] = useState(false);
  const filePick = useLocalFilePick();

  const detection = detectVideoSource(videoUrl);

  const checkHasCreatedOnce = () => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("watchtogether_has_created_once") === "true";
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
        throw new Error(data.error || data.message || "Failed to create room");
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
        throw new Error(data.error || data.message || "Failed to create room");
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
                  placeholder="https://www.youtube.com/watch?v=... or .m3u8"
                  className="h-11 sm:h-10 bg-background/80 border-input text-foreground focus-visible:ring-violet-500 font-mono text-xs sm:text-sm"
                  required={sourceTab === "link"}
                />
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

              {/* Presets - touch friendly min 44px tap targets */}
              <div className="space-y-2 pt-1">
                <span className="text-xs text-muted-foreground font-medium">
                  Or pick a test preset:
                </span>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handleSelectPreset(p)}
                      className="min-h-9.5 sm:min-h-9.5 rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-xs text-foreground hover:border-violet-500/50 hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-300 transition-all cursor-pointer select-none"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
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
    </div>
  );
}
