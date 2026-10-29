import { db } from "@/db/drizzle";
import { rooms, roomParticipants, user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { VideoType } from "@/lib/video/detector";
import { redis } from "@/lib/redis/client";
import { setRoomState } from "@/lib/redis/roomState";
import { seedHostRole, setRole } from "@/lib/redis/roles";
import type { LocalFingerprint } from "@/lib/video/localfile";

export interface RoomRecord {
  id: string;
  slug: string;
  title: string;
  hostId: string;
  videoSource: string;
  videoType: VideoType;
  streamChannelId: string;
  isActive: boolean;
  createdAt: Date;
  hostName?: string;
  hostImage?: string;
}

// In-memory fallback if Neon database is not connected. Keep it on
// globalThis so every route bundle in the same server process sees the same
// rooms (Next.js compiles route handlers into separate module graphs).
const globalRooms = globalThis as unknown as {
  __peermatesFallbackRooms?: Map<string, RoomRecord>;
};
const fallbackRooms =
  globalRooms.__peermatesFallbackRooms ??
  (globalRooms.__peermatesFallbackRooms = new Map<string, RoomRecord>());

const ROOM_RECORD_KEY = (slug: string) => `room:${slug}:record`;
const ROOM_RECORD_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function serializeRoom(room: RoomRecord): Record<string, unknown> {
  return { ...room, createdAt: room.createdAt.toISOString() };
}

function reviveRoom(raw: unknown): RoomRecord | null {
  try {
    const value =
      typeof raw === "string"
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown> | null);
    if (!value || typeof value.slug !== "string") return null;
    return {
      ...(value as unknown as RoomRecord),
      createdAt: new Date(
        typeof value.createdAt === "string" || value.createdAt instanceof Date
          ? value.createdAt
          : Date.now()
      ),
    };
  } catch {
    return null;
  }
}

// Redis is the shared fallback when Postgres writes fail or are unavailable.
// It also makes room lookups fast and identical across route bundles.
async function cacheRoomRecord(room: RoomRecord): Promise<void> {
  if (!redis) return;
  try {
    await redis.set(ROOM_RECORD_KEY(room.slug), serializeRoom(room), {
      ex: ROOM_RECORD_TTL_SECONDS,
    });
  } catch {
    // database + in-memory fallback still work
  }
}

async function readRoomRecord(slug: string): Promise<RoomRecord | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get<unknown>(ROOM_RECORD_KEY(slug));
    return reviveRoom(raw);
  } catch {
    return null;
  }
}

export async function createRoomInDb(data: {
  slug: string;
  title: string;
  hostId: string;
  hostName?: string;
  hostImage?: string;
  videoSource: string;
  videoType: VideoType;
}): Promise<RoomRecord> {
  const roomData: RoomRecord = {
    id: crypto.randomUUID(),
    slug: data.slug,
    title: data.title || "PeerMates Party",
    hostId: data.hostId,
    videoSource: data.videoSource,
    videoType: data.videoType,
    streamChannelId: `watchparty_${data.slug}`,
    isActive: true,
    createdAt: new Date(),
    hostName: data.hostName || "Host",
    hostImage: data.hostImage,
  };

  try {
    if (process.env.DATABASE_URL) {
      // Ensure host user exists in DB if needed
      await db
        .insert(user)
        .values({
          id: data.hostId,
          name: data.hostName || "Guest Host",
          email: `${data.hostId}@watchtogether.local`,
          emailVerified: true,
          image: data.hostImage || null,
        })
        .onConflictDoNothing();

      await db.insert(rooms).values({
        id: roomData.id,
        slug: roomData.slug,
        title: roomData.title,
        hostId: roomData.hostId,
        videoSource: roomData.videoSource,
        videoType: roomData.videoType,
        streamChannelId: roomData.streamChannelId,
        isActive: true,
      });

      await db.insert(roomParticipants).values({
        roomId: roomData.id,
        userId: roomData.hostId,
        role: "host",
      });
    }
  } catch (err) {
    console.warn(
      "Database insert failed, using fallback in-memory store:",
      err,
    );
  }

  fallbackRooms.set(data.slug, roomData);
  await cacheRoomRecord(roomData);

  // Initialize live Redis playback state
  await setRoomState(data.slug, {
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1,
    serverTimestamp: Date.now(),
    hostId: data.hostId,
  });

  // The creator is the host: seed the Redis role store (TTL'd) and mirror
  // the role onto the GetStream channel membership.
  await seedHostRole(data.slug, data.hostId);
  try {
    const { mirrorMemberRole } = await import("@/lib/stream/server");
    await mirrorMemberRole(data.slug, data.hostId, "host");
  } catch {
    // best-effort only
  }

  return roomData;
}

