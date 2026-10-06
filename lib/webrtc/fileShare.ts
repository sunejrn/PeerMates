"use client";

/**
 * Host -> viewer movie-file transfer over WebRTC DataChannels.
 *
 * Why DataChannel (not server upload): the movie bytes must never touch our
 * server (multi-GB, rights, cost). Signaling reuses the existing
 * /signals mailbox (tiny SDP/ICE JSON only); file bytes flow peer-to-peer.
 *
 * Protocol per recipient:
 *  1. host  -> viewer : file-offer  { sdp, meta: { name, size, mime, fpId } }
 *  2. viewer -> host  : file-accept { sdp }  (auto-accept; toast shown first)
 *     (or file-reject { reason } when the viewer can't take it)
 *  3. datachannel "peermates-file": one JSON meta frame, then raw binary
 *     chunks (64KB), then one JSON done frame.
 *  4. host -> viewer : file-done { name, size } (resync cue via polling)
 */

import type { SignalKind, SignalMessage } from "@/lib/redis/signals";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const SIGNAL_POLL_MS = 800;
export const FILE_CHUNK_BYTES = 128 * 1024;
/** Host progress callbacks are throttled to this cadence (UI stays smooth). */
const PROGRESS_REPORT_MS = 250;
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024; // 4GB guard

export interface FileMeta {
  name: string;
  size: number;
  mime: string;
  /** Host fingerprint id so the viewer can verify after receipt. */
  fpId?: string;
}

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

