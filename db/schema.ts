import { pgTable, text, timestamp, boolean, uuid, pgEnum, doublePrecision, jsonb, integer } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  issuer: text("issuer"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// PeerMates Core Tables

export const videoTypeEnum = pgEnum("video_type", ["youtube", "hls", "mp4", "localfile", "embed"]);
export const participantRoleEnum = pgEnum("participant_role", ["host", "cohost", "viewer"]);
export const playbackEventTypeEnum = pgEnum("playback_event_type", [
  "play",
  "pause",
  "seek",
  "heartbeat",
]);

export const rooms = pgTable("rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull().default("PeerMates Party"),
  hostId: text("host_id")
    .notNull()
    .references(() => user.id),
  videoSource: text("video_source").notNull(),
  videoType: videoTypeEnum("video_type").notNull().default("youtube"),
  streamChannelId: text("stream_channel_id").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const roomParticipants = pgTable("room_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: participantRoleEnum("role").notNull().default("viewer"),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
});

export const playbackEvents = pgTable("playback_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  eventType: playbackEventTypeEnum("event_type").notNull(),
  position: doublePrecision("position").notNull(),
  emittedBy: text("emitted_by")
    .notNull()
    .references(() => user.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof user.$inferSelect;
export type Room = typeof rooms.$inferSelect;
export type RoomParticipant = typeof roomParticipants.$inferSelect;
export type PlaybackEvent = typeof playbackEvents.$inferSelect;

// Party Replay: saved watch-party moments (timestamps + text only —
// video bytes are never stored, keeping it free-tier and copyright-safe).

/** Replay visibility chosen by the host at party end. */
export const replayVisibilityEnum = pgEnum("replay_visibility", [
  "public",
  "circle",
  "private",
]);

export const partyReplays = pgTable("party_replays", {
  /** Short public id (nanoid) used in /replay/[id] links. */
  id: text("id").primaryKey(),
  roomSlug: text("room_slug").notNull(),
  title: text("title").notNull().default("PeerMates Party"),
  videoType: videoTypeEnum("video_type").notNull().default("youtube"),
  /** Remote source only (mp4/hls/youtube). Local files replay from the
      viewer's own copy, verified against fileFingerprint. */
  videoSource: text("video_source"),
  fileFingerprint: jsonb("file_fingerprint"),
  durationSec: doublePrecision("duration_sec").notNull().default(0),
  viewerCount: integer("viewer_count").notNull().default(0),
  visibility: replayVisibilityEnum("visibility").notNull().default("public"),
  /** Reactions-per-10s curve across the runtime. */
  buckets: jsonb("buckets").notNull().default([]),
  /** Top non-adjacent buckets: [{ t, count, label }]. */
  peaks: jsonb("peaks").notNull().default([]),
  highlights: jsonb("highlights").notNull().default({}),
  topEmoji: text("top_emoji"),
  hostId: text("host_id").notNull(),
  hostName: text("host_name"),
  endedAt: timestamp("ended_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One replayable moment: reaction, chat message, voice note, or pinned
 * comment — always anchored to a video timestamp (seconds).
 */
export const partyEvents = pgTable("party_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Set when the party is finalized into a replay (null while buffering). */
  replayId: text("replay_id"),
  roomSlug: text("room_slug").notNull(),
  userId: text("user_id").notNull(),
  userName: text("user_name"),
  type: text("type").notNull(),
  videoTime: doublePrecision("video_time").notNull().default(0),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PartyReplay = typeof partyReplays.$inferSelect;
export type PartyEvent = typeof partyEvents.$inferSelect;