export async function getRoomBySlug(slug: string): Promise<RoomRecord | null> {
  // Rooms created or already read on this instance are cached here. Returning
  // the same object keeps subsequent reads instant (and mutations in place)
  // instead of paying a DB round-trip on every room/file API call.
  const cached = fallbackRooms.get(slug);
  if (cached) return cached;

  const shared = await readRoomRecord(slug);
  if (shared) {
    fallbackRooms.set(slug, shared);
    return shared;
  }

  try {
    if (process.env.DATABASE_URL) {
      const results = await db
        .select()
        .from(rooms)
        .where(eq(rooms.slug, slug))
        .limit(1);

      if (results.length > 0) {
        const r = results[0];
        // Fetch host info
        const hostUser = await db
          .select()
          .from(user)
          .where(eq(user.id, r.hostId))
          .limit(1);

        const room: RoomRecord = {
          id: r.id,
          slug: r.slug,
          title: r.title,
          hostId: r.hostId,
          videoSource: r.videoSource,
          videoType: r.videoType as VideoType,
          streamChannelId: r.streamChannelId,
          isActive: r.isActive,
          createdAt: r.createdAt,
          hostName: hostUser[0]?.name || "Host",
          hostImage: hostUser[0]?.image || undefined,
        };
        fallbackRooms.set(slug, room);
        void cacheRoomRecord(room);
        return room;
      }
    }
  } catch (err) {
    console.warn("Database query failed, reading from in-memory store:", err);
  }

  return fallbackRooms.get(slug) || null;
}

export async function getRecentRooms(): Promise<RoomRecord[]> {
  try {
    if (process.env.DATABASE_URL) {
      const results = await db.select().from(rooms).limit(6);
      if (results.length > 0) {
        return results.map((r) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          hostId: r.hostId,
          videoSource: r.videoSource,
          videoType: r.videoType as VideoType,
          streamChannelId: r.streamChannelId,
          isActive: r.isActive,
          createdAt: r.createdAt,
        }));
      }
    }
  } catch (err) {
    console.warn("Database query failed for recent rooms:", err);
  }

  return Array.from(fallbackRooms.values()).slice(0, 6);
}

/**
 * Transfer room ownership to a new host. Updates the in-memory record,
 * the Neon row (if configured), live Redis playback state, and the Redis
 * role store (old host becomes co-host so the room never loses a
 * privileged user by accident). Callers must authorize beforehand.
 */
