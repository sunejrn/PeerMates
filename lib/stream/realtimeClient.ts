"use client";

import { StreamChat, Channel } from "stream-chat";

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

  constructor(slug: string, currentUser: PartyMember) {
    this.slug = slug;
    this.currentUser = currentUser;
  }

  async connect(apiKey?: string, token?: string): Promise<boolean> {
    if (this.isConnected) return true;
    if (this.isConnecting) return false;

    this.isConnecting = true;

    // 1. Try connecting to GetStream Cloud if credentials provided
    if (apiKey && token) {
      try {
        const client = StreamChat.getInstance(apiKey);

        // Check if user is already connected to avoid duplicate connection warnings
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

        const channel = client.channel("watchparty", this.slug, {
          name: `Room ${this.slug}`,
        } as any);

        await channel.watch({ presence: true });

        this.streamClient = client;
        this.streamChannel = channel;

        // Listen to custom events
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
            event.type === "user.presence.changed" ||
            event.type === "member.added" ||
            event.type === "member.removed"
          ) {
            this.syncStreamMembers();
          }
        });

        this.syncStreamMembers();
        this.isConnected = true;
        this.isConnecting = false;
        return true;
      } catch (err) {
        console.warn(
          "GetStream cloud connection notice (using local realtime bridge):",
          err
        );
      }
    }

    // 2. BroadcastChannel bridge for local testing / development
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
    const members = Object.values(this.streamChannel.state.members || {}).map(
      (m: any) => ({
        id: m.user_id || m.user?.id,
        name: m.user?.name || "User",
        image: m.user?.image,
        role: (m.role === "admin" ? "host" : "viewer") as "host" | "viewer",
        joinedAt: new Date(m.created_at || Date.now()).getTime(),
      })
    );
    this.membersListeners.forEach((cb) => cb(members));
  }

  async sendPlaybackEvent(event: RealtimePlaybackEvent): Promise<void> {
    if (this.streamChannel) {
      try {
        await this.streamChannel.sendEvent(event as any);
        return;
      } catch (err) {
        console.warn("Stream sendEvent failed:", err);
      }
    }

    // Local bridge dispatch
    if (this.localBroadcast) {
      this.localBroadcast.postMessage(event);
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (!text.trim()) return;

    if (this.streamChannel) {
      try {
        await this.streamChannel.sendMessage({ text });
        return;
      } catch (err) {
        console.warn("Stream sendMessage failed:", err);
      }
    }

    // Local bridge dispatch
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

    if (this.localBroadcast) {
      this.localBroadcast.postMessage({
        type: "chat.message",
        message: localMsg,
      });
    }

    // Also trigger own listener
    this.messageListeners.forEach((cb) => cb(localMsg));
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
    this.eventListeners.clear();
    this.messageListeners.clear();
    this.membersListeners.clear();
    this.activeMembers.clear();
    this.isConnected = false;
    this.isConnecting = false;
  }
}
