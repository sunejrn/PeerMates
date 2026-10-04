"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { UnifiedPlayerRef, PlayerStateEvent } from "@/components/player/types";
import {
  RealtimeChannelService,
  PartyMember,
  ChatMessage,
  RealtimePlaybackEvent,
  ChatSendError,
  RoomRole,
  mergeChatPair,
  type MessageAttachment,
  type MessageReplyRef,
} from "@/lib/stream/realtimeClient";
import { toast } from "sonner";
import type { LocalFingerprint } from "@/lib/video/localfile";

interface UseWatchSyncProps {
  slug: string;
  initialHostId: string;
  currentUser: PartyMember;
  playerRef: React.RefObject<UnifiedPlayerRef | null>;
  onSourceChanged?: (room: { videoSource: string; videoType: string }) => void;
}

export interface RoomChatSettings {
  slowModeSeconds: number;
  chatMuted: boolean;
}

export interface ControlRequestItem {
  userId: string;
  name: string;
  image?: string;
  requestedAt: number;
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
      const existing = map.get(m.id);
      // Same id from two transports (echo vs poll): union reactions,
      // tombstones win, content prefers the server copy.
      map.set(m.id, existing ? mergeChatPair(existing, m) : m);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/** Stamp the authoritative server reactions map onto a message list. */
function applyReactions(
  list: ChatMessage[],
  reactions: Record<string, Record<string, string[]>>
): ChatMessage[] {
  let changed = false;
  const out = list.map((m) => {
    const r = reactions[m.id] ?? {};
    const cur = m.reactions ?? {};
    const same =
      Object.keys(r).length === Object.keys(cur).length &&
      Object.entries(r).every(([e, users]) => {
        const c = cur[e] ?? [];
        return (
          c.length === users.length && users.every((u) => c.includes(u))
        );
      });
    if (same) return m;
    changed = true;
    return mergeChatPair(m, { ...m, reactions: r });
  });
  return changed ? out : list;
}

export function useWatchSync({
  slug,
  initialHostId,
  currentUser,
  playerRef,
  onSourceChanged,
}: UseWatchSyncProps) {
  const [hostId, setHostId] = useState(initialHostId);
  const [syncState, setSyncState] = useState<SyncState>("syncing");
  const [driftSeconds, setDriftSeconds] = useState(0);
  const [members, setMembers] = useState<PartyMember[]>([currentUser]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isHostBuffering, setIsHostBuffering] = useState(false);
  // ---- Roles & moderation state (server-authoritative) ----
  const [myRole, setMyRole] = useState<RoomRole>("viewer");
  const [roleMap, setRoleMap] = useState<Record<string, RoomRole>>({});
  const [chatSettings, setChatSettings] = useState<RoomChatSettings>({
    slowModeSeconds: 0,
    chatMuted: false,
  });
  const [controlRequests, setControlRequests] = useState<ControlRequestItem[]>([]);
  const [mutedIds, setMutedIds] = useState<string[]>([]);
  const [myRequestPending, setMyRequestPending] = useState(false);
  const [amMuted, setAmMuted] = useState(false);
  const [kickedOut, setKickedOut] = useState(false);
  // ---- Ephemeral typing indicators (4s expiry per user, max 3 shown) ----
  const [typingUsers, setTypingUsers] = useState<{ id: string; name: string }[]>([]);
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // sendTyping lives below the channel effect (reads serviceRef).
  // ---- "My Files" local-file match badges (server-authoritative) ----
  const [fileMatchMap, setFileMatchMap] = useState<Record<string, boolean | null>>({});
  // ---- Connectivity: "online" | "reconnecting" | "offline" ----
  const [connection, setConnection] = useState<"online" | "reconnecting" | "offline">("online");

  const isHost = currentUser.id === hostId;
  const isCohost = myRole === "cohost";
  /** Hosts and co-hosts are privileged: only they emit control events. */
  const canControl = isHost || isCohost;

  // Stable references to prevent effect re-triggering loops.
  // Synced in an effect (never during render) per the Rules of Hooks.
  const hostIdRef = useRef(hostId);
  const isHostRef = useRef(isHost);
  const canControlRef = useRef(canControl);
  const roleMapRef = useRef<Record<string, RoomRole>>({});
  const onSourceChangedRef = useRef(onSourceChanged);
  const currentUserRef = useRef(currentUser);
  const connectionRef = useRef(connection);
  /** Consecutive failed state polls (2+ => reconnecting). */
  const failCountRef = useRef(0);
  /** Rate-nudge monitor timer + anchor for convergence checks. */
  const nudgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nudgeActiveRef = useRef(false);
  const lastExpectedRef = useRef<{ position: number; at: number } | null>(null);
  /** My own local-file match (null = no file picked). Sent on heartbeat. */
  const fileMatchRef = useRef<boolean | null>(null);

  useEffect(() => {
    hostIdRef.current = hostId;
    isHostRef.current = isHost;
    canControlRef.current = canControl;
    roleMapRef.current = roleMap;
    onSourceChangedRef.current = onSourceChanged;
    currentUserRef.current = currentUser;
    connectionRef.current = connection;
  });

  const hasSeenHostOnlineRef = useRef(false);
  /** Role toasts stay silent until the first roles fetch lands, so a refresh
      never announces a role you already had (and StrictMode double-invoking
      the updater can't double-fire on mount). */
  const rolesSyncedRef = useRef(false);
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

  // ---- Gentle drift correction (no seek thrashing) ----
  // Small drift (<=3s while playing): nudge playbackRate ±8% and let the
  // position glide into sync. Large drift: ONE debounced seek. Below 0.5s:
  // in sync, restore 1x speed.
  const stopRateNudge = useCallback(() => {
    if (nudgeTimerRef.current) {
      clearInterval(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }
    if (nudgeActiveRef.current) {
      nudgeActiveRef.current = false;
      try {
        playerRef.current?.setPlaybackRate?.(1);
      } catch {
        // seeking covers players without rate control
      }
    }
  }, [playerRef]);

  // Clear the nudge monitor on unmount so no timer outlives the room.
  useEffect(() => {
    return () => {
      if (nudgeTimerRef.current) clearInterval(nudgeTimerRef.current);
      nudgeActiveRef.current = false;
    };
  }, []);

  const startRateNudge = useCallback(
    (drift: number, expected: number) => {
      const player = playerRef.current;
      if (!player?.setPlaybackRate) {
        // No rate control (older embeds): fall back to one debounced seek.
        const now = Date.now();
        if (now - lastSeekTimeRef.current > 1500) {
          setSyncState("syncing");
          lastSeekTimeRef.current = now;
          isSyncingFromEventRef.current = true;
          player?.seek(expected);
          setTimeout(() => {
            isSyncingFromEventRef.current = false;
          }, 500);
        }
        return;
      }
      const rate = drift > 0 ? 1.08 : 0.92; // behind => speed up, ahead => slow down
      try {
        player.setPlaybackRate(rate);
      } catch {
        // fall through to monitor, which seeks if we never converge
      }
      nudgeActiveRef.current = true;
      lastExpectedRef.current = { position: expected, at: Date.now() };
      setSyncState("syncing");
      if (nudgeTimerRef.current) clearInterval(nudgeTimerRef.current);
      const startedAt = Date.now();
      nudgeTimerRef.current = setInterval(() => {
        const p = playerRef.current;
        const anchor = lastExpectedRef.current;
        if (!p || !anchor || canControlRef.current) {
          stopRateNudge();
          return;
        }
        const exp = anchor.position + (Date.now() - anchor.at) / 1000;
        const d = exp - p.getCurrentTime();
        setDriftSeconds(Math.abs(d));
        if (Math.abs(d) < 0.4 || Date.now() - startedAt > 20000) {
          stopRateNudge();
          if (Math.abs(d) >= 0.4) {
            // Never converged — one clean seek, no thrash loop.
            p.seek(exp);
            lastSeekTimeRef.current = Date.now();
          }
          setSyncState("synced");
        }
      }, 1000);
    },
    [playerRef, stopRateNudge]
  );

  /**
   * Shared position correction for poll + realtime paths. Position only —
   * callers keep their own play/pause handling.
   */
  const correctDrift = useCallback(
    (expected: number, wantsPlaying: boolean) => {
      const player = playerRef.current;
      if (!player || canControlRef.current) return;
      const drift = expected - player.getCurrentTime();
      const absDrift = Math.abs(drift);
      setDriftSeconds(absDrift);
      if (absDrift <= 0.5) {
        stopRateNudge();
        setSyncState("synced");
        return;
      }
      if (absDrift <= 3.0 && wantsPlaying && !player.isPaused()) {
        // A nudge is already gliding us there — just refresh its anchor so
        // fresh polls don't restart it (avoids timer churn).
        if (nudgeActiveRef.current) {
          lastExpectedRef.current = { position: expected, at: Date.now() };
          setSyncState("syncing");
          return;
        }
        startRateNudge(drift, expected);
        return;
      }
      const now = Date.now();
      if (now - lastSeekTimeRef.current > 1500) {
        stopRateNudge();
        setSyncState("syncing");
        lastSeekTimeRef.current = now;
        isSyncingFromEventRef.current = true;
        player.seek(expected);
        setTimeout(() => {
          isSyncingFromEventRef.current = false;
        }, 500);
      }
    },
    [playerRef, startRateNudge, stopRateNudge]
  );

  // Apply a server state snapshot to the local player (shared by the
  // initial fetch and the follower polling loop). Privileged users
  // (host + co-hosts) drive state and never follow.
  const applyServerState = useCallback(
    (state: {
      currentTime: number;
      isPlaying: boolean;
      serverTimestamp: number;
    }) => {
      const player = playerRef.current;
      if (!player || canControlRef.current) return;
      if (
        typeof state.currentTime !== "number" ||
        typeof state.serverTimestamp !== "number"
      )
        return;

      const elapsed = (Date.now() - state.serverTimestamp) / 1000;
      const expected = state.isPlaying
        ? state.currentTime + Math.max(0, elapsed)
        : state.currentTime;

      correctDrift(expected, state.isPlaying);

      if (state.isPlaying && player.isPaused()) {
        player.play();
      } else if (!state.isPlaying && !player.isPaused()) {
        player.pause();
      }
    },
    [playerRef, correctDrift]
  );

  /**
   * Reconnect resync: fetch the host's latest Redis snapshot and converge
   * with zero seek thrashing (nudge small drift, one seek for large).
   * Returns true when the server answered.
   */
  const resyncFromServer = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/rooms/${slug}/state`);
      if (!res.ok) return false;
      const data = await res.json();
      if (data.state && !canControlRef.current) {
        applyServerState(data.state);
      }
      return true;
    } catch {
      return false;
    }
  }, [slug, applyServerState]);

  // Browser online/offline signals: instant banner, resync on return.
  useEffect(() => {
    if (!slug) return;
    const goOffline = () => {
      failCountRef.current = 0;
      setConnection("offline");
      setSyncState("disconnected");
    };
    const goOnline = () => {
      setConnection("reconnecting");
      void resyncFromServer().then((ok) => {
        if (ok) {
          failCountRef.current = 0;
          setConnection("online");
        }
      });
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, [slug, resyncFromServer]);

  // 1. Initial Instant State Fetch from Redis (for new joiners).
  // Followers continuously re-poll below, so late host actions still sync.
  // Co-hosts also fetch once to land on the live position; emissions are
  // suppressed while catching up so we never echo our own seek.
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

          isSyncingFromEventRef.current = true;
          playerRef.current.seek(initialTime);

          if (state.isPlaying) {
            playerRef.current.play();
          } else {
            playerRef.current.pause();
          }
          setSyncState("synced");
          setTimeout(() => {
            isSyncingFromEventRef.current = false;
          }, 800);
        }
      } catch (err) {
        console.warn("Could not load initial Redis state:", err);
      }
    }

    if (!isHostRef.current) {
      fetchInitialRedisState();
    }
  }, [slug, playerRef]);

  // ---- "My Files" match badges ----
  // Server presence copies carry fileMatch; overlay them onto merged members
  // (Stream-watcher copies predate them and would otherwise win the merge).
  const syncFileMatchMap = useCallback((list: PartyMember[]) => {
    setFileMatchMap((prev) => {
      const next: Record<string, boolean | null> = {};
      for (const m of list) {
        if (!m?.id) continue;
        next[m.id] = m.fileMatch === true ? true : m.fileMatch === false ? false : null;
      }
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((k) => prev[k] === next[k])
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  /**
   * Publish my local-file match status. Propagates on the next presence
   * heartbeat (<=5s) so the host sees my Match/Different badge. Pass null
   * when the file is cleared.
   */
  const setFileMatch = useCallback((match: boolean | null) => {
    fileMatchRef.current = match;
  }, []);

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
            fileMatch: fileMatchRef.current,
          }),
        });
        if (!res.ok || stopped) {
          if (res.status === 403) {
            const data = await res.json().catch(() => ({}));
            if (data?.error === "KICKED") {
              setKickedOut(true);
              toast.error("You were removed from this room by a moderator.");
            }
          }
          return;
        }
        const data = await res.json();
        if (Array.isArray(data.members)) {
          serverMembersRef.current = data.members;
          setMembers(
            mergeMembers(realtimeMembersRef.current, data.members)
          );
          syncFileMatchMap(data.members);
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
          syncFileMatchMap(data.members);
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
      // Succession: a co-host first, else the longest-tenured viewer.
      const roleOf = (id: string): RoomRole =>
        roleMapRef.current[id] ??
        (list.find((m) => m.id === id)?.role as RoomRole | undefined) ??
        "viewer";
      const nextHost =
        sorted.find((m) => roleOf(m.id) === "cohost") ?? sorted[0];
      const currentHostId = hostIdRef.current;
      const myId = currentUserRef.current.id;
      if (nextHost && nextHost.id !== currentHostId) {
        setHostId(nextHost.id);
        if (nextHost.id === myId) {
          toast.info("Host disconnected. You are now the room host! 👑", {
            id: "role-change",
          });
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
    // (syncFileMatchMap is useCallback-bound to nothing, so it never re-fires).
  }, [slug, currentUser.id, syncFileMatchMap]);

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
          const withReactions =
            data.reactions && typeof data.reactions === "object"
              ? applyReactions(data.messages, data.reactions)
              : data.messages;
          serverMessagesRef.current = withReactions;
          setMessages(
            mergeMessages(realtimeMessagesRef.current, withReactions)
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

  // 1e. Server-authoritative roles / settings / control-request polling.
  // This is what makes promotions, slow-mode, and mute-all appear on every
  // device within seconds, even if Stream realtime events are dropped.
  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/rooms/${slug}/roles?viewerId=${encodeURIComponent(currentUserRef.current.id)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.roles && typeof data.roles === "object") {
        setRoleMap(data.roles);
      }
      if (data.myRole === "host" || data.myRole === "cohost" || data.myRole === "viewer") {
        // First successful sync just records the role — only real *changes*
        // after that deserve a toast. Stable toast id so a repeat replaces
        // instead of stacking a second sonner.
        const announce = rolesSyncedRef.current;
        rolesSyncedRef.current = true;
        setMyRole((prev) => {
          if (announce && prev !== data.myRole && data.myRole !== "viewer") {
            toast.success(
              data.myRole === "host"
                ? "You are now the room host! 👑"
                : "You were promoted to co-host! 🎬",
              { id: "role-change" }
            );
          } else if (announce && prev === "cohost" && data.myRole === "viewer") {
            toast.info("Your co-host role was removed.", { id: "role-change" });
          }
          return data.myRole;
        });
      }
      if (data.settings) {
        setChatSettings({
          slowModeSeconds: Number(data.settings.slowModeSeconds) || 0,
          chatMuted: Boolean(data.settings.chatMuted),
        });
      }
      if (Array.isArray(data.requests)) {
        setControlRequests(data.requests);
      }
      if (Array.isArray(data.mutedIds)) {
        setMutedIds(data.mutedIds.map(String));
      }
      setMyRequestPending(Boolean(data.myRequestPending));
      setAmMuted(Boolean(data.amMuted));
      if (data.hostId && data.hostId !== hostIdRef.current) {
        setHostId(data.hostId);
      }
    } catch {
      // polling is best-effort
    }
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    let stopped = false;
    fetchRoles();
    const timer = setInterval(() => {
      if (!stopped) fetchRoles();
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [slug, fetchRoles]);

  // 1d. Server-backed playback polling for followers.
  // Host writes state on every play/pause/seek + 3s heartbeat; followers
  // correct drift here. Works across devices even if Stream events drop.
  // Consecutive failures (2+) flip the connection to "reconnecting" so the
  // room shows a banner; the next success resyncs and clears it.
  useEffect(() => {
    if (!slug) return;
    let stopped = false;
    const pollState = async () => {
      if (canControlRef.current || stopped) return;
      // Skip briefly after a realtime event already synced us (avoid double-seek)
      if (Date.now() - lastServerStateAtRef.current < 1500) return;
      try {
        const res = await fetch(`/api/rooms/${slug}/state`);
        if (!res.ok || stopped) {
          if (!res.ok) {
            failCountRef.current += 1;
            if (
              failCountRef.current >= 2 &&
              connectionRef.current === "online"
            ) {
              setConnection("reconnecting");
              setSyncState("disconnected");
            }
          }
          return;
        }
        const data = await res.json();
        if (data.state && !stopped) {
          applyServerState(data.state);
          failCountRef.current = 0;
          if (connectionRef.current !== "online") {
            setConnection("online");
          }
        }
      } catch {
        failCountRef.current += 1;
        if (
          failCountRef.current >= 2 &&
          connectionRef.current === "online"
        ) {
          setConnection("reconnecting");
          setSyncState("disconnected");
        }
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

    // Ephemeral typing indicators (4s expiry per user, max 3 shown).
    const unsubTyping = service.onTyping((user) => {
      if (!isMounted) return;
      if (user.id === currentUserRef.current.id) return;
      setTypingUsers((prev) => {
        const without = prev.filter((u) => u.id !== user.id);
        return [...without, user].slice(-3);
      });
      const timers = typingTimers.current;
      const old = timers.get(user.id);
      if (old) clearTimeout(old);
      timers.set(
        user.id,
        setTimeout(() => {
          timers.delete(user.id);
          setTypingUsers((prev) => prev.filter((u) => u.id !== user.id));
        }, 4000)
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
        // Host was online previously but has now left! Promote a co-host
        // first, else the longest-tenured member.
        const sorted = [...merged].sort((a, b) => a.joinedAt - b.joinedAt);
        const roleOf = (id: string): RoomRole =>
          roleMapRef.current[id] ??
          (merged.find((m) => m.id === id)?.role as RoomRole | undefined) ??
          "viewer";
        const nextHost =
          sorted.find((m) => roleOf(m.id) === "cohost") ?? sorted[0];

        if (nextHost && nextHost.id !== currentHostId) {
          setHostId(nextHost.id);

          if (nextHost.id === myId) {
            toast.info("Host disconnected. You are now the room host! 👑", {
              id: "role-change",
            });
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

    // Listen for real-time playback + room events (for followers)
    const unsubPlayback = service.onPlaybackEvent(
      (event: RealtimePlaybackEvent) => {
        if (!isMounted) return;

        if (event.type === "room.host_changed" && event.newHostId) {
          setHostId(event.newHostId);
          fetchRoles();
          return;
        }

        if (event.type === "room.roles_changed") {
          fetchRoles();
          return;
        }

        if (event.type === "room.settings_changed") {
          fetchRoles();
          return;
        }

        if (event.type === "room.source_changed") {
          // Ask the page to refetch room metadata and remount the player.
          fetch(`/api/rooms/${slug}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data?.room) {
                onSourceChangedRef.current?.({
                  videoSource: data.room.videoSource,
                  videoType: data.room.videoType,
                });
              }
            })
            .catch(() => {});
          return;
        }

        if (event.type === "room.control_requested") {
          // Refresh the queue immediately; only privileged users see it.
          fetchRoles();
          return;
        }

        if (event.type === "room.kicked" && event.userId) {
          if (event.userId === currentUserRef.current.id) {
            setKickedOut(true);
            toast.error("You were removed from this room by a moderator.");
          } else {
            fetchRoles();
          }
          return;
        }

        // Privileged users drive state; ignore playback events for them
        if (canControlRef.current) return;

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

        // SYNC ALGORITHM (shared, thrash-free: nudge small drift, one seek
        // for large drift — see correctDrift).
        const transitLatencySec = (Date.now() - event.serverTimestamp) / 1000;
        const expectedPosition =
          event.type === "playback.pause"
            ? event.position
            : event.position + transitLatencySec;

        correctDrift(
          expectedPosition,
          event.type === "playback.play" ||
            event.type === "playback.heartbeat" ||
            event.type === "playback.seek"
        );

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
      unsubTyping();
      unsubMembers();
      unsubPlayback();
      service.disconnect();
    };
    // ONLY re-subscribe if room slug or user ID changes (fetchRoles and
    // correctDrift are useCallback-stable, so they never trigger re-subs).
  }, [slug, currentUser.id, playerRef, fetchRoles, correctDrift]);

  // ---- Chat transport actions (read serviceRef: defined after the effect
  // that assigns it, same as handleHostPlayerEvent/sendMessage). ----
  const sendTyping = useCallback(() => {
    void serviceRef.current?.sendTyping();
  }, []);

  /**
   * Rich send: text and/or attachment, optional reply quote + moment pin.
   * Same single-id fan-out as sendMessage, so no duplicates. An explicit
   * id may be supplied (replay capture correlates the chat bubble with the
   * replay event); otherwise one is minted inside sendMessage.
   */
  const sendRich = useCallback(
    async (opts: {
      text?: string;
      replyTo?: MessageReplyRef;
      attachment?: MessageAttachment;
      moment?: number;
      id?: string;
    }): Promise<boolean> => {
      const service = serviceRef.current;
      if (!service) return false;
      try {
        await service.sendMessage(opts.text ?? "", {
          id: opts.id,
          replyTo: opts.replyTo,
          attachment: opts.attachment,
          moment: opts.moment,
        });
        return true;
      } catch (err) {
        if (err instanceof ChatSendError) {
          if (err.code === "SLOW_MODE") {
            toast.warning(err.message || "Slow mode is on. Wait a moment.");
          } else if (err.code === "KICKED") {
            setKickedOut(true);
            toast.error("You were removed from this room.");
          } else if (err.code === "SPAM") {
            toast.warning(err.message || "Message blocked.");
          } else {
            toast.error(err.message || "Message was not delivered.");
          }
        } else {
          toast.error("Message was not delivered. Check your connection.");
        }
        return false;
      }
    },
    []
  );

  /** Upload chat media to the Stream CDN (throws OFFLINE_MEDIA inline). */
  const uploadMedia = useCallback(
    async (
      file: Blob,
      name: string,
      kind: "image" | "file"
    ): Promise<{ url: string }> => {
      const service = serviceRef.current;
      if (!service) throw new Error("Chat is not connected yet.");
      return service.uploadChatFile(file, name, kind);
    },
    []
  );

  /** Delete own message (or any, if privileged). Tombstones everywhere. */
  const deleteMessage = useCallback(
    async (id: string): Promise<void> => {
      try {
        const res = await fetch(`/api/rooms/${slug}/messages/${id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.message || data?.error || "Delete failed.");
        }
        const tombstone = (list: ChatMessage[]) =>
          list.map((m) =>
            m.id === id
              ? { ...m, text: "", attachment: undefined, moment: undefined, deleted: true as const }
              : m
          );
        realtimeMessagesRef.current = tombstone(realtimeMessagesRef.current);
        serverMessagesRef.current = tombstone(serverMessagesRef.current);
        setMessages((prev) => tombstone(prev));
        // Best-effort: remove the realtime copy too (poll covers the rest).
        await serviceRef.current?.deleteStreamMessage(id);
        toast.success("Message deleted.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed.");
      }
    },
    [slug]
  );

  // 3. Privileged heartbeat loop (host + co-hosts, every 3s while playing).
  // Viewers never send control events — enforced again server-side.
  useEffect(() => {
    if (!canControl) {
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
  }, [canControl, playerRef, saveStateToRedis]);

  // 4. Privileged player event dispatch (host + co-hosts only)
  const handleHostPlayerEvent = useCallback(
    (event: PlayerStateEvent) => {
      if (!canControlRef.current || isSyncingFromEventRef.current) return;
      // Never emit while the tab is hidden: Data Saver pauses local decoding
      // there, and a hidden host must not pause the whole room by accident.
      if (typeof document !== "undefined" && document.hidden) return;

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

  const sendMessage = useCallback(async (text: string): Promise<boolean> => {
    const service = serviceRef.current;
    if (!service) return false;
    try {
      await service.sendMessage(text);
      return true;
    } catch (err) {
      if (err instanceof ChatSendError) {
        if (err.code === "SLOW_MODE") {
          toast.warning(err.message || "Slow mode is on. Wait a moment.");
        } else if (err.code === "KICKED") {
          setKickedOut(true);
          toast.error("You were removed from this room.");
        } else {
          toast.error(err.message || "Message was not delivered.");
        }
      } else {
        toast.error("Message was not delivered. Check your connection.");
      }
      return false;
    }
  }, []);

  // ---- Chat actions live below the channel effect (they read
  // serviceRef, which the effect assigns — same pattern as
  // handleHostPlayerEvent/sendMessage). ----

  /** Toggle an emoji reaction (optimistic, server converges). */
  const reactToMessage = useCallback(
    async (id: string, emoji: string): Promise<void> => {
      const me = currentUserRef.current.id;
      // Optimistic flip so taps feel instant.
      const flip = (list: ChatMessage[]) =>
        list.map((m) => {
          if (m.id !== id || m.deleted) return m;
          const users = new Set(m.reactions?.[emoji] ?? []);
          if (users.has(me)) users.delete(me);
          else users.add(me);
          const reactions = { ...(m.reactions ?? {}) };
          if (users.size === 0) delete reactions[emoji];
          else reactions[emoji] = Array.from(users);
          return { ...m, reactions };
        });
      realtimeMessagesRef.current = flip(realtimeMessagesRef.current);
      serverMessagesRef.current = flip(serverMessagesRef.current);
      setMessages((prev) => flip(prev));
      try {
        const res = await fetch(`/api/rooms/${slug}/messages/react`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, emoji }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.message || data?.error || "Reaction failed.");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Reaction failed.");
      }
    },
    [slug]
  );

  // ---- Privileged + request actions (all re-validated server-side) ----

  async function postRolesAction(payload: Record<string, unknown>) {
    const res = await fetch(`/api/rooms/${slug}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Role change failed.");
    await fetchRoles();
  }

  const promoteMember = useCallback(
    async (targetUserId: string) => {
      await postRolesAction({ action: "promote", targetUserId });
      toast.success("Viewer promoted to co-host 🎬");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  const demoteMember = useCallback(
    async (targetUserId: string) => {
      await postRolesAction({ action: "demote", targetUserId });
      toast.success("Co-host demoted to viewer.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  async function postControlAction(payload: Record<string, unknown>) {
    const res = await fetch(`/api/rooms/${slug}/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        name: currentUserRef.current.name,
        image: currentUserRef.current.image,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(data?.message || data?.error || "Request failed.");
    await fetchRoles();
    return data;
  }

  const requestControl = useCallback(async () => {
    await postControlAction({ action: "request" });
    setMyRequestPending(true);
    toast.success("Control requested — the host was notified. ✋");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const approveControlRequest = useCallback(
    async (targetUserId: string) => {
      await postControlAction({ action: "approve", targetUserId });
      toast.success("Control request approved 🎬");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  const denyControlRequest = useCallback(
    async (targetUserId: string) => {
      await postControlAction({ action: "deny", targetUserId });
      toast.success("Control request dismissed.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  async function postModerationAction(payload: Record<string, unknown>) {
    const res = await fetch(`/api/rooms/${slug}/moderation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(data?.message || data?.error || "Moderation failed.");
    await fetchRoles();
    return data;
  }

  const kickMember = useCallback(
    async (targetUserId: string) => {
      await postModerationAction({ action: "kick", targetUserId });
      toast.success("Viewer removed from the room.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  const muteMember = useCallback(
    async (targetUserId: string) => {
      await postModerationAction({ action: "mute", targetUserId });
      toast.success("Viewer muted.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  const unmuteMember = useCallback(
    async (targetUserId: string) => {
      await postModerationAction({ action: "unmute", targetUserId });
      toast.success("Viewer unmuted.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  const setSlowMode = useCallback(
    async (seconds: number) => {
      const data = await postModerationAction({ action: "slowmode", seconds });
      toast.success(
        seconds === 0 ? "Slow mode off." : `Slow mode: ${seconds}s between messages.`
      );
      return data;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  const setChatMuted = useCallback(
    async (muted: boolean) => {
      await postModerationAction({ action: "muteall", muted });
      toast.success(muted ? "Viewers muted — chat is read-only." : "Chat unmuted for everyone.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  /**
   * Advertise / stop the host's P2P stream (host only, server-enforced).
   * Viewers polling the localfile endpoint see availability instantly.
   */
  const setP2PSharing = useCallback(
    async (on: boolean) => {
      await postModerationAction({ action: "p2pshare", on });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  const changeVideoSource = useCallback(
    async (videoUrl: string) => {
      const data = await postModerationAction({ action: "source", videoUrl });
      if (data?.room) {
        onSourceChangedRef.current?.({
          videoSource: data.room.videoSource,
          videoType: data.room.videoType,
        });
      }
      toast.success("Video source changed for everyone.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  /**
   * Switch the room to a "My Files" movie (privileged only, server-enforced).
   * Viewers then pick the same file on their own devices; only timestamps
   * sync — bytes never leave anyone's device.
   */
  const switchToLocalFile = useCallback(
    async (fingerprint: LocalFingerprint) => {
      const data = await postModerationAction({
        action: "source",
        localFile: fingerprint,
      });
      if (data?.room) {
        onSourceChangedRef.current?.({
          videoSource: data.room.videoSource,
          videoType: data.room.videoType,
        });
      }
      toast.success("Switched to a local file — everyone picks it on their device.");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug]
  );

  // Overlay the authoritative role map onto the merged member list so
  // Stream-watcher copies (which carry no role) still render correctly.
  // Same for local-file match badges (server presence copies win).
  const membersWithRoles = members.map((m) => ({
    ...m,
    role:
      roleMap[m.id] ??
      (m.id === hostId ? ("host" as RoomRole) : m.role),
    fileMatch: fileMatchMap[m.id] ?? m.fileMatch ?? null,
  }));

  return {
    isHost,
    isCohost,
    canControl,
    myRole,
    hostId,
    syncState,
    driftSeconds,
    connection,
    reconnecting: connection !== "online",
    resyncFromServer,
    members: membersWithRoles,
    messages,
    isHostBuffering,
    handleHostPlayerEvent,
    sendMessage,
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
    refreshRoles: fetchRoles,
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
  };
}