export async function transferRoomHost(
  slug: string,
  newHostId: string
): Promise<RoomRecord | null> {
  const room = await getRoomBySlug(slug);
  if (!room) return null;
  const previousHostId = room.hostId;
  room.hostId = newHostId;

  try {
    if (process.env.DATABASE_URL) {
      const { db: database } = await import("@/db/drizzle");
      const { rooms: roomsTable, user: userTable, roomParticipants: participantsTable } = await import(
        "@/db/schema"
      );
      const { eq: eqOp, and: andOp } = await import("drizzle-orm");
      // rooms.host_id references user.id — the successor may never have a
      // user row (e.g. promoted viewer), so upsert one first or the update
      // fails on the foreign key.
      let displayName = "Room Member";
      try {
        const { getPresence } = await import("@/lib/redis/presence");
        const present = await getPresence(slug);
        const found = present.find((m) => m.id === newHostId);
        if (found?.name) displayName = found.name;
      } catch {
        // name is best-effort
      }
      await database
        .insert(userTable)
        .values({
          id: newHostId,
          name: displayName,
          email: `${newHostId}@watchtogether.local`,
          emailVerified: true,
        })
        .onConflictDoNothing();
      await database
        .update(roomsTable)
        .set({ hostId: newHostId, updatedAt: new Date() })
        .where(eqOp(roomsTable.slug, slug));
      // Keep participant roles consistent (best-effort; rows may not exist).
      try {
        await database
          .update(participantsTable)
          .set({ role: "host" })
          .where(
            andOp(
              eqOp(participantsTable.roomId, room.id),
              eqOp(participantsTable.userId, newHostId)
            )
          );
        if (previousHostId && previousHostId !== newHostId) {
          await database
            .update(participantsTable)
            .set({ role: "cohost" })
            .where(
              andOp(
                eqOp(participantsTable.roomId, room.id),
                eqOp(participantsTable.userId, previousHostId)
              )
            );
        }
      } catch {
        // participant rows are optional
      }
    }
  } catch (err) {
    console.warn("Could not update host in database:", err);
  }

  try {
    const { getRoomState } = await import("@/lib/redis/roomState");
    const currentState = await getRoomState(slug);
    if (currentState) {
      currentState.hostId = newHostId;
      await setRoomState(slug, currentState);
    }
  } catch {
    // best-effort
  }

  // Previous host steps down to co-host; new host takes the crown.
  if (previousHostId && previousHostId !== newHostId) {
    await setRole(slug, previousHostId, "cohost");
  }
  await setRole(slug, newHostId, "host");

  try {
    const { mirrorMemberRole, broadcastRoomEvent } = await import(
      "@/lib/stream/server"
    );
    await mirrorMemberRole(slug, newHostId, "host");
    if (previousHostId && previousHostId !== newHostId) {
      await mirrorMemberRole(slug, previousHostId, "cohost");
    }
    await broadcastRoomEvent(slug, {
      type: "room_host_changed",
      newHostId,
    });
  } catch {
    // best-effort only
  }

  await cacheRoomRecord(room);
  return room;
}

/**
 * Change the room's video source (privileged action). Resets playback to
 * paused-at-zero so every follower re-syncs to the new media. For localfile
 * sources, pass the host fingerprint so it is persisted for comparison.
 */
export async function changeRoomSource(
  slug: string,
  videoSource: string,
  videoType: VideoType,
  fingerprint?: LocalFingerprint
): Promise<RoomRecord | null> {
  const room = await getRoomBySlug(slug);
  if (!room) return null;
  room.videoSource = videoSource;
  room.videoType = videoType;

  try {
    if (process.env.DATABASE_URL) {
      const { db: database } = await import("@/db/drizzle");
      const { rooms: roomsTable } = await import("@/db/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      await database
        .update(roomsTable)
        .set({ videoSource, videoType, updatedAt: new Date() })
        .where(eqOp(roomsTable.slug, slug));
    }
  } catch (err) {
    console.warn("Could not update video source in database:", err);
  }

  await setRoomState(slug, {
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1,
    serverTimestamp: Date.now(),
    hostId: room.hostId,
  });

  // Persist a new host fingerprint when switching to a local file.
  if (videoType === "localfile" && fingerprint) {
    try {
      const { setRoomFingerprint } = await import("@/lib/redis/localfile");
      await setRoomFingerprint(slug, fingerprint);
    } catch {
      // best-effort
    }
  }

  try {
    const { broadcastRoomEvent } = await import("@/lib/stream/server");
    await broadcastRoomEvent(slug, {
      type: "room_source_changed",
      videoSource,
      videoType,
    });
  } catch {
    // best-effort only
  }

  await cacheRoomRecord(room);
  return room;
}
