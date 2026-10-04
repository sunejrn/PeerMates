import { getRoomBySlug } from "@/lib/rooms/store";
import type { ReplayRow } from "@/lib/replay/store";

/**
 * Replay visibility enforcement (server-side, every read/write):
 * - public: anyone with the link
 * - circle: the host + anyone who was at the party (room_participants row)
 * - private: the host only
 * Guests identify by stable actor id (session or persisted guest id) —
 * the same trust model as the rest of the app.
 */
export async function canViewReplay(
  replay: ReplayRow,
  actorId: string
): Promise<boolean> {
  if (!actorId) return false;
  if (replay.visibility === "public") return true;
  if (actorId === replay.hostId) return true;
  if (replay.visibility !== "circle") return false;
  if (!process.env.DATABASE_URL) return false;
  try {
    const room = await getRoomBySlug(replay.roomSlug);
    if (!room) return false;
    if (actorId === room.hostId) return true;
    const { db } = await import("@/db/drizzle");
    const { roomParticipants } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const rows = await db
      .select({ userId: roomParticipants.userId })
      .from(roomParticipants)
      .where(
        and(
          eq(roomParticipants.roomId, room.id),
          eq(roomParticipants.userId, actorId)
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}
