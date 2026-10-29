"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { P2PFileReceiver, type FileMeta } from "@/lib/webrtc/fileShare";
import type { FileTransferNoticeState } from "@/components/room/FileTransferNotice";
import {
  compareFingerprints,
  fingerprintFile,
  type LocalFingerprint,
} from "@/lib/video/localfile";

interface FileReceiveListenerProps {
  slug: string;
  myId: string;
  myName: string;
  /** Host fingerprint for match verification (null while loading). */
  hostFingerprint: LocalFingerprint | null;
  enabled: boolean;
  /** Received bytes are ready; the room waits for the user's Play tap. */
  onFileReady: (payload: {
    file: File;
    fp: LocalFingerprint;
    match: boolean;
  }) => void;
  publishMatch: (match: boolean | null) => void;
  /** Drives the persistent transfer card in the room layout. */
  onTransferChange?: (state: FileTransferNoticeState | null) => void;
}

/**
 * Viewer-side auto-receive: the card counts 1-100 as the host streams the
 * file, then waits for an explicit Play tap before loading it into the room
 * player. Render once per room (no visible UI except the transfer card).
 */
export function FileReceiveListener({
  slug,
  myId,
  myName,
  hostFingerprint,
  enabled,
  onFileReady,
  publishMatch,
  onTransferChange,
}: FileReceiveListenerProps) {
  const hostFpRef = useRef(hostFingerprint);
  useEffect(() => {
    hostFpRef.current = hostFingerprint;
  }, [hostFingerprint]);
  const cbRef = useRef({ onFileReady, publishMatch, onTransferChange });
  useEffect(() => {
    cbRef.current = { onFileReady, publishMatch, onTransferChange };
  });

  useEffect(() => {
    if (!enabled || !myId) return;
    const receiver = new P2PFileReceiver(slug, myId, myName || "Viewer");
    let transferId = "";
    let fileName = "";
    let lastPercent = 1;
    const notify = (
      percent: number,
      phase: FileTransferNoticeState["phase"],
      detail?: string
    ) => {
      lastPercent = percent;
      cbRef.current.onTransferChange?.({
        id: transferId || `receive-${Date.now()}`,
        name: fileName || "Movie file",
        percent,
        phase,
        direction: "receive",
        detail,
      });
    };

    receiver.onOfferToast = (meta: FileMeta, fromName?: string) => {
      transferId = `receive-${slug}-${meta.name}-${meta.size}`;
      fileName = meta.name;
      lastPercent = 1;
      notify(
        1,
        "receiving",
        `${fromName || "The host"} is sending ${meta.name}. Keep this tab open.`
      );
    };
    receiver.onProgress = (meta, receivedBytes) => {
      if (!transferId) {
        transferId = `receive-${slug}-${meta.name}-${meta.size}`;
        fileName = meta.name;
      }
      const percent = Math.max(
        1,
        Math.min(99, Math.round((receivedBytes / Math.max(1, meta.size)) * 100))
      );
      if (percent === lastPercent) return;
      notify(percent, "receiving", `Receiving ${meta.name} from the host...`);
    };
    receiver.onFile = async ({ file, meta }) => {
      try {
        if (!fileName) fileName = meta.name;
        notify(100, "preparing", "Checking the received file...");
        // Verify: fingerprint the received bytes against the host file.
        let match = true;
        let fp: LocalFingerprint | null = null;
        try {
          fp = await fingerprintFile(file);
          const host = hostFpRef.current;
          if (host && fp) {
            const cmp = compareFingerprints(host, fp);
            match = cmp.match;
          }
        } catch {
          // fingerprint failure — still play (bytes came from the host)
          match = true;
        }
        const resolved: LocalFingerprint = fp ?? {
          v: 1,
          name: meta.name,
          size: meta.size,
          duration: 0,
          mime: meta.mime,
          chunks: ["0".repeat(64), "0".repeat(64), "0".repeat(64)] as [string, string, string],
          fpId: "000000000000",
        };
        cbRef.current.publishMatch(match);
        cbRef.current.onFileReady({ file, fp: resolved, match });
        notify(100, "ready", "Received. Press play to start watching.");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not prepare the received file.";
        toast.error(message);
        notify(lastPercent, "error", message);
      }
    };
    receiver.onError = (message) => {
      toast.error(message);
      notify(lastPercent, "error", message);
    };
    receiver.start();
    return () => {
      receiver.stop();
    };
  }, [slug, myId, myName, enabled]);

  return null;
}
