"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { UnifiedPlayerRef, PlayerStateEvent } from "@/components/player/types";
import {
  RealtimeChannelService,
  PartyMember,
  ChatMessage,
  RealtimePlaybackEvent,
} from "@/lib/stream/realtimeClient";
import { toast } from "sonner";

interface UseWatchSyncProps {
  slug: string;
  initialHostId: string;
  currentUser: PartyMember;
  playerRef: React.RefObject<UnifiedPlayerRef | null>;
}

export type SyncState = "synced" | "syncing" | "buffering" | "disconnected";

export function useWatchSync({
  slug,
  initialHostId,
  currentUser,
  playerRef,
}: UseWatchSyncProps) {
  const [hostId, setHostId] = useState(initialHostId);
  const [syncState, setSyncState] = useState<SyncState>("syncing");
  const [driftSeconds, setDriftSeconds] = useState(0);
  const [members, setMembers] = useState<PartyMember[]>([currentUser]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isHostBuffering, setIsHostBuffering] = useState(false);

  const isHost = currentUser.id === hostId;

  // Stable references to prevent effect re-triggering loops
  const hostIdRef = useRef(hostId);
  hostIdRef.current = hostId;

  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  const hasSeenHostOnlineRef = useRef(false);
  const serviceRef = useRef<RealtimeChannelService | null>(null);
  const lastSeekTimeRef = useRef<number>(0);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingFromEventRef = useRef<boolean>(false);

  // Sync initialHostId when room metadata finishes loading
  useEffect(() => {
    if (initialHostId && initialHostId !== hostIdRef.current) {
      setHostId(initialHostId);
    }
  }, [initialHostId]);

  // Write state to Redis endpoint
  const saveStateToRedis = useCallback(
    async (currentTime: number, isPlaying: boolean) => {
      try {
        await fetch(`/api/rooms/${slug}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentTime,
            isPlaying,
            playbackRate: 1,
            serverTimestamp: Date.now(),
            hostId: hostIdRef.current,
          }),
        });
      } catch {
        // Silently handle
      }
    },
    [slug]
  );

  // 1. Initial Instant State Fetch from Redis (for new joiners)
  useEffect(() => {
    async function fetchInitialRedisState() {
      try {
        const res = await fetch(`/api/rooms/${slug}/state`);
        if (!res.ok) return;
        const data = await res.json();
        const state = data.state;

        if (state && playerRef.current) {
          const elapsed = (Date.now() - state.serverTimestamp) / 1000;
          const initialTime = state.isPlaying
            ? state.currentTime + elapsed
            : state.currentTime;

          playerRef.current.seek(initialTime);

          if (state.isPlaying) {
            playerRef.current.play();
          } else {
            playerRef.current.pause();
          }
          setSyncState("synced");
        }
      } catch (err) {
        console.warn("Could not load initial Redis state:", err);
      }
    }

    if (!isHostRef.current) {
      fetchInitialRedisState();
    }
  }, [slug, playerRef]);

  // 2. Initialize Realtime Channel once per room & user session
  useEffect(() => {
    if (!slug || !currentUser.id) return;

    const service = new RealtimeChannelService(slug, currentUserRef.current);
    serviceRef.current = service;

    let isMounted = true;

    async function initChannel() {
      try {
        const tokenRes = await fetch("/api/stream/token", { method: "POST" });
        if (!isMounted) return;

        if (tokenRes.ok) {
          const tokenData = await tokenRes.json();
          await service.connect(tokenData.apiKey, tokenData.token);
        } else {
          await service.connect();
        }
      } catch {
        if (isMounted) {
          await service.connect();
        }
      }
    }

    initChannel();

    // Listen for chat messages
    const unsubMsg = service.onMessage((msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    // Listen for presence member list updates
    const unsubMembers = service.onMembers((updatedMembers) => {
      if (!isMounted) return;

      // Prevent re-renders if members haven't changed
      setMembers((prev) => {
        if (
          prev.length === updatedMembers.length &&
          prev.every(
            (m, i) =>
              m.id === updatedMembers[i]?.id &&
              m.role === updatedMembers[i]?.role
          )
        ) {
          return prev;
        }
        return updatedMembers;
      });

      const currentHostId = hostIdRef.current;
      const myId = currentUserRef.current.id;

      // If current user is the host, host is naturally present
      if (myId === currentHostId) {
        hasSeenHostOnlineRef.current = true;
        return;
      }

      if (!currentHostId) return;

      // Check if current host is in the presence member list
      const hostStillPresent = updatedMembers.some((m) => m.id === currentHostId);

      if (hostStillPresent) {
        hasSeenHostOnlineRef.current = true;
      } else if (hasSeenHostOnlineRef.current && updatedMembers.length > 0) {
        // Host was online previously but has now left! Promote longest-tenured member
        const sorted = [...updatedMembers].sort((a, b) => a.joinedAt - b.joinedAt);
        const nextHost = sorted[0];

        if (nextHost && nextHost.id !== currentHostId) {
          setHostId(nextHost.id);

          if (nextHost.id === myId) {
            toast.info("Host disconnected. You are now the room host! 👑");
            service.sendPlaybackEvent({
              type: "room.host_changed",
              newHostId: myId,
            });

            fetch(`/api/rooms/${slug}/host`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ newHostId: myId }),
            }).catch(() => {});
          } else {
            toast.info(`${nextHost.name} is now the room host.`);
          }
        }
      }
    });

    // Listen for real-time playback events (for followers)
    const unsubPlayback = service.onPlaybackEvent(
      (event: RealtimePlaybackEvent) => {
        if (!isMounted) return;

        if (event.type === "room.host_changed" && event.newHostId) {
          setHostId(event.newHostId);
          return;
        }

        // Host drives state; ignore playback events if we are the host
        if (isHostRef.current) return;

        const player = playerRef.current;
        if (!player) return;

        isSyncingFromEventRef.current = true;

        if (event.type === "playback.buffering") {
          setIsHostBuffering(true);
          setSyncState("buffering");
          player.pause();
          setTimeout(() => {
            isSyncingFromEventRef.current = false;
          }, 300);
          return;
        }

        setIsHostBuffering(false);

        if (typeof event.position !== "number" || !event.serverTimestamp) {
          isSyncingFromEventRef.current = false;
          return;
        }

        // SYNC ALGORITHM
        const transitLatencySec = (Date.now() - event.serverTimestamp) / 1000;
        const expectedPosition =
          event.type === "playback.pause"
            ? event.position
            : event.position + transitLatencySec;

        const currentLocalTime = player.getCurrentTime();
        const drift = expectedPosition - currentLocalTime;
        const absDrift = Math.abs(drift);

        setDriftSeconds(absDrift);

        const now = Date.now();
        const hasDebouncePassed = now - lastSeekTimeRef.current > 1000;

        if (absDrift > 0.5 && hasDebouncePassed) {
          setSyncState("syncing");
          lastSeekTimeRef.current = now;
          player.seek(expectedPosition);
        } else {
          setSyncState("synced");
        }

        if (event.type === "playback.play") {
          if (player.isPaused()) {
            player.play();
          }
        } else if (event.type === "playback.pause") {
          if (!player.isPaused()) {
            player.pause();
          }
        } else if (event.type === "playback.heartbeat") {
          if (player.isPaused()) {
            player.play();
          }
        }

        setTimeout(() => {
          isSyncingFromEventRef.current = false;
        }, 500);
      }
    );

    return () => {
      isMounted = false;
      unsubMsg();
      unsubMembers();
      unsubPlayback();
      service.disconnect();
    };
    // ONLY re-subscribe if room slug or user ID changes
  }, [slug, currentUser.id, playerRef]);

  // 3. Host Heartbeat Loop (every 3 seconds while playing)
  useEffect(() => {
    if (!isHost) {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      return;
    }

    heartbeatTimerRef.current = setInterval(() => {
      const player = playerRef.current;
      if (!player) return;

      const isPaused = player.isPaused();
      if (!isPaused) {
        const currentTime = player.getCurrentTime();
        const serverTimestamp = Date.now();

        serviceRef.current?.sendPlaybackEvent({
          type: "playback.heartbeat",
          position: currentTime,
          serverTimestamp,
        });

        saveStateToRedis(currentTime, true);
      }
    }, 3000);

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [isHost, playerRef, saveStateToRedis]);

  // 4. Host player event dispatch
  const handleHostPlayerEvent = useCallback(
    (event: PlayerStateEvent) => {
      if (!isHostRef.current || isSyncingFromEventRef.current) return;

      const serverTimestamp = Date.now();
      const player = playerRef.current;
      const position = event.position;

      if (event.type === "play") {
        serviceRef.current?.sendPlaybackEvent({
          type: "playback.play",
          position,
          serverTimestamp,
        });
        saveStateToRedis(position, true);
      } else if (event.type === "pause") {
        serviceRef.current?.sendPlaybackEvent({
          type: "playback.pause",
          position,
          serverTimestamp,
        });
        saveStateToRedis(position, false);
      } else if (event.type === "seek") {
        serviceRef.current?.sendPlaybackEvent({
          type: "playback.seek",
          position,
          serverTimestamp,
        });
        saveStateToRedis(position, !player?.isPaused());
      } else if (event.type === "buffering") {
        serviceRef.current?.sendPlaybackEvent({
          type: "playback.buffering",
          position,
          serverTimestamp,
        });
      }
    },
    [playerRef, saveStateToRedis]
  );

  const sendMessage = useCallback((text: string) => {
    serviceRef.current?.sendMessage(text);
  }, []);

  return {
    isHost,
    hostId,
    syncState,
    driftSeconds,
    members,
    messages,
    isHostBuffering,
    handleHostPlayerEvent,
    sendMessage,
  };
}
