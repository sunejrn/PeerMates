"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { P2PHostSession, P2PViewerSession, type P2PState } from "@/lib/webrtc/p2p";
import { P2P_MAX_RECEIVERS } from "@/lib/video/localfile";

interface StreamFromHostPanelProps {
  slug: string;
  hostId: string;
  myId: string;
  myName: string;
  /** Only the host can share (joins target room.hostId). */
  isHost: boolean;
  /** Host player video element for captureStream(). */
  getHostVideo: () => HTMLVideoElement | null;
  /** Host-only: advertise sharing server-side (moderation p2pshare). */
  onShareToggle: (on: boolean) => Promise<void>;
}

interface Availability {
  sharing: boolean;
  receivers: number;
  max: number;
}

/**
 * "Stream from host" via WebRTC P2P (small groups only).
 *
 * Honest about scale: the host uploads once per viewer and quality is
 * capped automatically, so this tops out at 8 receivers. Big rooms should
 * use YouTube/links or matching local files (zero media bandwidth); an SFU
 * such as LiveKit's free tier is the later option for host-streaming scale.
 */
export function StreamFromHostPanel({
  slug,
  hostId,
  myId,
  myName,
  isHost,
  getHostVideo,
  onShareToggle,
}: StreamFromHostPanelProps) {
  const [avail, setAvail] = useState<Availability>({
    sharing: false,
    receivers: 0,
    max: P2P_MAX_RECEIVERS,
  });
  // Host sharing state
  const [sharing, setSharing] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [receiverCount, setReceiverCount] = useState(0);
  const hostSessionRef = useRef<P2PHostSession | null>(null);
  // Viewer watch state
  const [p2pState, setP2pState] = useState<P2PState>("idle");
  const [p2pDetail, setP2pDetail] = useState<string | null>(null);
  const viewerSessionRef = useRef<P2PViewerSession | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const refreshAvailability = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${slug}/localfile`);
      if (!res.ok) return;
      const data = await res.json();
      setAvail({
        sharing: Boolean(data.sharing),
        receivers: Number(data.p2p?.receivers ?? 0),
        max: Number(data.p2p?.max ?? P2P_MAX_RECEIVERS),
      });
    } catch {
      // polling is best-effort
    }
  }, [slug]);

  useEffect(() => {
    // Initial load + 10s availability polling (same shape as room fetch).
    const load = () => {
      void refreshAvailability();
    };
    load();
    const t = setInterval(refreshAvailability, 10000);
    return () => clearInterval(t);
  }, [refreshAvailability]);

  // Cleanup sessions on unmount.
  useEffect(() => {
    return () => {
      hostSessionRef.current?.stop();
      void viewerSessionRef.current?.leave();
    };
  }, []);

  const attachRemoteStream = useCallback((stream: MediaStream) => {
    const video = remoteVideoRef.current;
    if (!video) return;
    try {
      (video as HTMLVideoElement).srcObject = stream;
      void video.play().catch(() => {});
    } catch {
      // user can press play manually
    }
  }, []);

  const backToLive = useCallback(() => {
    const video = remoteVideoRef.current;
    const stream = (video?.srcObject as MediaStream | null) ?? null;
    if (video && stream) {
      try {
        video.srcObject = null;
        video.srcObject = stream;
        void video.play().catch(() => {});
      } catch {
        // ignore
      }
    }
  }, []);

  // ---- Host actions ----
  const startSharing = async () => {
    setShareError(null);
    const video = getHostVideo();
    if (!video) {
      setShareError("No video element yet — pick your file and let it load first.");
      return;
    }
    try {
      setShareBusy(true);
      await onShareToggle(true);
      const session = new P2PHostSession(slug, myId, {
        onReceiversChange: (n) => {
          setReceiverCount(n);
          void refreshAvailability();
        },
        onError: (m) => setShareError(m),
      });
      hostSessionRef.current = session;
      await session.start(video);
      setSharing(true);
    } catch (err) {
      setShareError(
        err instanceof Error ? err.message : "Could not start sharing."
      );
      try {
        await onShareToggle(false);
      } catch {
        // ignore
      }
    } finally {
      setShareBusy(false);
    }
  };

  const stopSharing = async () => {
    hostSessionRef.current?.stop();
    hostSessionRef.current = null;
    setSharing(false);
    setReceiverCount(0);
    try {
      await onShareToggle(false);
    } catch {
      // ignore
    }
    void refreshAvailability();
  };

  // ---- Viewer actions ----
  const startWatching = async () => {
    setP2pDetail(null);
    const session = new P2PViewerSession(slug, myId, myName, {
      onState: (s, detail) => {
        setP2pState(s);
        setP2pDetail(detail ?? null);
        if (s === "connected" || s === "failed" || s === "full" || s === "ended") {
          void refreshAvailability();
        }
      },
      onStream: attachRemoteStream,
    });
    viewerSessionRef.current = session;
    try {
      await session.join(hostId);
    } catch {
      // state/detail already set via onState
    }
  };

  const stopWatching = async () => {
    await viewerSessionRef.current?.leave();
    viewerSessionRef.current = null;
    const video = remoteVideoRef.current;
    if (video) {
      try {
        (video.srcObject as MediaStream | null)
          ?.getTracks()
          .forEach((t) => t.stop());
        video.srcObject = null;
      } catch {
        // ignore
      }
    }
    setP2pState("idle");
    setP2pDetail(null);
  };

  const isLive = p2pState === "connected";
  const isBusy =
    p2pState === "requesting" || p2pState === "connecting";
  const isIdle = p2pState === "idle" || p2pState === "ended";
  const isFailed = p2pState === "failed" || p2pState === "full";
  const full = avail.receivers >= avail.max;

  return (
    <Card className="border-border bg-card/60 p-3 sm:p-4 rounded-xl backdrop-blur-sm shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          📡 Stream from host (P2P)
        </h3>
        <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
          {avail.receivers}/{avail.max} watching
        </Badge>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        No matching file? The host can stream their playback directly to{" "}
        <strong className="text-foreground">up to {avail.max} viewers</strong>{" "}
        with automatic quality caps. For big rooms use YouTube, links, or
        matching local files instead — P2P can&apos;t serve hundreds (an SFU
        like LiveKit&apos;s free tier is the future option).
      </p>

      {isHost ? (
        <div className="space-y-2">
          {!sharing ? (
            <Button
              onClick={startSharing}
              disabled={shareBusy}
              className="w-full min-h-11 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-60"
            >
              {shareBusy ? "Starting…" : "📡 Share my playback (P2P)"}
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-xs" role="status">
                <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                <span className="text-cyan-700 dark:text-cyan-300">
                  Sharing to {receiverCount} viewer{receiverCount === 1 ? "" : "s"} — keep this
                  tab open and playing.
                </span>
              </div>
              <Button
                onClick={stopSharing}
                variant="outline"
                className="w-full min-h-11 text-xs"
              >
                Stop sharing
              </Button>
            </div>
          )}
          {shareError && (
            <p className="text-[11px] text-red-600 dark:text-red-400" role="alert">
              ❌ {shareError}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {isIdle && (
            <>
              <Button
                onClick={startWatching}
                disabled={!avail.sharing || full}
                className="w-full min-h-11 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold disabled:opacity-50"
              >
                📡 Watch host stream
              </Button>
              {!avail.sharing && (
                <p className="text-[11px] text-muted-foreground">
                  The host isn&apos;t sharing right now — pick the matching local file above.
                </p>
              )}
              {avail.sharing && full && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300" role="alert">
                  ⚠️ The host stream is full ({avail.receivers}/{avail.max}). Use a matching
                  local file — link sources also work for big rooms.
                </p>
              )}
            </>
          )}

          {isBusy && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <Spinner className="shrink-0 text-cyan-500" />
                {p2pState === "requesting" ? "Asking the host…" : "Connecting… (up to ~25s on tricky networks)"}
              </div>
              <Button onClick={stopWatching} variant="outline" className="w-full min-h-11 text-xs">
                Cancel
              </Button>
            </div>
          )}

          {isFailed && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs space-y-2" role="alert">
              <p className="text-red-600 dark:text-red-400">
                ❌ {p2pDetail || "Connection failed."}
              </p>
              <Button onClick={startWatching} variant="outline" className="w-full min-h-11 text-xs">
                Try again
              </Button>
            </div>
          )}

          {isLive && (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-xl border border-border/70 bg-black">
                <video
                  ref={remoteVideoRef}
                  playsInline
                  controls
                  className="w-full aspect-video object-contain"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Live from host (~1–2s behind). Pausing only pauses your view.
              </p>
              <div className="flex gap-1.5">
                <Button onClick={backToLive} variant="outline" className="flex-1 min-h-11 text-xs">
                  ↺ Back to live
                </Button>
                <Button onClick={stopWatching} variant="outline" className="flex-1 min-h-11 text-xs">
                  Stop watching
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