function waitForBufferLow(channel: RTCDataChannel, threshold = 4 * 1024 * 1024): Promise<void> {
  if (channel.bufferedAmount <= threshold) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    const onLow = () => {
      clearTimeout(timer);
      resolve();
    };
    try {
      channel.bufferedAmountLowThreshold = threshold;
      channel.addEventListener("bufferedamountlow", onLow, { once: true });
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

// ---- Host side: send one File to N viewers ----

export interface FileSendProgress {
  userId: string;
  sentBytes: number;
  size: number;
}

export class P2PFileHostSession {
  private slug: string;
  private hostId: string;
  private hostName: string;
  private pcs = new Map<string, RTCPeerConnection>();
  private channels = new Map<string, RTCDataChannel>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  onProgress: ((p: FileSendProgress) => void) | null = null;
  onDone: ((userId: string) => void) | null = null;
  onError: ((userId: string, message: string) => void) | null = null;

  constructor(slug: string, hostId: string, hostName: string) {
    this.slug = slug;
    this.hostId = hostId;
    this.hostName = hostName;
  }

  /** Start polling the host mailbox for file-accept/ice. Call once. */
  listen(): void {
    if (this.pollTimer) return;
    this.stopped = false;
    this.pollTimer = setInterval(() => void this.drain(), SIGNAL_POLL_MS);
    void this.drain();
  }

  /** Offer `file` to one viewer. Resolves when the transfer completes. */
  async sendTo(file: File, viewerId: string): Promise<void> {
    if (file.size <= 0) throw new Error("That file looks empty.");
    if (file.size > MAX_FILE_BYTES) {
      throw new Error("That file is over 4GB — too large to send peer-to-peer.");
    }
    this.listen();
    this.closePeer(viewerId);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.pcs.set(viewerId, pc);
    const channel = pc.createDataChannel("peermates-file", { ordered: true });
    this.channels.set(viewerId, channel);
    try {
      channel.binaryType = "arraybuffer";
    } catch {
      // ignore
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        void sendSignal(this.slug, {
          to: viewerId,
          kind: "file-ice",
          payload: e.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        this.onError?.(viewerId, "Connection failed (NAT/firewall). Keep the tab open and try again.");
      }
    };

    const meta: FileMeta = {
      name: file.name,
      size: file.size,
      mime: file.type || "video/mp4",
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await sendSignal(this.slug, {
      to: viewerId,
      kind: "file-offer",
      payload: { sdp: { type: offer.type, sdp: offer.sdp }, meta },
      fromName: this.hostName,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      this.closePeer(viewerId);
      throw new Error(data?.message || data?.error || "Could not reach that viewer.");
    }

    // Wait for the channel to open (answer arrives via mailbox drain).
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Viewer did not accept in time (30s). They may have left the room.")), 30000);
      channel.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    // Stream the file in slices — never hold the whole movie in RAM.
    // Progress is throttled (time-based) so large files don't spam React
    // re-renders once per chunk.
    let offset = 0;
    let lastReport = 0;
    const report = (force = false) => {
      const now = Date.now();
      if (force || now - lastReport >= PROGRESS_REPORT_MS) {
        lastReport = now;
        this.onProgress?.({ userId: viewerId, sentBytes: offset, size: file.size });
      }
    };
    channel.send(JSON.stringify({ t: "meta", ...meta }));
    while (offset < file.size) {
      if (this.stopped) throw new Error("Cancelled.");
      const slice = file.slice(offset, offset + FILE_CHUNK_BYTES);
      const buf = await slice.arrayBuffer();
      await waitForBufferLow(channel);
      try {
        channel.send(buf);
      } catch {
        throw new Error("Connection dropped mid-transfer.");
      }
      offset += buf.byteLength;
      report();
    }
    report(true);
    try {
      channel.send(JSON.stringify({ t: "done", size: file.size }));
    } catch {
      // receiver already has all bytes
    }
    try {
      await sendSignal(this.slug, {
        to: viewerId,
        kind: "file-done",
        payload: { name: meta.name, size: meta.size },
        fromName: this.hostName,
      });
    } catch {
      // cue is best-effort; datachannel done-frame already landed
    }
    this.onDone?.(viewerId);
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
        console.warn("file-share host signal notice:", err);
      }
    }
  }

  private async handle(s: SignalMessage): Promise<void> {
    const pc = this.pcs.get(s.from);
    if (!pc) return;
    if (s.kind === "file-accept") {
      const sdp = (s.payload as { sdp?: RTCSessionDescriptionInit })?.sdp;
      if (sdp) await pc.setRemoteDescription(sdp);
    } else if (s.kind === "file-ice") {
      if (s.payload) {
        try {
          await pc.addIceCandidate(s.payload as RTCIceCandidateInit);
        } catch {
          // late candidate — ignore
        }
      }
    } else if (s.kind === "file-reject") {
      const reason =
        (s.payload as { reason?: string })?.reason || "Viewer declined the file.";
      this.onError?.(s.from, reason);
      this.closePeer(s.from);
    }
  }

  private closePeer(viewerId: string): void {
    try {
      this.channels.get(viewerId)?.close();
    } catch {
      // ignore
    }
    this.channels.delete(viewerId);
    const pc = this.pcs.get(viewerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        // ignore
      }
      this.pcs.delete(viewerId);
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const id of Array.from(this.pcs.keys())) this.closePeer(id);
  }
}

// ---- Viewer side: auto-receive the host file ----

export interface ReceivedFile {
  file: File;
  meta: FileMeta;
  fromName?: string;
}

export class P2PFileReceiver {
  private slug: string;
  private viewerId: string;
  private viewerName: string;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private pcs = new Map<string, RTCPeerConnection>();
  onOfferToast: ((meta: FileMeta, fromName?: string) => void) | null = null;
  onProgress: ((meta: FileMeta, receivedBytes: number) => void) | null = null;
  onFile: ((f: ReceivedFile) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(slug: string, viewerId: string, viewerName: string) {
    this.slug = slug;
    this.viewerId = viewerId;
    this.viewerName = viewerName;
  }

  start(): void {
    if (this.pollTimer) return;
    this.stopped = false;
    this.pollTimer = setInterval(() => void this.drain(), SIGNAL_POLL_MS);
    void this.drain();
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
        console.warn("file-share viewer signal notice:", err);
      }
    }
  }

  private async handle(s: SignalMessage): Promise<void> {
    if (s.kind === "file-offer") {
      const payload = s.payload as { sdp?: RTCSessionDescriptionInit; meta?: FileMeta };
      const meta = payload?.meta;
      if (!payload?.sdp || !meta || !meta.size) return;
      if (meta.size > MAX_FILE_BYTES) {
        await sendSignal(this.slug, {
          to: s.from,
          kind: "file-reject",
          payload: { reason: "File too large for this device (over 4GB)." },
        });
        return;
      }
      // Toast FIRST (host requirement), then auto-accept and receive.
      this.onOfferToast?.(meta, s.fromName);
      await this.acceptOffer(s.from, payload.sdp, meta);
      return;
    }
    if (s.kind === "file-ice") {
      const pc = this.pcs.get(s.from);
      if (pc && s.payload) {
        try {
          await pc.addIceCandidate(s.payload as RTCIceCandidateInit);
        } catch {
          // late candidate — ignore
        }
      }
      return;
    }
    if (s.kind === "file-done") {
      // Redundant cue — the datachannel done-frame already completes the
      // file. Kept for future resync wiring.
      return;
    }
  }

  private async acceptOffer(hostId: string, offer: RTCSessionDescriptionInit, meta: FileMeta): Promise<void> {
    const old = this.pcs.get(hostId);
    if (old) {
      try {
        old.close();
      } catch {
        // ignore
      }
    }
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.pcs.set(hostId, pc);
    const chunks: BlobPart[] = [];
    let received = 0;
    let expectedMeta: FileMeta | null = null;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        void sendSignal(this.slug, {
          to: hostId,
          kind: "file-ice",
          payload: e.candidate.toJSON(),
        });
      }
    };
    pc.ondatachannel = (e) => {
      const channel = e.channel;
      try {
        channel.binaryType = "arraybuffer";
      } catch {
        // ignore
      }
      channel.onmessage = (ev) => {
        try {
          if (typeof ev.data === "string") {
            const msg = JSON.parse(ev.data) as { t?: string; size?: number } & Partial<FileMeta>;
            if (msg.t === "meta") {
              expectedMeta = {
                name: String(msg.name || meta.name),
                size: Number(msg.size || meta.size),
                mime: String(msg.mime || meta.mime),
                fpId: (msg as FileMeta).fpId,
              };
              return;
            }
            if (msg.t === "done") {
              const m = expectedMeta ?? meta;
              const blob = new Blob(chunks, { type: m.mime || "video/mp4" });
              const file = new File([blob], m.name, { type: m.mime || "video/mp4" });
              this.onFile?.({ file, meta: m, fromName: undefined });
              try {
                pc.close();
              } catch {
                // ignore
              }
              this.pcs.delete(hostId);
              return;
            }
            return;
          }
          const buf = ev.data as ArrayBuffer;
          chunks.push(buf);
          received += buf.byteLength;
          this.onProgress?.(expectedMeta ?? meta, received);
        } catch (err) {
          console.warn("file chunk notice:", err);
        }
      };
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendSignal(this.slug, {
      to: hostId,
      kind: "file-accept",
      payload: { sdp: { type: answer.type, sdp: answer.sdp } },
      fromName: this.viewerName,
    });
  }
}
