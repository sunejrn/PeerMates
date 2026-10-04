import { StreamChat } from "stream-chat";
import type { ChannelData } from "stream-chat";

const apiKey = process.env.STREAM_API_KEY || process.env.NEXT_PUBLIC_STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

// Use the built-in "livestream" channel type:
// - exists by default (custom types like "watchparty" must be created in the
//   Stream dashboard first, otherwise channel.watch() fails and clients
//   silently fall back to local-only BroadcastChannel).
// - any authenticated user can watch/post without explicit membership,
//   which is exactly what a share-link PeerMates party needs.
export const STREAM_CHANNEL_TYPE = "livestream";

export const isStreamConfigured = Boolean(apiKey && apiSecret);

export const streamServerClient = isStreamConfigured
  ? StreamChat.getInstance(apiKey!, apiSecret!)
  : null;

export async function createStreamUserToken(
  userId: string,
  userName?: string,
  userImage?: string
): Promise<string | null> {
  if (!streamServerClient) {
    return null;
  }

  try {
    // Non-blocking upsert in Stream so network latency/timeout never blocks token issuance
    streamServerClient
      .upsertUser({
        id: userId,
        name: userName || "User",
        image: userImage,
      })
      .catch((err) => {
        console.warn("Stream upsertUser background notice:", err?.message || err);
      });

    // createToken is purely offline cryptographic signing (JWT) with apiSecret
    return streamServerClient.createToken(userId);
  } catch (err) {
    console.error("Failed to create Stream user token:", err);
    return null;
  }
}

export async function ensureStreamChannel(
  slug: string,
  title: string,
  hostId: string
) {
  if (!streamServerClient) return null;

  try {
    // `name` is a dashboard-level custom field outside the typed
    // ChannelData partial, hence the narrow unknown-cast here.
    const data = { name: title, created_by_id: hostId } as unknown as ChannelData;
    const channel = streamServerClient.channel(
      STREAM_CHANNEL_TYPE,
      slug,
      data
    );
    await channel.create();
    // Give the creator moderator powers so role mirroring has a baseline.
    try {
      await channel.assignRoles([
        { user_id: hostId, channel_role: "channel_moderator" },
      ]);
    } catch {
      // best-effort only
    }
    return channel;
  } catch (err) {
    console.warn("Failed to create stream channel:", err);
    return null;
  }
}

type MirrorableRole = "host" | "cohost" | "viewer";

/**
 * Mirror a PeerMates room role onto the GetStream channel membership.
 * Hosts/co-hosts become channel moderators, viewers plain members.
 * Best-effort: never throws, so Stream outages can't break room flows.
 */
export async function mirrorMemberRole(
  slug: string,
  userId: string,
  role: MirrorableRole
): Promise<void> {
  if (!streamServerClient) return;
  try {
    const channel = streamServerClient.channel(STREAM_CHANNEL_TYPE, slug);
    const channel_role =
      role === "viewer" ? "channel_member" : "channel_moderator";
    await channel.assignRoles([{ user_id: userId, channel_role }]);
  } catch (err) {
    console.warn(
      "Stream role mirror notice:",
      err instanceof Error ? err.message : err
    );
  }
}

/** Best-effort removal of a kicked user from the Stream channel. */
export async function removeStreamMember(
  slug: string,
  userId: string
): Promise<void> {
  if (!streamServerClient) return;
  try {
    const channel = streamServerClient.channel(STREAM_CHANNEL_TYPE, slug);
    await channel.removeMembers([userId]);
  } catch (err) {
    console.warn(
      "Stream member removal notice:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Best-effort server-side broadcast of a room event (role changes,
 * control requests, settings). Clients also poll, so delivery here is
 * an enhancement, not a requirement.
 */
export async function broadcastRoomEvent(
  slug: string,
  event: Record<string, unknown>
): Promise<void> {
  if (!streamServerClient) return;
  try {
    const channel = streamServerClient.channel(STREAM_CHANNEL_TYPE, slug);
    // Custom room_* events are outside Stream's typed EVENT_MAP (dots are
    // rejected by Stream code 4), so they go through a narrow unknown-cast
    // at this single choke point. Clients also poll, so this broadcast is
    // an enhancement, not a requirement.
    await channel.sendEvent(event as unknown as Parameters<typeof channel.sendEvent>[0]);
  } catch (err) {
    console.warn(
      "Stream broadcast notice:",
      err instanceof Error ? err.message : err
    );
  }
}
