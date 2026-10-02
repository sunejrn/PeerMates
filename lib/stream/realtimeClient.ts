"use client";

import { StreamChat, Channel } from "stream-chat";

// Must match STREAM_CHANNEL_TYPE in lib/stream/server.ts.
// "livestream" is a built-in Stream channel type: any authenticated user can
// watch/post without pre-existing membership (ideal for share-link rooms).
// Custom types like "watchparty" don't exist unless created in the dashboard
// and cause channel.watch() to fail.
const STREAM_CHANNEL_TYPE = "livestream";

export interface PartyMember {
  id: string;
  name: string;
  image?: string;
  role: "host" | "viewer";
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  text: string;
  user: {
    id: string;
    name: string;
    image?: string;
  };
  createdAt: string;
}

export interface RealtimePlaybackEvent {
  type:
    | "playback.play"
    | "playback.pause"
    | "playback.seek"
    | "playback.heartbeat"
    | "playback.buffering"
    | "room.host_changed";
  position?: number;
  serverTimestamp?: number;
  newHostId?: string;
}

export type EventCallback = (event: RealtimePlaybackEvent) => void;
export type MessageCallback = (msg: ChatMessage) => void;
export type MembersCallback = (members: PartyMember[]) => void;

export class RealtimeChannelService {
  private slug: string;
  private currentUser: PartyMember;
  private streamClient: StreamChat | null = null;
  private streamChannel: Channel | null = null;
  private localBroadcast: BroadcastChannel | null = null;
  private eventListeners = new Set<EventCallback>();
  private messageListeners = new Set<MessageCallback>();
  private membersListeners = new Set<MembersCallback>();
  private activeMembers = new Map<string, PartyMember>();
  private isConnected = false;
  private isConnecting = false;
  /** True when Stream cloud is live — enables low-latency realtime. Server
   *  polling in useWatchSync remains the durable cross-device fallback. */
  private streamLive = false;

  constructor(slug: string, currentUser: PartyMember) {
    this.slug = slug;
    this.currentUser = currentUser;
  }

  get isStreamLive() {
    return this.streamLive;
  }

