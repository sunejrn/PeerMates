"use client";

/**
 * "Stream from host" WebRTC P2P layer (mesh: host -> each viewer).
 *
 * Scope and honesty (also stated in the UI):
 * - Small groups only — the server caps receivers at 8. A host uploading to
 *   N viewers needs ~N x bitrate upstream; P2P cannot serve 500 viewers.
 * - Big rooms should use YouTube/links or matching local files (only
 *   timestamps sync, zero media bandwidth). An SFU (e.g. LiveKit free tier)
 *   is the later option for host-streaming at scale.
 * - Signaling rides the existing Upstash-backed /signals endpoint (tiny
 *   SDP/ICE JSON, 2s poll during setup only). No websocket server, no TURN
 *   server (STUN only — symmetric-NAT pairs may fail with a clear message).
 * - Automatic quality cap on the host sender so one tab can't saturate
 *   the host's uplink.
 */

import type { SignalKind, SignalMessage } from "@/lib/redis/signals";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const SIGNAL_POLL_MS = 2000;

export type P2PState =
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "full"
  | "failed"
  | "ended";

async function sendSignal(
  slug: string,
  body: { to: string; kind: SignalKind; payload: unknown; fromName?: string }
): Promise<Response> {
  return fetch(`/api/rooms/${slug}/signals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function pollMailbox(slug: string, userId: string): Promise<SignalMessage[]> {
  const res = await fetch(
    `/api/rooms/${slug}/signals?for=${encodeURIComponent(userId)}`
  );
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return Array.isArray(data.signals) ? data.signals : [];
}

/** Automatic uplink guard: downscale + bitrate-cap the host's sender. */
async function applyQualityCap(
  pc: RTCPeerConnection,
  receiverCount: number
): Promise<void> {
  try {
    const heavy = receiverCount > 4;
    for (const sender of pc.getSenders()) {
      if (!sender.track || sender.track.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].scaleResolutionDownBy = heavy ? 2 : 1.5;
      params.encodings[0].maxBitrate = heavy ? 600_000 : 1_200_000;
      await sender.setParameters(params);
    }
  } catch {
    // setParameters unsupported — stream still flows, just uncapped
  }
}

function captureVideoStream(
  video: HTMLVideoElement
): MediaStream {
  const v = video as HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const capture = v.captureStream ?? v.mozCaptureStream;
  if (!capture) {
    throw new Error(
      "This browser can't share a video element (captureStream unsupported). Try Chrome or Edge on desktop."
    );
  }
  const stream = capture.call(v);
  if (stream.getVideoTracks().length === 0) {
    throw new Error(
      "No video track to share. Start playing the local file first, then enable sharing."
    );
  }
  return stream;
}

// ---- Host side: one RTCPeerConnection per viewer ----

export interface P2PHostEvents {
  onReceiversChange?: (count: number) => void;
  onError?: (message: string) => void;
}

export class P2PHostSession {
  private slug: string;
  private hostId: string;
  private events: P2PHostEvents;
  private pcs = new Map<string, RTCPeerConnection>();
  private stream: MediaStream | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(slug: string, hostId: string, events: P2PHostEvents = {}) {
    this.slug = slug;
    this.hostId = hostId;
    this.events = events;
  }

  get receiverCount(): number {
    return this.pcs.size;
  }

  /** Start sharing the given <video> element. Throws with a UI message. */
  async start(video: HTMLVideoElement): Promise<void> {
    this.stopped = false;
    this.stream = captureVideoStream(video);
    this.pollTimer = setInterval(() => void this.drain(), SIGNAL_POLL_MS);
    await this.drain();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const [, pc] of this.pcs) {
      try {
        pc.close();
      } catch {
        // ignore
      }
    }
    this.pcs.clear();
    this.events.onReceiversChange?.(0);
  }

  private emitCount(): void {
    this.events.onReceiversChange?.(this.pcs.size);
  }

  private async drain(): Promise<void> {
    if (this.stopped) return;
    let signals: SignalMessage[] = [];
    try {
      signals = await pollMailbox(this.slug, this.hostId);
    } catch {
      return;
    }
    for (const s of signals) {
      try {
        await this.handle(s);
      } catch (err) {
        console.warn("P2P host signal handling notice:", err);
      }
    }
  }

  private async handle(s: SignalMessage): Promise<void> {
    if (s.kind === "p2p-join") {
      await this.addViewer(s.from);
      return;
    }
    const pc = this.pcs.get(s.from);
    if (!pc) return;
    if (s.kind === "p2p-answer") {
      await pc.setRemoteDescription(s.payload as RTCSessionDescriptionInit);
    } else if (s.kind === "p2p-ice") {
      if (s.payload) {
        await pc.addIceCandidate(s.payload as RTCIceCandidateInit);
      }
    } else if (s.kind === "p2p-leave") {
      this.removeViewer(s.from);
    }
  }

  private async addViewer(viewerId: string): Promise<void> {
    if (this.stopped || !this.stream) return;
    this.removeViewer(viewerId);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.pcs.set(viewerId, pc);
    this.emitCount();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        void sendSignal(this.slug, {
          to: viewerId,
          kind: "p2p-ice",
          payload: e.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        this.removeViewer(viewerId);
      }
    };
    for (const track of this.stream.getTracks()) {
      pc.addTrack(track, this.stream);
    }
    await applyQualityCap(pc, this.pcs.size);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await sendSignal(this.slug, {
      to: viewerId,
      kind: "p2p-offer",
      payload: { type: offer.type, sdp: offer.sdp },
    });
    if (!res.ok) {
      this.removeViewer(viewerId);
    }
  }

  private removeViewer(viewerId: string): void {
    const pc = this.pcs.get(viewerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
      this.pcs.delete(viewerId);
      this.emitCount();
    }
  }
}

// ---- Viewer side: single RTCPeerConnection to the host ----

export interface P2PViewerEvents {
  onState?: (state: P2PState, detail?: string) => void;
  onStream?: (stream: MediaStream) => void;
}

export class P2PViewerSession {
  private slug: string;
  private viewerId: string;
  private viewerName: string;
  private events: P2PViewerEvents;
  private pc: RTCPeerConnection | null = null;
  private hostId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    slug: string,
    viewerId: string,
    viewerName: string,
    events: P2PViewerEvents = {}
  ) {
    this.slug = slug;
    this.viewerId = viewerId;
    this.viewerName = viewerName;
    this.events = events;
  }

  /** Request the host stream. Rejects with ROOM_FULL / clear errors. */
  async join(hostId: string): Promise<void> {
    this.stopped = false;
    this.hostId = hostId;
    this.events.onState?.("requesting");
    const res = await sendSignal(this.slug, {
      to: hostId,
      kind: "p2p-join",
      payload: null,
      fromName: this.viewerName,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data?.error === "ROOM_FULL") {
        this.events.onState?.("full", data.message);
        throw new Error(data.message);
      }
      this.events.onState?.("failed", data?.error || "Signal request failed.");
      throw new Error(data?.message || data?.error || "Could not reach the host.");
    }
    this.events.onState?.("connecting");
    // Fail visibly instead of hanging forever (NAT, host tab closed...).
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (!this.stopped && (!this.pc || this.pc.connectionState !== "connected")) {
        this.events.onState?.(
          "failed",
          "Still connecting after 25s — the host may be behind a strict NAT, or their tab closed. Try a matching local file instead."
        );
      }
    }, 25000);
    this.pollTimer = setInterval(() => void this.drain(), SIGNAL_POLL_MS);
    await this.drain();
  }

  async leave(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.hostId) {
      try {
        await sendSignal(this.slug, {
          to: this.hostId,
          kind: "p2p-leave",
          payload: null,
        });
      } catch {
        // best-effort
      }
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {
        // ignore
      }
      this.pc = null;
    }
    this.events.onState?.("ended");
  }

  private async drain(): Promise<void> {
    if (this.stopped) return;
    let signals: SignalMessage[] = [];
    try {
      signals = await pollMailbox(this.slug, this.viewerId);
    } catch {
      return;
    }
    for (const s of signals) {
      try {
        await this.handle(s);
      } catch (err) {
        console.warn("P2P viewer signal handling notice:", err);
      }
    }
  }

  private async handle(s: SignalMessage): Promise<void> {
    if (s.kind === "p2p-offer") {
      if (this.pc) {
        try {
          this.pc.close();
        } catch {
          // ignore
        }
      }
      const pc = new RTCPeerConnection(ICE_SERVERS);
      this.pc = pc;
      pc.ontrack = (e) => {
        const [stream] = e.streams;
        if (stream) this.events.onStream?.(stream);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && this.hostId) {
          void sendSignal(this.slug, {
            to: this.hostId,
            kind: "p2p-ice",
            payload: e.candidate.toJSON(),
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if (this.connectTimer) {
            clearTimeout(this.connectTimer);
            this.connectTimer = null;
          }
          this.events.onState?.("connected");
        } else if (pc.connectionState === "failed") {
          this.events.onState?.(
            "failed",
            "Connection failed (likely NAT/firewall — no TURN server on the free tier). Try a matching local file instead."
          );
        }
      };
      await pc.setRemoteDescription(s.payload as RTCSessionDescriptionInit);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (this.hostId) {
        await sendSignal(this.slug, {
          to: this.hostId,
          kind: "p2p-answer",
          payload: { type: answer.type, sdp: answer.sdp },
        });
      }
    } else if (s.kind === "p2p-ice") {
      if (s.payload && this.pc) {
        await this.pc.addIceCandidate(s.payload as RTCIceCandidateInit);
      }
    } else if (s.kind === "p2p-full") {
      this.events.onState?.("full", "The host stream is full.");
    } else if (s.kind === "p2p-decline") {
      this.events.onState?.("failed", "The host is not sharing right now.");
    }
  }
}
