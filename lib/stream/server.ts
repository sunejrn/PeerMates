import { StreamChat } from "stream-chat";

const apiKey = process.env.STREAM_API_KEY || process.env.NEXT_PUBLIC_STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

// Use the built-in "livestream" channel type:
// - exists by default (custom types like "watchparty" must be created in the
//   Stream dashboard first, otherwise channel.watch() fails and clients
//   silently fall back to local-only BroadcastChannel).
// - any authenticated user can watch/post without explicit membership,
//   which is exactly what a share-link watch party needs.
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
    const channel = streamServerClient.channel(STREAM_CHANNEL_TYPE, slug, {
      name: title,
      created_by_id: hostId,
    } as any);
    await channel.create();
    return channel;
  } catch (err) {
    console.warn("Failed to create stream channel:", err);
    return null;
  }
}