  async connect(apiKey?: string, token?: string): Promise<boolean> {
    if (this.isConnected) return true;
    if (this.isConnecting) return false;

    this.isConnecting = true;

    // 1. Try connecting to GetStream Cloud if credentials provided.
    // Uses the built-in "livestream" channel type so any authenticated user
    // can watch/post without pre-existing membership.
    if (apiKey && token) {
      try {
        const client = StreamChat.getInstance(apiKey);

        // Disconnect a stale different-user session on this singleton
        // (e.g. account switched in the same tab) before connecting.
        if (client.userID && client.userID !== this.currentUser.id) {
          try {
            await client.disconnectUser();
          } catch {
            // ignore
          }
        }

        if (client.userID !== this.currentUser.id) {
          await client.connectUser(
            {
              id: this.currentUser.id,
              name: this.currentUser.name,
              image: this.currentUser.image,
            },
            token
          );
        }

        const channel = client.channel(STREAM_CHANNEL_TYPE, this.slug, {
          name: `Room ${this.slug}`,
        } as any);

        // watch() is get-or-create: subscribes this socket to realtime updates
        await channel.watch({ presence: true });

        // Load existing chat history so a new joiner sees prior messages
        try {
          const history = await channel.query({ messages: { limit: 25 } });
          for (const m of history.messages || []) {
            const msg: ChatMessage = {
              id: m.id,
              text: m.text || "",
              user: {
                id: (m.user?.id as string) || "anonymous",
                name: (m.user?.name as string) || "User",
                image: m.user?.image as string | undefined,
              },
              createdAt:
                (m.created_at as string) || new Date().toISOString(),
            };
            this.messageListeners.forEach((cb) => cb(msg));
          }
        } catch {
          // history is best-effort
        }

        this.streamClient = client;
        this.streamChannel = channel;

        // Listen to custom events, chat, and presence/watcher changes
        channel.on((event: any) => {
          if (event.type && event.type.startsWith("playback.")) {
            const pbEvent: RealtimePlaybackEvent = {
              type: event.type as any,
              position: (event as any).position,
              serverTimestamp: (event as any).serverTimestamp,
            };
            this.eventListeners.forEach((cb) => cb(pbEvent));
          } else if (event.type === "room.host_changed") {
            const hostEvent: RealtimePlaybackEvent = {
              type: "room.host_changed",
              newHostId: (event as any).newHostId,
            };
            this.eventListeners.forEach((cb) => cb(hostEvent));
          } else if (event.type === "message.new" && event.message) {
            const msg: ChatMessage = {
              id: event.message.id,
              text: event.message.text || "",
              user: {
                id: event.message.user?.id || "anonymous",
                name: event.message.user?.name || "User",
                image: event.message.user?.image,
              },
              createdAt: event.message.created_at || new Date().toISOString(),
            };
            this.messageListeners.forEach((cb) => cb(msg));
          } else if (
            event.type === "user.watching.start" ||
            event.type === "user.watching.stop" ||
            event.type === "user.presence.changed" ||
            event.type === "member.added" ||
            event.type === "member.removed" ||
            event.type === "message.new"
          ) {
            this.syncStreamMembers();
          }
        });

        this.syncStreamMembers();
        this.streamLive = true;
        this.isConnected = true;
        this.isConnecting = false;
        return true;
      } catch (err) {
        console.warn(
          "GetStream cloud connection notice (server polling keeps cross-device sync working):",
          err
        );
        this.streamLive = false;
      }
    }

    // 2. BroadcastChannel bridge for same-browser tabs (instant local sync).
    // Cross-device/cross-browser sync is handled by server polling in
    // useWatchSync — BroadcastChannel alone can never pair two accounts.
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      if (!this.localBroadcast) {
        this.localBroadcast = new BroadcastChannel(`watchparty:${this.slug}`);

        this.localBroadcast.onmessage = (e) => {
          const data = e.data;
          if (!data) return;

          if (data.type && data.type.startsWith("playback.")) {
            this.eventListeners.forEach((cb) => cb(data));
          } else if (data.type === "room.host_changed") {
            this.eventListeners.forEach((cb) => cb(data));
          } else if (data.type === "chat.message") {
            this.messageListeners.forEach((cb) => cb(data.message));
          } else if (data.type === "presence.ping") {
            // A member announced their presence
            if (data.member) {
              this.activeMembers.set(data.member.id, data.member);
              this.emitMembers();
              // Respond with our presence
              this.localBroadcast?.postMessage({
                type: "presence.pong",
                member: this.currentUser,
              });
            }
          } else if (data.type === "presence.pong") {
            if (data.member) {
              this.activeMembers.set(data.member.id, data.member);
              this.emitMembers();
            }
          } else if (data.type === "presence.leave") {
            if (data.userId) {
              this.activeMembers.delete(data.userId);
              this.emitMembers();
            }
          }
        };

        // Register self
        this.activeMembers.set(this.currentUser.id, this.currentUser);
        this.emitMembers();

        // Ping others
        this.localBroadcast.postMessage({
          type: "presence.ping",
          member: this.currentUser,
        });

        // Announce departure on tab close
        window.addEventListener("beforeunload", () => {
          this.localBroadcast?.postMessage({
            type: "presence.leave",
            userId: this.currentUser.id,
          });
        });
      }
    }

