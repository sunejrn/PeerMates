"use client";

import { StreamChat, Channel } from "stream-chat";
import { checkSpam, maskProfanity } from "@/lib/chat/moderate";

// Must match STREAM_CHANNEL_TYPE in lib/stream/server.ts.
// "livestream" is a built-in Stream channel type: any authenticated user can
// watch/post without pre-existing membership (ideal for share-link rooms).
// Custom types like "watchparty" don't exist unless created in the dashboard
// and cause channel.watch() to fail.
const STREAM_CHANNEL_TYPE = "livestream";

export type RoomRole = "host" | "cohost" | "viewer";

export interface PartyMember {
  id: string;
  name: string;
  image?: string;
  role: RoomRole;
  joinedAt: number;
  /**
   * "My Files" rooms only: does this viewer's local file match the host
   * fingerprint? true = Match, false = Different file, null/undefined =
   * no file picked yet (or a non-local room).
   */
  fileMatch?: boolean | null;
}

export interface MessageReplyRef {
  id: string;
  text: string;
  userName: string;
}

export interface MessageAttachment {
  kind: "image" | "video" | "voice" | "file";
  /** Stream CDN URL, or a small data: URL when Stream is unreachable. */
  url: string;
  name?: string;
  size?: number;
  mime?: string;
  /** Voice-note length in seconds. */
  duration?: number;
  /** Precomputed 0..1 peaks — renders the waveform with zero download. */
  waveform?: number[];
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
  /** WhatsApp-style quote of another message (re-replies supported). */
  replyTo?: MessageReplyRef;
  /** emoji -> user ids who reacted (server-authoritative). */
  reactions?: Record<string, string[]>;
  attachment?: MessageAttachment;
  /** "Pin to moment": video seconds this comment is tagged with. */
  moment?: number;
  /** Tombstone: author or moderator removed it. */
  deleted?: boolean;
}

/**
 * Merge two copies of the same message id (realtime echo vs server poll).
 * The server copy is authoritative for content, reactions, and tombstones;
 * a copy without a reactions field (Stream event) keeps existing ones.
 */
