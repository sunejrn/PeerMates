"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { VideoPlayer } from "@/components/player/VideoPlayer";
import { UnifiedPlayerRef } from "@/components/player/types";
import { RoomRecord } from "@/lib/rooms/store";
import { PresenceBar } from "@/components/room/PresenceBar";
import { ViewerList } from "@/components/room/ViewerList";
import { ModerationPanel } from "@/components/room/ModerationPanel";
import { LocalFileGate } from "@/components/room/LocalFileGate";
import { StreamFromHostPanel } from "@/components/room/StreamFromHost";
import { DataPanel } from "@/components/room/DataPanel";
import { useDataSaver } from "@/hooks/useDataSaver";
import { useDataMeter } from "@/hooks/useDataMeter";
import { regionFromLocale } from "@/lib/data/pricing";
import {
  createLocalObjectUrl,
  revokeLocalObjectUrl,
  type LocalFingerprint,
} from "@/lib/video/localfile";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { SyncStatusIndicator } from "@/components/room/SyncStatusIndicator";
import { useWatchSync } from "@/hooks/useWatchSync";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { AuthButton } from "@/components/auth/AuthButton";
import { Spinner } from "@/components/ui/spinner";
import { InviteSheet } from "@/components/room/InviteSheet";
import { NicknameGate } from "@/components/room/NicknameGate";
import { SubtitlesPanel } from "@/components/room/SubtitlesPanel";
import { useGuestIdentity } from "@/hooks/useGuestIdentity";
import { useRoomSubtitles } from "@/hooks/useRoomSubtitles";
import { useReplayCapture } from "@/hooks/useReplayCapture";
import { EndPartyPanel } from "@/components/replay/EndPartyPanel";
import { toast } from "sonner";
import Link from "next/link";

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
  const [isRequestingControl, setIsRequestingControl] = useState(false);
  const [isClaimingHost, setIsClaimingHost] = useState(false);
  // ---- "My Files" local playback state (per-device, never uploaded) ----
  const [hostFp, setHostFp] = useState<LocalFingerprint | null>(null);
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError] = useState<string | null>(null);
  const [localFile, setLocalFile] = useState<{ file: File; url: string } | null>(null);
  const [localMatch, setLocalMatch] = useState<boolean | null>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  // Mobile tab state for narrow viewports (< lg)
  const [mobileTab, setMobileTab] = useState<"video-info" | "chat">("video-info");
  // Mobile navigation drawer (Claude/Codex-style slide-in)
  const [navOpen, setNavOpen] = useState(false);

  // Fetch room metadata
  useEffect(() => {
    async function fetchRoom() {
      try {
        setIsLoadingRoom(true);
        const res = await fetch(`/api/rooms/${slug}`);
        if (!res.ok) throw new Error("Room not found");
        const data = await res.json();
        setRoom(data.room);
      } catch (err: unknown) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load PeerMates party"
        );
      } finally {
        setIsLoadingRoom(false);
      }
    }
    fetchRoom();
  }, [slug]);

  // ---- Guest identity (nickname-only join, no signup) ----
  const { guestId, nickname, saveNickname } = useGuestIdentity();

  // Stable join timestamp and memoized member object to prevent re-render loops
  const [joinedAt] = useState<number>(() => Date.now());
  const effectiveId = session?.user?.id || guestId;
  const effectiveName = session?.user?.name || nickname || "Guest";
  const currentUser = useMemo(
    () => ({
      id: effectiveId,
      name: effectiveName,
      image: session?.user?.image || undefined,
      role: (room?.hostId === effectiveId ? "host" : "viewer") as
        | "host"
        | "viewer",
      joinedAt,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveId, effectiveName, session?.user?.image, room?.hostId, joinedAt]
  );

  // ---- Party Replay capture primitives (wrappers below, after sync) ----
  const { captureSend, captureReaction, captureDelete } = useReplayCapture({
    slug,
    actorId: effectiveId,
    actorName: effectiveName,
    getVideoTime: () => playerRef.current?.getCurrentTime() ?? 0,
  });

  // ---- Room subtitles (host/co-host upload, per-user language + size) ----
  const subs = useRoomSubtitles({
    slug,
    actorId: effectiveId,
    videoType: room?.videoType,
  });

  // Synchronized PeerMates Engine (Phase 4, 5, 6 + roles/moderation)
  const {
    isHost,
    isCohost,
    canControl,
    hostId,
    syncState,
    driftSeconds,
    connection,
    reconnecting,
    members,
    messages,
    isHostBuffering,
    handleHostPlayerEvent,
    sendRich,
    uploadMedia,
    reactToMessage,
    deleteMessage,
    typingUsers,
    sendTyping,
    chatSettings,
    controlRequests,
    mutedIds,
    myRequestPending,
    amMuted,
    kickedOut,
    promoteMember,
    demoteMember,
    requestControl,
    approveControlRequest,
    denyControlRequest,
    kickMember,
    muteMember,
    unmuteMember,
    setSlowMode,
    setChatMuted,
    changeVideoSource,
    switchToLocalFile,
    setP2PSharing,
    setFileMatch,
  } = useWatchSync({
    slug,
    initialHostId: room?.hostId || "",
    currentUser,
    playerRef,
    onSourceChanged: (src) => {
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              videoSource: src.videoSource,
              videoType: src.videoType as RoomRecord["videoType"],
            }
          : prev
      );
      // A source switch invalidates any picked local file on this device.
      setLocalFile((prev) => {
        if (prev) revokeLocalObjectUrl(prev.url);
        return null;
      });
      setLocalMatch(null);
      setFileMatch(null);
      setPlayBlocked(false);
      toast.success("The video source was changed — re-syncing…");
    },
  });

  const isLocalRoom = room?.videoType === "localfile";

  // Load the host fingerprint for "My Files" rooms (tiny JSON).
  const loadHostFile = async () => {
    setFpLoading(true);
    setFpError(null);
    try {
      const res = await fetch(`/api/rooms/${slug}/localfile`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load file info.");
      setHostFp(data.fingerprint ?? null);
    } catch (err) {
      setHostFp(null);
      setFpError(err instanceof Error ? err.message : "Failed to load file info.");
    } finally {
      setFpLoading(false);
    }
  };

  useEffect(() => {
    if (room?.videoType === "localfile") {
      void loadHostFile();
    } else {
      setHostFp(null);
      setFpError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, room?.videoSource, room?.videoType]);

  // Revoke blob: URLs when replaced or on unmount (never leak them).
  const localUrl = localFile?.url;
  useEffect(() => {
    return () => {
      if (localUrl) revokeLocalObjectUrl(localUrl);
    };
  }, [localUrl]);

  const handleFileJoin = (
    file: File,
    objectUrl: string,
    _fp: LocalFingerprint,
    match: boolean
  ) => {
    setLocalFile((prev) => {
      if (prev && prev.url !== objectUrl) revokeLocalObjectUrl(prev.url);
      return { file, url: objectUrl };
    });
    setLocalMatch(match);
    setPlayBlocked(false);
  };

  const handleFileClear = () => {
    setLocalFile((prev) => {
      if (prev) revokeLocalObjectUrl(prev.url);
      return null;
    });
    setLocalMatch(null);
    setPlayBlocked(false);
  };

  const handleMakeRoomFile = async (fp: LocalFingerprint, file: File) => {
    // Privileged: adopt this device's file as the room file, then play it.
    await switchToLocalFile(fp);
    handleFileJoin(file, createLocalObjectUrl(file), fp, true);
    setFileMatch(true);
    await loadHostFile();
  };

  const handleShareToggle = async (on: boolean) => {
    try {
      await setP2PSharing(on);
      toast.success(on ? "Sharing your playback via P2P." : "Stopped P2P sharing.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Share toggle failed.");
      throw err;
    }
  };

  // ---- Party Replay capture wrappers (fire-and-forget, never break chat) ----
  const sendRichCaptured = useCallback(
    async (opts: {
      text?: string;
      replyTo?: { id: string; text: string; userName: string };
      attachment?: {
        kind: "image" | "voice" | "file";
        url: string;
        name?: string;
        size?: number;
        mime?: string;
        duration?: number;
        waveform?: number[];
      };
      moment?: number;
    }): Promise<boolean> => {
      const messageId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ok = await sendRich({ ...opts, id: messageId });
      if (ok !== false) captureSend({ ...opts, messageId });
      return ok;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sendRich, captureSend]
  );

  const reactCaptured = useCallback(
    (id: string, emoji: string) => {
      void reactToMessage(id, emoji);
      captureReaction(id, emoji);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reactToMessage, captureReaction]
  );

  const deleteCaptured = useCallback(
    (id: string) => {
      void deleteMessage(id).then(() => captureDelete(id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteMessage, captureDelete]
  );

  const getHostVideo = () =>
    playerRef.current?.getVideoElement?.() ?? null;

  const handleTapToPlay = async () => {
    try {
      await playerRef.current?.play();
      setPlayBlocked(false);
    } catch {
      // Still blocked (e.g. no file yet) — keep the overlay up.
    }
  };

  // ---- Low-Data Mode + session meter ----
  const {
    dataSaver,
    audioOnly,
    setEnabled: setDataSaver,
    setAudioOnly,
  } = useDataSaver();
  const meter = useDataMeter();
  const [detectedRegion, setDetectedRegion] = useState<string | null>(null);

  // Auto-detect billing region from locale once (manual override wins).
  // Mount-time external read; matches the existing fetch-on-mount effects
  // in this file.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const code =
      typeof navigator !== "undefined"
        ? regionFromLocale(navigator.language)
        : null;
    setDetectedRegion(code);
    if (code) meter.setRegion(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleFragmentBytes = useCallback(
    (bytes: number) => {
      meter.addBytes(bytes, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Estimate watch-time cost for sources we can't measure exactly
  // (YouTube iframe, progressive MP4). HLS reports exact bytes; local
  // files cost zero network bytes. Paused/hidden video accrues nothing.
  const roomVideoType = room?.videoType;
  useEffect(() => {
    if (!roomVideoType) return;
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!p || p.isPaused()) return;
      if (typeof document !== "undefined" && document.hidden) return;
      meter.addWatchSeconds(roomVideoType, 1);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomVideoType]);

  // Hidden tab: followers pause local decoding (saves data + battery).
  // Player-event emissions are suppressed while hidden, so a hidden host
  // can never pause the room by accident.
  useEffect(() => {
    const onVis = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) {
        if (!canControl) {
          try {
            playerRef.current?.pause();
          } catch {
            // player not ready — nothing decoding yet
          }
        }
      } else if (canControl) {
        // Returning host/co-host: jump forward to where the room is so a
        // stale local position never rewinds followers on the next action.
        void (async () => {
          try {
            const res = await fetch(`/api/rooms/${slug}/state`);
            if (!res.ok) return;
            const st = (await res.json()).state;
            const p = playerRef.current;
            if (!st || !p) return;
            const expected =
              st.isPlaying && typeof st.serverTimestamp === "number"
                ? st.currentTime + Math.max(0, (Date.now() - st.serverTimestamp) / 1000)
                : st.currentTime;
            if (Math.abs(expected - p.getCurrentTime()) > 1) p.seek(expected);
          } catch {
            // best-effort; normal sync converges anyway
          }
        })();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [canControl, slug]);

  const handleClaimHost = async () => {
    try {
      setIsClaimingHost(true);
      const res = await fetch(`/api/rooms/${slug}/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newHostId: effectiveId, actorId: effectiveId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("You are now the room host!", { id: "role-change" });
      } else {
        toast.error(data?.error || data?.message || "Host claim rejected.");
      }
    } catch {
      toast.error("Failed to request host role");
    } finally {
      setIsClaimingHost(false);
    }
  };

  const handleRequestControl = async () => {
    try {
      setIsRequestingControl(true);
      await requestControl();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Control request failed.");
    } finally {
      setIsRequestingControl(false);
    }
  };

  // "Pin to moment" markers: chat comments tagged with video seconds.
  const momentMarkers = useMemo(
    () =>
      messages
        .filter((m) => !m.deleted && typeof m.moment === "number")
        .map((m) => ({ id: m.id, seconds: m.moment as number })),
    [messages]
  );

  const handleMarkerTap = useCallback((seconds: number) => {
    try {
      playerRef.current?.seek(seconds);
    } catch {
      // player not ready — ignore
    }
  }, []);

  // Loading state
  if (isAuthPending || isLoadingRoom) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="size-8" />
          <p className="text-sm">Connecting to PeerMates...</p>
        </div>
      </div>
    );
  }

  // Room not found
  if (!room) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center text-foreground">
        <h1 className="text-3xl font-semibold text-foreground">Room Not Found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The PeerMates party for code{" "}
          <code className="font-mono text-foreground font-semibold">/{slug}</code>{" "}
          does not exist or has expired.
        </p>
        <Button className="mt-6 rounded-lg">
          <Link href="/">Return to Lobby</Link>
        </Button>
      </div>
    );
  }

  // GUEST JOIN — nickname only, no signup. Signed-in users skip this.
  // Existing GitHub auth keeps working (AuthButton in headers); guests get
  // a stable local id so presence/roles survive reconnects.
  if (!session?.user && !nickname) {
    return (
      <div className="flex min-h-screen min-h-dvh flex-col bg-background text-foreground">
        <header className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
          <Link
            href="/"
            className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            ← Back to Lobby
          </Link>
          <AuthButton />
        </header>

        {!room ? (
          <main className="flex flex-1 items-center justify-center p-4">
            <p className="text-sm text-muted-foreground">Loading party…</p>
          </main>
        ) : (
          <NicknameGate
            roomTitle={room.title}
            slug={slug}
            onJoin={(name) => saveNickname(name)}
          />
        )}
      </div>
    );
  }

  // KICKED OUT — moderator removed this user
  if (kickedOut) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center text-foreground">
        <h1 className="text-3xl font-semibold text-foreground">Removed from Room</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A moderator removed you from{" "}
          <strong className="text-foreground">&quot;{room.title}&quot;</strong>. You can
          no longer watch, chat, or control playback here.
        </p>
        <Button className="mt-6 min-h-11 rounded-lg">
          <Link href="/">Return to Lobby</Link>
        </Button>
      </div>
    );
  }

  // ACTIVE WATCH PARTY ROOM
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground transition-colors duration-200">
      {/* Top Navigation Bar — responsive: compact on mobile, full on lg+ */}
      <header className="sticky top-0 z-40 flex h-14 sm:h-16 items-center justify-between gap-2 border-b border-border bg-background px-3 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          {/* Mobile menu button (Claude/Codex-style) */}
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-muted lg:hidden"
          >
            <span aria-hidden className="flex flex-col gap-1">
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-3.5 bg-current" />
            </span>
          </button>
          <Link
            href="/"
            aria-label="Back to Lobby"
            title="Back to Lobby"
            className="hidden lg:flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <span aria-hidden>←</span>
          </Link>

          <div className="flex items-center gap-2 min-w-0">
            <h1
              title={room.title}
              className="text-sm sm:text-base font-semibold text-foreground truncate max-w-36 sm:max-w-56 lg:max-w-xs"
            >
              {room.title}
            </h1>
            <Badge
              variant="outline"
              title={`Room code ${slug}`}
              className="border-border bg-muted font-mono text-[10px] sm:text-[11px] text-muted-foreground shrink-0 rounded-lg"
            >
              #{slug}
            </Badge>
          </div>

          <div className="hidden md:block shrink-0">
            <SyncStatusIndicator
              syncState={syncState}
              driftSeconds={driftSeconds}
              isHost={isHost}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:block">
            <InviteSheet slug={slug} title={room.title} />
          </div>
          <div className="hidden lg:block">
            <AuthButton />
          </div>
          {/* Mobile: compact invite stays visible, auth lives in drawer */}
          <div className="sm:hidden">
            <InviteSheet slug={slug} title={room.title} />
          </div>
        </div>
      </header>

      {/* Mobile navigation drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Room navigation">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setNavOpen(false)}
          />
          <nav className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-background">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <span className="text-sm font-semibold truncate">{room.title}</span>
              <button
                type="button"
                onClick={() => setNavOpen(false)}
                aria-label="Close navigation"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-1 p-3">
              <Link
                href="/"
                onClick={() => setNavOpen(false)}
                className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium hover:bg-muted"
              >
                Back to Lobby
              </Link>
              <button
                type="button"
                onClick={() => {
                  setNavOpen(false);
                  setMobileTab("video-info");
                }}
                className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-muted text-left"
              >
                Watching and info ({members.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setNavOpen(false);
                  setMobileTab("chat");
                }}
                className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-muted text-left"
              >
                Live chat ({messages.length})
              </button>
              <div className="mt-2 border-t border-border pt-3 px-3 flex flex-col gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{slug}</span>
                <SyncStatusIndicator
                  syncState={syncState}
                  driftSeconds={driftSeconds}
                  isHost={isHost}
                />
              </div>
            </div>
            <div className="mt-auto border-t border-border p-3">
              <AuthButton />
            </div>
          </nav>
        </div>
      )}

      {/* Main Room Layout: left scrolls, right chat stays fixed on desktop */}
      <main className="room-layout flex flex-1 flex-col lg:flex-row lg:items-start p-3 sm:p-6 gap-4 sm:gap-6 max-w-[1600px] mx-auto w-full">
        {/* Left Column: Video Player & Controls (scrolls with page) */}
        <div className="flex flex-1 flex-col gap-3 sm:gap-4 min-w-0">
          {/* Host Buffering Notice Banner */}
          {isHostBuffering && !isHost && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted p-3 text-xs text-foreground">
              <span className="h-2 w-2 rounded-full bg-foreground/40 animate-pulse" />
              <span>Host is buffering. Playback paused for everyone until host resumes...</span>
            </div>
          )}

          {/* Unified Video Player - 16:9 aspect-video maintained across all screens */}
          <div className="w-full relative">
            <VideoPlayer
              key={`${room.videoSource}|${localFile ? `${localFile.file.name}|${localFile.file.size}` : "nofile"}`}
              ref={playerRef}
              src={room.videoSource}
              videoType={room.videoType}
              isHost={isHost}
              canControl={canControl}
              roleBadge={isHost ? "host" : isCohost ? "cohost" : "viewer"}
              localSrc={localFile?.url}
              dataSaver={dataSaver}
              onFragmentBytes={handleFragmentBytes}
              onAutoplayBlocked={() => setPlayBlocked(true)}
              onPlayerEvent={handleHostPlayerEvent}
              markers={momentMarkers}
              onMarkerTap={canControl ? handleMarkerTap : undefined}
              subtitleTrackUrl={subs.trackUrl}
              subtitleSize={subs.size}
            />
            {/* iOS Safari blocks autoplay with sound: followers get a real
                tap target that plays inside the user gesture. */}
            {playBlocked && !canControl && (room.videoType !== "localfile" || localFile) && (
              <button
                type="button"
                onClick={handleTapToPlay}
                className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/70 cursor-pointer rounded-lg p-6 text-center min-h-44"
              >
                <span className="text-sm font-semibold text-white">
                  Tap to join synced playback
                </span>
                <span className="text-[11px] text-zinc-300 max-w-xs">
                  Your browser blocked autoplay with sound — one tap starts you in sync
                  with everyone.
                </span>
              </button>
            )}
            {/* Audio-only mode: video hidden, audio keeps playing. */}
            {audioOnly && (room.videoType !== "localfile" || localFile) && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-zinc-950/95 rounded-lg p-6 text-center">
                <p className="text-sm font-semibold text-white">Audio-only mode</p>
                <p className="text-[11px] text-zinc-400 max-w-xs">
                  Video hidden to save screen &amp; battery — audio keeps playing in sync.
                </p>
                <button
                  type="button"
                  onClick={() => setAudioOnly(false)}
                  className="mt-1 min-h-11 rounded-lg border border-white/20 bg-white/10 px-4 text-xs font-semibold text-white cursor-pointer"
                >
                  Show video
                </button>
              </div>
            )}
          </div>

          {/* Reconnecting / offline banner */}
          {reconnecting && (
            <div
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-muted p-3 text-xs text-foreground"
              role="status"
            >
              <span className="h-2 w-2 rounded-full bg-foreground/40 animate-pulse" />
              <span>
                {connection === "offline"
                  ? "You are offline — waiting for network, then catching up to the host…"
                  : "Reconnecting… catching up to the host's latest state."}
              </span>
            </div>
          )}

          {/* Mobile Tab Switcher for Narrow Viewports (< lg) */}
          <div className="flex lg:hidden items-center justify-center w-full p-1 bg-muted rounded-lg border border-border mt-1">
            <button
              type="button"
              onClick={() => setMobileTab("video-info")}
              className={`flex-1 min-h-11 flex items-center justify-center rounded-lg text-xs font-medium transition-all cursor-pointer ${
                mobileTab === "video-info"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Watching and Info ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("chat")}
              className={`flex-1 min-h-11 flex items-center justify-center rounded-lg text-xs font-medium transition-all cursor-pointer ${
                mobileTab === "chat"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Live Chat ({messages.length})
            </button>
          </div>

          {/* Video Info & Controls Panel (Visible on Desktop OR when mobileTab === 'video-info') */}
          <div
            className={`flex flex-col gap-3 sm:gap-4 ${
              mobileTab === "video-info" ? "flex" : "hidden lg:flex"
            }`}
          >
            {/* Presence Bar */}
            <Card className="border-border bg-card px-3 sm:px-4 py-2 rounded-lg">
              <PresenceBar
                members={members}
                currentUserId={effectiveId}
                hostId={hostId}
                noAvatars={dataSaver}
              />
            </Card>

            {/* Host Controls & Sync Panel */}
            <Card className="border-border bg-card p-3 sm:p-4 rounded-lg">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-2 flex-wrap">
                    <span>Host-Authoritative Sync</span>
                    {isHost ? (
                      <Badge variant="outline" className="border-border text-[10px] rounded-lg">
                        You are the Host
                      </Badge>
                    ) : isCohost ? (
                      <Badge variant="outline" className="border-border text-[10px] rounded-lg">
                        You are a Co-host
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-border text-[10px] rounded-lg">
                        Follower Mode
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {canControl
                      ? "Your player actions broadcast frame state and a 3-second heartbeat to followers."
                      : "Playback automatically aligns with the host if drift exceeds 0.5 seconds."}
                  </p>
                </div>

                {!canControl &&
                  (myRequestPending ? (
                    <Badge
                      variant="outline"
                      className="border-border text-xs px-3 py-2 rounded-lg"
                    >
                      Request sent — waiting for host
                    </Badge>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRequestControl}
                        disabled={isRequestingControl}
                        className="min-h-11 sm:min-h-9 text-xs cursor-pointer rounded-lg"
                      >
                        {isRequestingControl ? "Sending…" : "Request control"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClaimHost}
                        disabled={isClaimingHost}
                        className="min-h-11 sm:min-h-9 text-xs cursor-pointer rounded-lg"
                      >
                        {isClaimingHost ? "Checking…" : "Claim host if gone"}
                      </Button>
                    </div>
                  ))}
              </div>
            </Card>

            {/* Viewer list (virtualized — fast at 500 members) */}
            <ViewerList
              members={members}
              currentUserId={effectiveId}
              hostId={hostId}
              isPrivileged={canControl}
              isHost={isHost}
              mutedIds={mutedIds}
              controlRequests={controlRequests}
              showFileMatch={isLocalRoom}
              noAvatars={dataSaver}
              onPromote={promoteMember}
              onDemote={demoteMember}
              onKick={kickMember}
              onMute={muteMember}
              onUnmute={unmuteMember}
              onApproveRequest={approveControlRequest}
              onDenyRequest={denyControlRequest}
            />

            {/* My Files gate + P2P fallback (local-file rooms only) */}
            {isLocalRoom && (
              <LocalFileGate
                hostFingerprint={hostFp}
                hostFileLoading={fpLoading}
                hostFileError={fpError}
                onRetryHostFile={loadHostFile}
                isPrivileged={canControl}
                hasActiveFile={!!localFile}
                activeFileName={localFile?.file.name ?? null}
                activeMatch={localMatch}
                onFileJoin={handleFileJoin}
                onFileClear={handleFileClear}
                onMakeRoomFile={handleMakeRoomFile}
                publishMatch={setFileMatch}
              />
            )}
            {isLocalRoom && (isHost || localMatch !== true) && (
              <StreamFromHostPanel
                slug={slug}
                hostId={hostId}
                myId={effectiveId}
                myName={effectiveName || "Viewer"}
                isHost={isHost}
                getHostVideo={getHostVideo}
                onShareToggle={handleShareToggle}
              />
            )}

            {/* Moderation tools (host + co-hosts only) */}
            {canControl && (
              <ModerationPanel
                slowModeSeconds={chatSettings.slowModeSeconds}
                chatMuted={chatSettings.chatMuted}
                memberCount={members.length}
                onSetSlowMode={setSlowMode}
                onSetChatMuted={setChatMuted}
                onChangeSource={changeVideoSource}
                onSwitchToLocalFile={handleMakeRoomFile}
              />
            )}

            {/* Party Replay: end-of-party save (host only, server-enforced) */}
            <EndPartyPanel
              slug={slug}
              actorId={effectiveId}
              isHost={isHost}
              viewerCount={members.length}
              getDuration={() => playerRef.current?.getDuration() ?? 0}
            />

            {/* Subtitles + AI (everyone; upload is privileged server-side) */}
            <SubtitlesPanel
              subs={subs}
              canUpload={canControl}
              getCurrentTime={() => playerRef.current?.getCurrentTime() ?? 0}
            />

            {/* Low-Data Mode + live session meter */}
            <DataPanel
              dataSaver={dataSaver}
              audioOnly={audioOnly}
              onToggleSaver={setDataSaver}
              onToggleAudio={setAudioOnly}
              mbText={meter.mbText}
              measuredText={meter.measuredText}
              estimatedText={meter.estimatedText}
              isEstimateOnly={room.videoType !== "hls"}
              costText={meter.costText}
              priceCountry={meter.price.country}
              region={meter.region}
              detectedRegion={detectedRegion}
              onRegionChange={meter.setRegion}
              onResetMeter={meter.reset}
            />
          </div>
        </div>

        {/* Right Column: Live Chat Panel — fixed on desktop, tabbed on mobile */}
        <div
          className={`room-chat-dock w-full lg:w-[340px] xl:w-[380px] shrink-0 flex min-h-0 flex-col ${
            mobileTab === "chat" ? "flex" : "hidden lg:flex"
          }`}
        >
          <ChatPanel
            messages={messages}
            currentUserId={effectiveId}
            onSendMessage={sendRichCaptured}
            uploadMedia={uploadMedia}
            slowModeSeconds={chatSettings.slowModeSeconds}
            chatMuted={chatSettings.chatMuted}
            userMuted={amMuted}
            isPrivileged={canControl}
            dataSaver={dataSaver}
            typingUsers={typingUsers}
            onTyping={sendTyping}
            canDeleteAny={canControl}
            onReact={reactCaptured}
            onDelete={deleteCaptured}
            canControl={canControl}
            onCaptureMoment={() => playerRef.current?.getCurrentTime() ?? 0}
            onPinJump={(seconds) => {
              try {
                playerRef.current?.seek(seconds);
              } catch {
                // player not ready — ignore
              }
            }}
          />
        </div>
      </main>
    </div>
  );
}