    this.isConnected = true;
    this.isConnecting = false;
    return true;
  }

  private emitMembers() {
    const list = Array.from(this.activeMembers.values());
    this.membersListeners.forEach((cb) => cb(list));
  }

  private syncStreamMembers() {
    if (!this.streamChannel) return;
    // Watchers = live presence (who is currently watching).
    // state.members are persistent channel members and stay empty for
    // livestream channels, so they must NOT be used for presence.
    const state: any = this.streamChannel.state;
    const watchers: Record<string, any> = state.watchers || {};
    const watcherList = Object.values(watchers);
    const source =
      watcherList.length > 0
        ? watcherList
        : Object.values(state.members || {}).map((m: any) => m.user || m);

    const seen = new Set<string>();
    const members: PartyMember[] = [];
    for (const u of source as any[]) {
      const id = u?.id || u?.user_id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      members.push({
        id,
        name: u?.name || "User",
        image: u?.image,
        role: "viewer",
        joinedAt: u?.created_at
          ? new Date(u.created_at).getTime()
          : Date.now(),
      });
    }
    // Always include self so the local user never disappears from the list
    if (!seen.has(this.currentUser.id)) {
      members.push(this.currentUser);
    }
    members.forEach((m) => this.activeMembers.set(m.id, m));
    this.emitMembers();
  }

  async sendPlaybackEvent(event: RealtimePlaybackEvent): Promise<void> {
    if (this.streamChannel && this.streamLive) {
      try {
        await this.streamChannel.sendEvent(event as any);
      } catch (err) {
        console.warn("Stream sendEvent failed (state polling covers sync):", err);
      }
    }

    // Local bridge dispatch (same-browser tabs)
    if (this.localBroadcast) {
      this.localBroadcast.postMessage(event);
    }
    // NOTE: durable cross-device playback propagation happens via
    // POST /api/rooms/[slug]/state in useWatchSync (saveStateToRedis),
    // which followers poll. No duplicate write here.
  }

  async sendMessage(text: string): Promise<void> {
    if (!text.trim()) return;

    // Persist server-side first so ALL devices/browsers receive it via
    // polling even when Stream custom config blocks the realtime path.
    let serverMsg: ChatMessage | null = null;
    try {
      const res = await fetch(`/api/rooms/${this.slug}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          user: {
            id: this.currentUser.id,
            name: this.currentUser.name,
            image: this.currentUser.image,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        serverMsg = data.message;
        // Echo locally immediately for snappy UX
        if (serverMsg) this.messageListeners.forEach((cb) => cb(serverMsg!));
      }
    } catch {
      // fall through to Stream/local paths
    }

    if (this.streamChannel && this.streamLive) {
      try {
        await this.streamChannel.sendMessage({ text: text.trim() });
        return;
      } catch (err) {
        console.warn("Stream sendMessage failed (server copy already saved):", err);
        return;
      }
    }

    // Same-browser dispatch when Stream is unavailable
    if (this.localBroadcast && !serverMsg) {
      const localMsg: ChatMessage = {
        id: crypto.randomUUID(),
        text: text.trim(),
        user: {
          id: this.currentUser.id,
          name: this.currentUser.name,
          image: this.currentUser.image,
        },
        createdAt: new Date().toISOString(),
      };

      this.localBroadcast.postMessage({
        type: "chat.message",
        message: localMsg,
      });

      // Also trigger own listener
      this.messageListeners.forEach((cb) => cb(localMsg));
    }
  }

  onPlaybackEvent(cb: EventCallback): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  onMessage(cb: MessageCallback): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onMembers(cb: MembersCallback): () => void {
    this.membersListeners.add(cb);
    if (this.activeMembers.size > 0) {
      const currentList = Array.from(this.activeMembers.values());
      queueMicrotask(() => {
        if (this.membersListeners.has(cb)) {
          cb(currentList);
        }
      });
    }
    return () => this.membersListeners.delete(cb);
  }

  disconnect() {
    if (this.localBroadcast) {
      this.localBroadcast.postMessage({
        type: "presence.leave",
        userId: this.currentUser.id,
      });
      this.localBroadcast.close();
      this.localBroadcast = null;
    }
    if (this.streamClient) {
      try {
        this.streamClient.disconnectUser();
      } catch {}
      this.streamClient = null;
      this.streamChannel = null;
    }
    this.streamLive = false;
    this.eventListeners.clear();
    this.messageListeners.clear();
    this.membersListeners.clear();
    this.activeMembers.clear();
    this.isConnected = false;
    this.isConnecting = false;
  }
}
