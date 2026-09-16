"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { detectVideoSource, VideoType } from "@/lib/video/detector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import { AuthModal } from "@/components/auth/AuthModal";

interface Preset {
  label: string;
  type: VideoType;
  url: string;
}

const PRESETS: Preset[] = [
  // {
  //   label: "YouTube: Big Buck Bunny",
  //   type: "youtube",
  //   url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  // },
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
];

export function RoomLobby() {
  const router = useRouter();
  const { data: session } = useSession();
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

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

      toast.success("Watch Party room created!");
      router.push(`/room/${data.slug}`);
    } catch (err: any) {
      toast.error(err?.message || "Failed to create watch party");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="w-full">
      {/* Responsive layout: Single-column on mobile/tablet, 2-column on lg+ desktop */}
      <div className="flex flex-col lg:flex-row items-stretch justify-center gap-6 lg:gap-8 max-w-5xl mx-auto">
        {/* Form Card (Max 480px on desktop, 100% on mobile) */}
        <Card className="w-full lg:max-w-120 border-border bg-card/70 p-5 sm:p-8 backdrop-blur-xl shadow-xl shadow-violet-950/5 dark:shadow-violet-950/20 rounded-2xl flex flex-col justify-between">
          <div className="space-y-2 mb-6 text-left">
            <h2 className="text-xl sm:text-2xl font-bold text-card-foreground tracking-tight flex items-center gap-2">
              Start a Watch Party
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Paste any YouTube URL, HLS stream (.m3u8), or direct video file link
              to sync playback with your friends.
            </p>
          </div>

          <form onSubmit={handleCreateRoom} className="space-y-4 sm:space-y-5 text-left flex-1 flex flex-col justify-between">
            <div className="space-y-4">
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
                  required
                />
              </div>

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
              disabled={isCreating || (videoUrl.trim() !== "" && !detection.isValid)}
              className="w-full h-12 sm:h-11 mt-4 bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold shadow-lg shadow-violet-600/25 transition-all cursor-pointer"
            >
              {isCreating ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Creating Room...
                </span>
              ) : (
                "Create Watch Party"
              )}
            </Button>
          </form>
        </Card>

        {/* Desktop Supporting "How it works" Panel (Visible on lg+) */}
        <div className="hidden lg:flex flex-1 flex-col justify-between rounded-2xl border border-border bg-card/40 p-8 backdrop-blur-md text-left space-y-6">
          <div className="space-y-3">
            <span className="inline-block rounded-full bg-violet-500/10 border border-violet-500/20 px-3 py-1 text-xs font-semibold text-violet-600 dark:text-violet-400">
              Instant Synchronized Streaming
            </span>
            <h3 className="text-2xl font-bold text-card-foreground">
              How WatchTogether Works
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Engineered with a host-authoritative sync model, millisecond transit correction, and persistent Upstash Redis caching.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 font-bold text-sm">
                1
              </div>
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
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-bold text-sm">
                2
              </div>
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
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                3
              </div>
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
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Operational
            </span>
          </div>
        </div>
      </div>

      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        title="Sign In Required"
        description="You have already used your 1 free party creation. Please sign in with GitHub to create unlimited watch parties and invite your friends."
      />
    </div>
  );
}
