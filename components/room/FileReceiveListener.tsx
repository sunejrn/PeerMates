"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { P2PFileReceiver, type FileMeta } from "@/lib/webrtc/fileShare";
import {
  compareFingerprints,
  createLocalObjectUrl,
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
  /** Auto-load the received file into the room player. */
  onFileReceived: (
    file: File,
    objectUrl: string,
    fp: LocalFingerprint,
    match: boolean
  ) => void;
  publishMatch: (match: boolean | null) => void;
}

/**
 * Viewer-side auto-receive: toasts FIRST ("Host is sending you the movie"),
 * then accepts the WebRTC transfer, verifies the fingerprint, auto-loads the
 * file into the player, and re-syncs to the room position. Render once per
 * room (no visible UI except progress toasts).
 */
export function FileReceiveListener({
  slug,
  myId,
  myName,
  hostFingerprint,
  enabled,
  onFileReceived,
  publishMatch,
}: FileReceiveListenerProps) {
  const hostFpRef = useRef(hostFingerprint);
  useEffect(() => {
    hostFpRef.current = hostFingerprint;
  }, [hostFingerprint]);
  const cbRef = useRef({ onFileReceived, publishMatch });
  useEffect(() => {
    cbRef.current = { onFileReceived, publishMatch };
  });

  useEffect(() => {
    if (!enabled || !myId) return;
    const receiver = new P2PFileReceiver(slug, myId, myName || "Viewer");
    let progressToast: string | number | undefined;

    receiver.onOfferToast = (meta: FileMeta, fromName?: string) => {
      toast.info(
        `${fromName || "Host"} is sending you the movie "${meta.name}" — loading it automatically…`,
        { duration: 6000 }
      );
    };
    receiver.onProgress = (meta, receivedBytes) => {
      const pct = Math.round((receivedBytes / Math.max(1, meta.size)) * 100);
      // Throttle: update at 25% steps to avoid toast spam on fast links.
      if (pct % 25 === 0 || receivedBytes >= meta.size) {
        if (progressToast !== undefined) toast.dismiss(progressToast);
        progressToast = toast.loading(`Receiving "${meta.name}"… ${pct}%`, { duration: 4000 });
      }
    };
    receiver.onFile = async ({ file, meta }) => {
      try {
        if (progressToast !== undefined) toast.dismiss(progressToast);
        const url = createLocalObjectUrl(file);
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
        cbRef.current.publishMatch(match);
        cbRef.current.onFileReceived(
          file,
          url,
          fp ?? {
            v: 1,
            name: meta.name,
            size: meta.size,
            duration: 0,
            mime: meta.mime,
            chunks: ["0".repeat(64), "0".repeat(64), "0".repeat(64)] as [string, string, string],
            fpId: "000000000000",
          },
          match
        );
        toast.success(`"${meta.name}" received — now playing in sync with the host.`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not load the received file.");
      }
    };
    receiver.onError = (message) => {
      toast.error(message);
    };
    receiver.start();
    return () => {
      receiver.stop();
      if (progressToast !== undefined) toast.dismiss(progressToast);
    };
  }, [slug, myId, myName, enabled]);

  return null;
}
