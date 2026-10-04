"use client";

import { useCallback } from "react";
import type {
  MessageAttachment,
  MessageReplyRef,
} from "@/lib/stream/realtimeClient";

export interface CaptureSendOpts {
  text?: string;
  replyTo?: MessageReplyRef;
  attachment?: MessageAttachment;
  moment?: number;
  messageId: string;
}

interface UseReplayCaptureOpts {
  slug: string;
  actorId: string;
  actorName: string;
  /** Current video position in seconds (player clock, not wall clock). */
  getVideoTime: () => number;
}

/**
 * Party Replay capture: fire-and-forget POSTs anchoring every sent message,
 * voice note, pin, reaction, and delete to a video timestamp. Never throws,
 * never toasts — a capture failure must never break chat.
 */
export function useReplayCapture({ slug, actorId, actorName, getVideoTime }: UseReplayCaptureOpts) {
  const post = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        await fetch(`/api/rooms/${slug}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, actorId, userName: actorName, ts: Date.now() }),
        });
      } catch {
        // capture is best-effort by design
      }
    },
    [slug, actorId, actorName]
  );

  const captureSend = useCallback(
    (opts: CaptureSendOpts) => {
      const kind = opts.attachment?.kind;
      if (kind === "voice" && opts.attachment) {
        void post({
          type: "voice",
          videoTime: getVideoTime(),
          messageId: opts.messageId,
          payload: {
            url: opts.attachment.url,
            duration: opts.attachment.duration ?? 0,
            messageId: opts.messageId,
          },
        });
        return;
      }
      if (typeof opts.moment === "number") {
        // Pinned comment: anchored to the pinned moment, not send time.
        void post({
          type: "pin",
          videoTime: opts.moment,
          messageId: opts.messageId,
          payload: {
            text: (opts.text || "").slice(0, 280),
            messageId: opts.messageId,
          },
        });
        return;
      }
      void post({
        type: "message",
        videoTime: getVideoTime(),
        messageId: opts.messageId,
        payload: {
          text: (opts.text || "").slice(0, 280),
          ...(kind === "image" ? { image: opts.attachment?.url } : {}),
          messageId: opts.messageId,
        },
      });
    },
    [post, getVideoTime]
  );

  const captureReaction = useCallback(
    (messageId: string, emoji: string) => {
      void post({
        type: "reaction",
        videoTime: getVideoTime(),
        payload: { emoji, messageId },
      });
    },
    [post, getVideoTime]
  );

  const captureDelete = useCallback(
    (messageId: string) => {
      void post({ action: "delete", messageId });
    },
    [post]
  );

  return { captureSend, captureReaction, captureDelete };
}
