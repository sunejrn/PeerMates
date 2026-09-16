"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { UnifiedPlayerRef } from "@/components/player/types";
import { RoomRecord } from "@/lib/rooms/store";
import { PresenceBar } from "@/components/room/PresenceBar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SyncStatusIndicator } from "@/components/room/SyncStatusIndicator";
import { useWatchSync } from "@/hooks/useWatchSync";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AuthButton } from "@/components/auth/AuthButton";
import { toast } from "sonner";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";

export default function RoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = use(params);
  const slug = resolvedParams.slug;

  const { data: session, isPending: isAuthPending } = useSession();
  const playerRef = useRef<UnifiedPlayerRef>(null);

  const [room, setRoom] = useState<RoomRecord | null>(null);
  const [isLoadingRoom, setIsLoadingRoom] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  // Mobile tab state for narrow viewports (< lg)
  const [mobileTab, setMobileTab] = useState<"video-info" | "chat">("video-info");

  // Fetch room metadata
  useEffect(() => {
    async function fetchRoom() {
      try {
        setIsLoadingRoom(true);
        const res = await fetch(`/api/rooms/${slug}`);
        if (!res.ok) throw new Error("Room not found");
        const data = await res.json();
        setRoom(data.room);
      } catch (err: any) {
        toast.error(err?.message || "Failed to load watch party");
      } finally {
        setIsLoadingRoom(false);
      }
    }
    fetchRoom();
  }, [slug]);

  // Stable join timestamp and memoized member object to prevent re-render loops
  const joinedAtRef = useRef<number>(Date.now());
  const currentUser = useMemo(
    () => ({
      id: session?.user?.id || "guest",
      name: session?.user?.name || "Guest",
      image: session?.user?.image || undefined,
      role: (room?.hostId === session?.user?.id ? "host" : "viewer") as
        | "host"
        | "viewer",
      joinedAt: joinedAtRef.current,
    }),
    [session?.user?.id, session?.user?.name, session?.user?.image, room?.hostId]
  );

  // Synchronized Watch Party Engine (Phase 4, 5, 6)
  const {
    isHost,
    hostId,
    syncState,
    driftSeconds,
    members,
    messages,
    isHostBuffering,
    handleHostPlayerEvent,
    sendMessage,
  } = useWatchSync({
    slug,
    initialHostId: room?.hostId || "",
    currentUser,
    playerRef,
  });

  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Watch party invite link copied to clipboard!");
    }
  };

  const handleClaimHost = async () => {
    if (!session?.user) return;
    try {
      const res = await fetch(`/api/rooms/${slug}/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newHostId: session.user.id }),
      });
      if (res.ok) {
        toast.success("You are now the room host! 👑");
      }
    } catch {
      toast.error("Failed to request host role");
    }
  };

  const handleGitHubSignIn = async () => {
    try {
      setIsSigningIn(true);
      await signIn.social({
        provider: "github",
        callbackURL:
          typeof window !== "undefined" ? window.location.href : `/room/${slug}`,
      });
    } catch (err) {
      console.error("Sign in error:", err);
    } finally {
      setIsSigningIn(false);
    }
  };

  // Loading state
  if (isAuthPending || isLoadingRoom) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <p className="text-sm">Connecting to Watch Party...</p>
        </div>
      </div>
    );
  }

  // Room not found
  if (!room) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center text-foreground">
        <h1 className="text-3xl font-bold text-destructive">Room Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The watch party for code{" "}
          <code className="font-mono text-foreground font-semibold">/{slug}</code>{" "}
          does not exist or has expired.
        </p>
        <Button className="mt-6 bg-violet-600 hover:bg-violet-500 text-white">
          <Link href="/">Return to Lobby</Link>
        </Button>
      </div>
    );
  }

  // MANDATORY AUTHENTICATION GATE
  if (!session?.user) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <header className="flex h-16 items-center justify-between border-b border-border/80 px-4 sm:px-6 backdrop-blur-md">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            ← Back to Lobby
          </Link>
          <AuthButton />
        </header>

        <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
          <Card className="w-full max-w-md border-border bg-card/75 p-6 sm:p-8 text-center backdrop-blur-xl shadow-2xl rounded-2xl space-y-6">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-600/15 border border-violet-500/30 text-violet-600 dark:text-violet-400 shadow-md">
              <svg
                className="h-7 w-7"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>

            <div className="space-y-2">
              <Badge
                variant="outline"
                className="border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs px-2.5 py-0.5"
              >
                Watch Party #{slug}
              </Badge>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                Authentication Required
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                You must sign in with GitHub to join{" "}
                <strong className="text-foreground">"{room.title}"</strong>.
                Required to sync playback with friends, chat live, and participate.
              </p>
            </div>

            <Button
              onClick={handleGitHubSignIn}
              disabled={isSigningIn}
              className="w-full h-12 gap-2.5 bg-foreground text-background hover:bg-foreground/90 font-semibold shadow-lg cursor-pointer"
            >
              <svg
                className="h-5 w-5 fill-current shrink-0"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              {isSigningIn ? "Connecting to GitHub..." : "Sign in with GitHub to Join"}
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  // ACTIVE WATCH PARTY ROOM
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-200">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border/80 bg-background/85 px-3 sm:px-6 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <span className="text-violet-500">←</span>
            <span className="hidden xs:inline">Lobby</span>
          </Link>

          <div className="h-4 w-px bg-border shrink-0 hidden sm:block" />

          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <h1 className="text-xs sm:text-base font-bold text-foreground truncate max-w-30 sm:max-w-xs">
              {room.title}
            </h1>
            <Badge
              variant="outline"
              className="border-border bg-muted/60 font-mono text-[10px] sm:text-[11px] text-muted-foreground shrink-0"
            >
              #{slug}
            </Badge>
          </div>

          <SyncStatusIndicator
            syncState={syncState}
            driftSeconds={driftSeconds}
            isHost={isHost}
          />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopyLink}
            className="border-border bg-card/80 text-xs text-foreground hover:bg-muted h-9 px-2.5 sm:px-3"
            aria-label="Copy Invite Link"
          >
            📋 <span className="hidden sm:inline ml-1">Copy Link</span>
          </Button>
          <AuthButton />
        </div>
      </header>

      {/* Main Room Layout: Responsive 2-column on desktop (lg+), single column with switcher on mobile/tablet */}
      <main className="flex flex-1 flex-col lg:flex-row p-3 sm:p-6 gap-4 sm:gap-6 max-w-[1600px] mx-auto w-full">
        {/* Left Column: Video Player & Controls */}
        <div className="flex flex-1 flex-col gap-3 sm:gap-4 min-w-0">
          {/* Host Buffering Notice Banner */}
          {isHostBuffering && !isHost && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 animate-pulse">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span>Host is buffering. Playback paused for everyone until host resumes...</span>
            </div>
          )}

          {/* Unified Video Player - 16:9 aspect-video maintained across all screens */}
          <div className="w-full">
            <VideoPlayer
              ref={playerRef}
              src={room.videoSource}
              videoType={room.videoType}
              isHost={isHost}
              onPlayerEvent={handleHostPlayerEvent}
            />
          </div>

          {/* Mobile Tab Switcher for Narrow Viewports (< lg) */}
          <div className="flex lg:hidden items-center justify-center w-full p-1 bg-muted/60 rounded-xl border border-border mt-1">
            <button
              type="button"
              onClick={() => setMobileTab("video-info")}
              className={`flex-1 min-h-11 flex items-center justify-center rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                mobileTab === "video-info"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              👥 Watching &amp; Info ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("chat")}
              className={`flex-1 min-h-11 flex items-center justify-center rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                mobileTab === "chat"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              💬 Live Chat ({messages.length})
            </button>
          </div>

          {/* Video Info & Controls Panel (Visible on Desktop OR when mobileTab === 'video-info') */}
          <div
            className={`flex flex-col gap-3 sm:gap-4 ${
              mobileTab === "video-info" ? "flex" : "hidden lg:flex"
            }`}
          >
            {/* Presence Bar */}
            <Card className="border-border bg-card/60 px-3 sm:px-4 py-2 backdrop-blur-sm rounded-xl shadow-sm">
              <PresenceBar
                members={members}
                currentUserId={session.user.id}
                hostId={hostId}
              />
            </Card>

            {/* Host Controls & Sync Panel */}
            <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <span>Host-Authoritative Sync</span>
                    {isHost ? (
                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[10px]">
                        👑 You are the Host
                      </Badge>
                    ) : (
                      <Badge className="bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30 text-[10px]">
                        Follower Mode
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isHost
                      ? "Your player actions broadcast frame state and a 3-second heartbeat to followers."
                      : "Playback automatically aligns with the host if drift exceeds 0.5 seconds."}
                  </p>
                </div>

                {!isHost && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleClaimHost}
                    className="min-h-11 sm:min-h-9 border-border bg-card/80 text-xs text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 cursor-pointer"
                  >
                    👑 Request Host Role
                  </Button>
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Right Column: Live Chat Panel (Always docked on desktop lg+, or in 'chat' tab on mobile) */}
        <div
          className={`w-full lg:w-85 xl:w-95 shrink-0 h-120 lg:h-[calc(100vh-6.5rem)] min-h-100 flex flex-col ${
            mobileTab === "chat" ? "flex" : "hidden lg:flex"
          }`}
        >
          <ChatPanel
            messages={messages}
            currentUserId={session.user.id}
            onSendMessage={sendMessage}
          />
        </div>
      </main>
    </div>
  );
}
