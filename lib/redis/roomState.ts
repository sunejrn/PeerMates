import { redis } from "./client";

export interface RoomLiveState {
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  serverTimestamp: number;
  hostId: string;
}

// In-memory cache fallback for development when Upstash Redis is not connected yet
const inMemoryRoomStates = new Map<string, RoomLiveState>();

export async function setRoomState(
  slug: string,
  state: RoomLiveState
): Promise<void> {
  const key = `room:${slug}:state`;
  if (redis) {
    try {
      // Set state with 24 hours TTL
      await redis.set(key, JSON.stringify(state), { ex: 86400 });
      return;
    } catch (err) {
      console.warn("Failed to write room state to Redis, using in-memory store:", err);
    }
  }
  inMemoryRoomStates.set(slug, state);
}

export async function getRoomState(slug: string): Promise<RoomLiveState | null> {
  const key = `room:${slug}:state`;
  if (redis) {
    try {
      const data = await redis.get<string | RoomLiveState>(key);
      if (!data) return null;
      if (typeof data === "string") {
        return JSON.parse(data) as RoomLiveState;
      }
      return data;
    } catch (err) {
      console.warn("Failed to read room state from Redis, using in-memory store:", err);
    }
  }
  return inMemoryRoomStates.get(slug) || null;
}
