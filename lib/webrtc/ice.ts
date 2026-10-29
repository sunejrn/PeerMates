"use client";

/**
 * Shared WebRTC ICE configuration.
 *
 * STUN handles most home networks. A TURN relay is required when both peers
 * are behind symmetric NAT / strict mobile carriers. Set
 * NEXT_PUBLIC_TURN_URLS (comma separated), NEXT_PUBLIC_TURN_USERNAME and
 * NEXT_PUBLIC_TURN_CREDENTIAL to use your own relay. Without them we keep a
 * free public OpenRelay fallback so setup still has a chance off-LAN.
 */
const envTurnUrls = (process.env.NEXT_PUBLIC_TURN_URLS ?? "")
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const turnServer = envTurnUrls.length
  ? {
      urls: envTurnUrls,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME ?? "",
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL ?? "",
    }
  : {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    };

export const RTC_ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun.relay.metered.ca:80",
      ],
    },
    turnServer,
  ],
};