export function mergeChatPair(
  a: ChatMessage,
  b: ChatMessage
): ChatMessage {
  // Tombstone wins outright: strip any lingering realtime content.
  if (b.deleted && !a.deleted) {
    return {
      id: a.id,
      text: "",
      user: b.user ?? a.user,
      createdAt: a.createdAt,
      reactions: b.reactions !== undefined ? b.reactions : a.reactions,
      deleted: true,
    };
  }
  return {
    ...(b.text || b.attachment || b.moment !== undefined ? b : a),
    id: a.id,
    reactions: b.reactions !== undefined ? b.reactions : a.reactions,
    deleted: a.deleted || b.deleted || undefined,
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/**
 * Validate + sanitize any raw message (Stream history, message.new,
 * server poll, local echo) into a ChatMessage. Returns null for junk.
 */
export function toChatMessage(raw: unknown): ChatMessage | null {
  const r = asRecord(raw);
  if (!r || typeof r.id !== "string" || !r.id) return null;
  const user = asRecord(r.user);
  if (!user || typeof user.id !== "string" || typeof user.name !== "string") {
    return null;
  }
  const replyRaw = asRecord(r.replyTo);
  const attRaw = asRecord(r.attachment);
  const reactionsRaw = asRecord(r.reactions);
  const reactions: Record<string, string[]> | undefined = reactionsRaw
    ? Object.fromEntries(
        Object.entries(reactionsRaw)
          .filter(
            ([emoji, users]) =>
              typeof emoji === "string" &&
              Array.isArray(users) &&
              users.every((u) => typeof u === "string")
          )
          .map(([emoji, users]) => [emoji, (users as string[]).slice(0, 500)])
      )
    : undefined;

  let attachment: MessageAttachment | undefined;
  if (
    attRaw &&
    (attRaw.kind === "image" ||
      attRaw.kind === "video" ||
      attRaw.kind === "voice" ||
      attRaw.kind === "file") &&
    typeof attRaw.url === "string" &&
    attRaw.url.length > 0 &&
    attRaw.url.length < 2_000_000
  ) {
    attachment = {
      kind: attRaw.kind,
      url: attRaw.url,
      name: typeof attRaw.name === "string" ? attRaw.name.slice(0, 120) : undefined,
      size: typeof attRaw.size === "number" ? attRaw.size : undefined,
      mime: typeof attRaw.mime === "string" ? attRaw.mime.slice(0, 100) : undefined,
      duration: typeof attRaw.duration === "number" ? attRaw.duration : undefined,
      waveform: Array.isArray(attRaw.waveform)
        ? attRaw.waveform
            .filter((n): n is number => typeof n === "number")
            .slice(0, 96)
        : undefined,
    };
  }

  const deleted = r.deleted === true;
  return {
    id: r.id,
    text: deleted ? "" : typeof r.text === "string" ? r.text.slice(0, 1000) : "",
    user: {
      id: user.id,
      name: user.name.slice(0, 60),
      image: typeof user.image === "string" ? user.image : undefined,
    },
    createdAt:
      typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
    replyTo:
      replyRaw && typeof replyRaw.id === "string" && typeof replyRaw.text === "string"
        ? {
            id: replyRaw.id,
            text: replyRaw.text.slice(0, 140),
            userName:
              typeof replyRaw.userName === "string"
                ? replyRaw.userName.slice(0, 60)
                : "User",
          }
        : undefined,
    reactions: reactions && Object.keys(reactions).length > 0 ? reactions : undefined,
    attachment: deleted ? undefined : attachment,
    moment:
      !deleted && typeof r.moment === "number" && r.moment >= 0
        ? r.moment
        : undefined,
    deleted: deleted || undefined,
  };
}

/**
 * Stream custom event names MUST NOT contain dots — Stream reserves "." and
 * rejects them with code 4 ("please use underscores or dashes instead").
 * We use underscores everywhere (e.g. playback_heartbeat). The normalizer
 * below also accepts legacy dotted names for backward compat.
 */
export type RealtimeEventType =
  | "playback_play"
  | "playback_pause"
  | "playback_seek"
  | "playback_heartbeat"
  | "playback_buffering"
  | "room_host_changed"
  | "room_roles_changed"
  | "room_settings_changed"
  | "room_source_changed"
  | "room_control_requested"
  | "room_subtitles_changed"
  | "room_picker_changed"
  | "room_class_changed"
  | "room_kicked";

export function normalizeEventType(t: unknown): RealtimeEventType | null {
  if (typeof t !== "string") return null;
  const fixed = t.replace(/\./g, "_") as RealtimeEventType;
  switch (fixed) {
    case "playback_play":
    case "playback_pause":
    case "playback_seek":
    case "playback_heartbeat":
    case "playback_buffering":
    case "room_host_changed":
    case "room_roles_changed":
    case "room_settings_changed":
    case "room_source_changed":
    case "room_control_requested":
    case "room_subtitles_changed":
    case "room_picker_changed":
    case "room_class_changed":
    case "room_kicked":
      return fixed;
    default:
      return null;
  }
}

export function isPlaybackEventType(t: string): boolean {
  return t.startsWith("playback_") || t.startsWith("playback.");
}

export function isRoomEventType(t: string): boolean {
  return t.startsWith("room_") || t.startsWith("room.");
}

export interface RealtimePlaybackEvent {
  type: RealtimeEventType;
  position?: number;
  serverTimestamp?: number;
  newHostId?: string;
  userId?: string;
  role?: RoomRole;
}

function attachmentLabel(a: MessageAttachment): string {
  if (a.kind === "image") return "Photo";
  if (a.kind === "video") return "Video";
  if (a.kind === "voice") return "Voice note";
  return `${a.name || "File"}`;
}

/**
 * Narrow escape hatch for Stream SDK calls: our syncme_* custom fields are
 * valid at runtime (Stream stores unknown message/event fields as custom
 * data) but absent from the SDK's closed TS types. One documented helper
 * instead of scattered `as any`.
 */
function unchecked<T>(v: unknown): T {
  return v as unknown as T;
}

type StreamMessageInput = Parameters<Channel["sendMessage"]>[0];
type StreamEventInput = Parameters<Channel["sendEvent"]>[0];

export class ChatSendError extends Error {
  code: string;
  retryAfter: number;
  constructor(code: string, message: string, retryAfter = 0) {
    super(message);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export type EventCallback = (event: RealtimePlaybackEvent) => void;
export type MessageCallback = (msg: ChatMessage) => void;
export type MembersCallback = (members: PartyMember[]) => void;
export type TypingCallback = (user: { id: string; name: string }) => void;

export class RealtimeChannelService {
  private slug: string;
  private currentUser: PartyMember;
  private streamClient: StreamChat | null = null;
  private streamChannel: Channel | null = null;
  private localBroadcast: BroadcastChannel | null = null;
  private eventListeners = new Set<EventCallback>();
  private messageListeners = new Set<MessageCallback>();
  private membersListeners = new Set<MembersCallback>();
  private typingListeners = new Set<TypingCallback>();
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
            const raw = unchecked<Record<string, unknown>>(m ?? {});
            const msg = toChatMessage({
              id: m.id,
              text: typeof raw.text === "string" ? raw.text : "",
              user: {
                id: (m.user?.id as string) || "anonymous",
                name: (m.user?.name as string) || "User",
                image: m.user?.image as string | undefined,
              },
              createdAt: (m.created_at as string) || new Date().toISOString(),
              // syncme_* = our namespaced custom fields (never collide with
              // Stream-reserved message fields).
              replyTo: raw.syncme_reply,
              attachment: raw.syncme_attachment,
              moment: raw.syncme_moment,
            });
            if (msg) this.messageListeners.forEach((cb) => cb(msg));
          }
        } catch {
          // history is best-effort
        }

        this.streamClient = client;
        this.streamChannel = channel;

        // Listen to custom events, chat, and presence/watcher changes
        channel.on((event: any) => {
          const normalized = normalizeEventType(event?.type);
          if (normalized && normalized.startsWith("playback_")) {
            const pbEvent: RealtimePlaybackEvent = {
              type: normalized,
              position: (event as any).position,
              serverTimestamp: (event as any).serverTimestamp,
            };
            this.eventListeners.forEach((cb) => cb(pbEvent));
          } else if (normalized && normalized.startsWith("room_")) {
            const roomEvent: RealtimePlaybackEvent = {
              type: normalized,
              newHostId: (event as any).newHostId,
              userId: (event as any).userId,
              role: (event as any).role,
            };
            this.eventListeners.forEach((cb) => cb(roomEvent));
          } else if (event.type === "message.new" && event.message) {
            const raw = unchecked<Record<string, unknown>>(event.message ?? {});
            const msg = toChatMessage({
              id: event.message.id,
              text: typeof raw.text === "string" ? raw.text : "",
              user: {
                id: event.message.user?.id || "anonymous",
                name: event.message.user?.name || "User",
                image: event.message.user?.image,
              },
              createdAt: event.message.created_at || new Date().toISOString(),
              replyTo: raw.syncme_reply,
              attachment: raw.syncme_attachment,
              moment: raw.syncme_moment,
            });
            if (msg) this.messageListeners.forEach((cb) => cb(msg));
          } else if (event.type === "typing.start" && event.user) {
            const u = unchecked<Record<string, unknown>>(event.user ?? {});
            if (typeof u.id === "string" && u.id !== this.currentUser.id) {
              this.typingListeners.forEach((cb) =>
                cb({ id: u.id as string, name: typeof u.name === "string" ? u.name : "Someone" })
              );
            }
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

          const normalized = normalizeEventType(data.type);
          if (normalized && normalized.startsWith("playback_")) {
            this.eventListeners.forEach((cb) =>
              cb({ ...data, type: normalized })
            );
          } else if (normalized && normalized.startsWith("room_")) {
            this.eventListeners.forEach((cb) =>
              cb({ ...data, type: normalized })
            );
          } else if (data.type === "chat.message") {
            const incoming = toChatMessage(data.message);
            if (incoming) this.messageListeners.forEach((cb) => cb(incoming));
          } else if (data.type === "chat.typing") {
            if (data.user?.id && data.user.id !== this.currentUser.id) {
              this.typingListeners.forEach((cb) =>
                cb({ id: String(data.user.id), name: String(data.user.name || "Someone") })
              );
            }
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
    // Defensive: never send a dotted type to Stream (code 4 rejection).
    const safe: RealtimePlaybackEvent = {
      ...event,
      type: normalizeEventType(event.type) ?? event.type,
    };
    if (this.streamChannel && this.streamLive) {
      try {
        await this.streamChannel.sendEvent(safe as any);
      } catch (err) {
        console.warn("Stream sendEvent failed (state polling covers sync):", err);
      }
    }

    // Local bridge dispatch (same-browser tabs)
    if (this.localBroadcast) {
      this.localBroadcast.postMessage(safe);
    }
    // NOTE: durable cross-device playback propagation happens via
    // POST /api/rooms/[slug]/state in useWatchSync (saveStateToRedis),
    // which followers poll. No duplicate write here.
  }

  /**
   * Send a chat message (text and/or rich content).
   *
   * DUPLICATE-SEND FIX: one client-generated id is shared by ALL THREE
   * delivery paths (local echo, Stream realtime event, server poll), so the
   * id-keyed merge in useWatchSync collapses them into a single bubble.
   * Previously each path minted its own id and every message appeared twice.
   *
   * Order is server-first: content guards (slow-mode/mute/spam) reject
   * BEFORE anything is broadcast, so a rejected message never leaks via
   * the realtime path.
   */
  async sendMessage(
    text: string,
    opts?: {
      id?: string;
      replyTo?: MessageReplyRef;
      attachment?: MessageAttachment;
      moment?: number;
    }
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed && !opts?.attachment) return;

    // Instant client-side guards (the server re-enforces authoritatively).
    const spamTarget = trimmed || "(media)";
    const spam = checkSpam(spamTarget);
    if (!spam.ok) {
      throw new ChatSendError("SPAM", spam.reason || "Message blocked.", 0);
    }
    const { clean } = maskProfanity(trimmed);

    const id =
      typeof opts?.id === "string" && opts.id ? opts.id : crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const me = {
      id: this.currentUser.id,
      name: this.currentUser.name,
      image: this.currentUser.image,
    };

    // 1. Persist server-side first (durable cross-device copy).
    // Server rejections are thrown as ChatSendError for the UI.
    let serverMsg: ChatMessage | null = null;
    try {
      const res = await fetch(`/api/rooms/${this.slug}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          text: clean,
          user: me,
          createdAt,
          replyTo: opts?.replyTo,
          attachment: opts?.attachment,
          moment: opts?.moment,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new ChatSendError(
          data?.error || "SEND_FAILED",
          data?.message || "Message was not delivered.",
          data?.retryAfter ?? 0
        );
      }
      const mapped = toChatMessage(data.message);
      if (mapped) {
        serverMsg = mapped;
        // Echo locally immediately for snappy UX (same id => dedupes).
        this.messageListeners.forEach((cb) => cb(serverMsg!));
      }
    } catch (err) {
      if (err instanceof ChatSendError) throw err;
      // network failure: fall through to Stream/local paths with same id
    }

    // 2. Realtime fan-out over Stream (same id => dedupes everywhere).
    if (this.streamChannel && this.streamLive) {
      try {
        await this.streamChannel.sendMessage(
          unchecked<StreamMessageInput>({
            id,
            text: clean || (opts?.attachment ? attachmentLabel(opts.attachment) : ""),
            syncme_reply: opts?.replyTo ?? null,
            syncme_attachment: opts?.attachment ?? null,
            syncme_moment: opts?.moment ?? null,
          })
        );
        return;
      } catch (err) {
        console.warn("Stream sendMessage failed (server copy already saved):", err);
        return;
      }
    }

    // 3. Same-browser dispatch when Stream is unavailable (same id).
    if (this.localBroadcast && !serverMsg) {
      const localMsg: ChatMessage = {
        id,
        text: clean,
        user: me,
        createdAt,
        replyTo: opts?.replyTo,
        attachment: opts?.attachment,
        moment: opts?.moment,
      };

      this.localBroadcast.postMessage({
        type: "chat.message",
        message: localMsg,
      });

      // Also trigger own listener
      this.messageListeners.forEach((cb) => cb(localMsg));
    }
  }

  /** Best-effort removal of the realtime copy after a server-side delete. */
  async deleteStreamMessage(id: string): Promise<void> {
    if (this.streamClient && this.streamLive && id) {
      try {
        await this.streamClient.deleteMessage(id);
      } catch {
        // poll tombstone covers it within seconds
      }
    }
  }

  /**
   * Upload chat media to the Stream CDN (images/voice/files). Throws
   * OFFLINE_MEDIA when Stream is unreachable so the UI can fall back to a
   * small inline embed or show a clean error — Redis never takes multi-MB
   * blobs on the free tier.
   */
  async uploadChatFile(
    file: Blob,
    name: string,
    kind: "image" | "file"
  ): Promise<{ url: string }> {
    if (!this.streamChannel || !this.streamLive) {
      throw new ChatSendError(
        "OFFLINE_MEDIA",
        "Media upload needs a live connection — your text was kept, try the file again.",
        0
      );
    }
    try {
      const payload =
        file instanceof File
          ? file
          : new File([file], name, { type: file.type || "application/octet-stream" });
      const res =
        kind === "image"
          ? await this.streamChannel.sendImage(payload as File)
          : await this.streamChannel.sendFile(payload as File);
      const url = (res as unknown as { file?: unknown })?.file;
      if (typeof url !== "string" || !url) {
        throw new Error("Upload returned no URL.");
      }
      return { url };
    } catch (err) {
      if (err instanceof ChatSendError) throw err;
      throw new ChatSendError(
        "UPLOAD_FAILED",
        "Upload failed. Check your connection and try again.",
        0
      );
    }
  }

  private lastTypingSent = 0;

  /** Ephemeral typing ping (throttled 3s): Stream event + local bridge. */
  async sendTyping(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTypingSent < 3000) return;
    this.lastTypingSent = now;
    if (this.streamChannel && this.streamLive) {
      try {
        await this.streamChannel.sendEvent(
          unchecked<StreamEventInput>({ type: "typing.start" })
        );
      } catch {
        // typing is best-effort
      }
    }
    if (this.localBroadcast) {
      this.localBroadcast.postMessage({
        type: "chat.typing",
        user: { id: this.currentUser.id, name: this.currentUser.name },
      });
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

  onTyping(cb: TypingCallback): () => void {
    this.typingListeners.add(cb);
    return () => this.typingListeners.delete(cb);
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
    this.typingListeners.clear();
    this.membersListeners.clear();
    this.activeMembers.clear();
    this.isConnected = false;
    this.isConnecting = false;
  }
}
