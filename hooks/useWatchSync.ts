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

function mergeMembers(...lists: PartyMember[][]): PartyMember[] {
  const map = new Map<string, PartyMember>();
  for (const list of lists) {
    for (const m of list) {
      if (!m?.id) continue;
      const existing = map.get(m.id);
      // Prefer the entry with the earliest joinedAt (stable host promotion)
      if (!existing || (m.joinedAt || 0) < (existing.joinedAt || 0)) {
        map.set(m.id, m);
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.joinedAt - b.joinedAt);
}

function mergeMessages(...lists: ChatMessage[][]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const list of lists) {
    for (const m of list) {
      if (!m?.id) continue;
      if (!map.has(m.id)) map.set(m.id, m);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

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
  const presenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const statePollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const messagesPollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSyncingFromEventRef = useRef<boolean>(false);
  // Realtime (Stream/Broadcast) copies merged with server-poll copies
  const realtimeMembersRef = useRef<PartyMember[]>([currentUser]);
  const serverMembersRef = useRef<PartyMember[]>([]);
  const realtimeMessagesRef = useRef<ChatMessage[]>([]);
  const serverMessagesRef = useRef<ChatMessage[]>([]);
  const lastServerStateAtRef = useRef<number>(0);

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

  // Apply a server state snapshot to the local player (shared by the
  // initial fetch and the follower polling loop).
  const applyServerState = useCallback(
    (state: {
      currentTime: number;
      isPlaying: boolean;
      serverTimestamp: number;
    }) => {
      const player = playerRef.current;
      if (!player || isHostRef.current) return;
      if (
        typeof state.currentTime !== "number" ||
        typeof state.serverTimestamp !== "number"
      )
        return;

      const elapsed = (Date.now() - state.serverTimestamp) / 1000;
      const expected = state.isPlaying
        ? state.currentTime + Math.max(0, elapsed)
        : state.currentTime;

      const local = player.getCurrentTime();
      const drift = expected - local;
      const absDrift = Math.abs(drift);
      setDriftSeconds(absDrift);

      const now = Date.now();
      if (absDrift > 0.5 && now - lastSeekTimeRef.current > 1500) {
        setSyncState("syncing");
        lastSeekTimeRef.current = now;
        isSyncingFromEventRef.current = true;
        player.seek(expected);
        setTimeout(() => {
          isSyncingFromEventRef.current = false;
        }, 500);
      } else {
        setSyncState("synced");
      }

      if (state.isPlaying && player.isPaused()) {
        player.play();
      } else if (!state.isPlaying && !player.isPaused()) {
        player.pause();
      }
    },
    [playerRef]
  );

  // 1. Initial Instant State Fetch from Redis (for new joiners).
  // Followers continuously re-poll below, so late host actions still sync.
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

  // 1b. Server-backed presence heartbeat + polling.
  // This is the cross-device source of truth: every client POSTs its
  // heartbeat and GETs the full online list, so two different accounts on
  // different devices/browsers always see each other even when Stream
  // realtime is unavailable.
  useEffect(() => {
    if (!slug || !currentUser.id) return;
    let stopped = false;

    const postHeartbeat = async () => {
      try {
        const res = await fetch(`/api/rooms/${slug}/presence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: currentUserRef.current.id,
            name: currentUserRef.current.name,
            image: currentUserRef.current.image,
            joinedAt: currentUserRef.current.joinedAt,
          }),
        });
        if (!res.ok || stopped) return;
        const data = await res.json();
        if (Array.isArray(data.members)) {
          serverMembersRef.current = data.members;
          setMembers(
            mergeMembers(realtimeMembersRef.current, data.members)
          );
        }
      } catch {
        // polling is best-effort
      }
    };

    const pollPresence = async () => {
      try {
        const res = await fetch(`/api/rooms/${slug}/presence`);
        if (!res.ok || stopped) return;
        const data = await res.json();
        if (Array.isArray(data.members)) {
          serverMembersRef.current = data.members;
          setMembers(
            mergeMembers(realtimeMembersRef.current, data.members)
          );
          checkHostPresence(data.members);
        }
      } catch {
        // ignore transient failures
      }
    };

    const checkHostPresence = (list: PartyMember[]) => {
      const currentHostId = hostIdRef.current;
      const myId = currentUserRef.current.id;
      if (myId === currentHostId) {
        hasSeenHostOnlineRef.current = true;
        return;
      }
      if (!currentHostId) return;
      const hostStillPresent = list.some((m) => m.id === currentHostId);
      if (hostStillPresent) {
        hasSeenHostOnlineRef.current = true;
      } else if (hasSeenHostOnlineRef.current && list.length > 0) {
        promoteNextHost(list);
      }
    };

    const promoteNextHost = (list: PartyMember[]) => {
      const sorted = [...list].sort((a, b) => a.joinedAt - b.joinedAt);
      const nextHost = sorted[0];
      const currentHostId = hostIdRef.current;
      const myId = currentUserRef.current.id;
      if (nextHost && nextHost.id !== currentHostId) {
        setHostId(nextHost.id);
        if (nextHost.id === myId) {
          toast.info("Host disconnected. You are now the room host! 👑");
          serviceRef.current?.sendPlaybackEvent({
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
    };

    postHeartbeat();
    presenceTimerRef.current = setInterval(() => {
      postHeartbeat();
      pollPresence();
    }, 5000);

    const onUnload = () => {
      // best-effort leave beacon
      try {
        const payload = JSON.stringify({
          userId: currentUserRef.current.id,
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(
            `/api/rooms/${slug}/presence`,
            new Blob([payload], { type: "application/json" })
          );
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      stopped = true;
      if (presenceTimerRef.current) clearInterval(presenceTimerRef.current);
      window.removeEventListener("beforeunload", onUnload);
      fetch(`/api/rooms/${slug}/presence`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserRef.current.id }),
      }).catch(() => {});
    };
    // ONLY re-subscribe if room slug or user ID changes
  }, [slug, currentUser.id]);

  // 1c. Server-backed chat polling: merges durable history with realtime.
  useEffect(() => {
    if (!slug) return;
    let stopped = false;
    const pollMessages = async () => {
      try {
        const res = await fetch(`/api/rooms/${slug}/messages`);
        if (!res.ok || stopped) return;
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          serverMessagesRef.current = data.messages;
          setMessages(
            mergeMessages(realtimeMessagesRef.current, data.messages)
          );
        }
      } catch {
        // ignore
      }
    };
    pollMessages();
    messagesPollTimerRef.current = setInterval(pollMessages, 2500);
    return () => {
      stopped = true;
      if (messagesPollTimerRef.current)
        clearInterval(messagesPollTimerRef.current);
    };
  }, [slug]);

  // 1d. Server-backed playback polling for followers.
  // Host writes state on every play/pause/seek + 3s heartbeat; followers
  // correct drift here. Works across devices even if Stream events drop.
  useEffect(() => {
    if (!slug) return;
    let stopped = false;
    const pollState = async () => {
      if (isHostRef.current || stopped) return;
      // Skip briefly after a realtime event already synced us (avoid double-seek)
      if (Date.now() - lastServerStateAtRef.current < 1500) return;
      try {
        const res = await fetch(`/api/rooms/${slug}/state`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.state && !stopped) applyServerState(data.state);
      } catch {
        // ignore
      }
    };
    statePollTimerRef.current = setInterval(pollState, 2000);
    return () => {
      stopped = true;
      if (statePollTimerRef.current) clearInterval(statePollTimerRef.current);
    };
  }, [slug, applyServerState]);

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
          // Only attempt Stream cloud when BOTH apiKey and token are real.
          // A null token means server-side Stream is unconfigured — fall
          // through to server polling (which always works cross-device).
          if (tokenData.apiKey && tokenData.token) {
            await service.connect(tokenData.apiKey, tokenData.token);
          } else {
            await service.connect();
          }
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
      realtimeMessagesRef.current = mergeMessages(realtimeMessagesRef.current, [
        msg,
      ]);
      setMessages(
        mergeMessages(realtimeMessagesRef.current, serverMessagesRef.current)
      );
    });

    // Listen for presence member list updates
    const unsubMembers = service.onMembers((updatedMembers) => {
      if (!isMounted) return;

      realtimeMembersRef.current = updatedMembers;
      const merged = mergeMembers(
        updatedMembers,
        serverMembersRef.current,
        [currentUserRef.current]
      );

      // Prevent re-renders if members haven't changed
      setMembers((prev) => {
        if (
          prev.length === merged.length &&
          prev.every((m, i) => m.id === merged[i]?.id && m.role === merged[i]?.role)
        ) {
          return prev;
        }
        return merged;
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
      const hostStillPresent = merged.some((m) => m.id === currentHostId);

      if (hostStillPresent) {
        hasSeenHostOnlineRef.current = true;
      } else if (hasSeenHostOnlineRef.current && merged.length > 0) {
        // Host was online previously but has now left! Promote longest-tenured member
        const sorted = [...merged].sort((a, b) => a.joinedAt - b.joinedAt);
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

        lastServerStateAtRef.current = Date.now();
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
