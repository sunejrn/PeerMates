import { db } from "@/db/drizzle";
import { rooms, roomParticipants, user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { VideoType } from "@/lib/video/detector";
import { setRoomState } from "@/lib/redis/roomState";

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

// In-memory fallback if Neon database is not connected
const fallbackRooms = new Map<string, RoomRecord>();

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
    title: data.title || "Watch Party",
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

  // Initialize live Redis playback state
  await setRoomState(data.slug, {
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1,
    serverTimestamp: Date.now(),
    hostId: data.hostId,
  });

  return roomData;
}

export async function getRoomBySlug(slug: string): Promise<RoomRecord | null> {
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

        return {
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
