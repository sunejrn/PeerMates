"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChatMessage,
  ChatSendError,
  MessageAttachment,
  MessageReplyRef,
} from "@/lib/stream/realtimeClient";
import { ALLOWED_REACTIONS } from "@/lib/chat/moderate";
import { PTT_ENABLED } from "@/lib/chat/moderate";
import { Spinner } from "@/components/ui/spinner";
import { VoiceRecorder, RecordedVoice } from "./VoiceRecorder";
import { EmojiPicker } from "./EmojiPicker";
import {
  Paperclip,
  Sticker,
  Send,
  FileText,
  Image as ImageIcon,
  Camera,
  Music,
  Pin,
  X,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  FILE_MAX_BYTES,
  INLINE_MAX_BYTES,
  audioExtension,
  compressImage,
  fileIcon,
  formatBytes,
  formatClock,
} from "@/lib/chat/media";
import { toast } from "sonner";

export interface RichSendOpts {
  replyTo?: MessageReplyRef;
  attachment?: MessageAttachment;
  moment?: number;
}

export interface SendOpts extends RichSendOpts {
  text?: string;
}

interface ChatPanelProps {
  slug: string;
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (opts: SendOpts) => Promise<boolean> | boolean | void;
  uploadMedia: (
    file: Blob,
    name: string,
    kind: "image" | "file"
  ) => Promise<{ url: string }>;
  slowModeSeconds?: number;
  chatMuted?: boolean;
  userMuted?: boolean;
  isPrivileged?: boolean;
  /** Data Saver: image thumbnails load only on tap. */
  dataSaver?: boolean;
  typingUsers?: { id: string; name: string }[];
  onTyping?: () => void;
  /** Host/co-hosts may delete anyone's message. */
  canDeleteAny?: boolean;
  onReact?: (id: string, emoji: string) => void;
  onDelete?: (id: string) => void;
  /** Pin-to-moment: privileged taps jump the room video. */
  canControl?: boolean;
  onCaptureMoment?: () => number;
  onPinJump?: (seconds: number) => void;
  /** Chat message text size (Settings > Chat). Default medium. */
  fontSize?: "s" | "m" | "l";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(blob);
  });
}

function copyText(text: string) {
  const done = () => toast.success("Copied to clipboard.");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

type AttachOptionId = "document" | "photos" | "camera" | "audio" | "stickers" | "pin";

const ATTACH_OPTIONS: { id: AttachOptionId; title: string; desc: string }[] = [
  { id: "document", title: "Document", desc: "" },
  { id: "photos", title: "Photos & videos", desc: "Compressed on-device before sending" },
  { id: "camera", title: "Camera", desc: "Take a photo to share" },
  { id: "audio", title: "Audio", desc: "Send an audio file" },
  { id: "stickers", title: "Stickers", desc: "Tap a sticker to send it instantly" },
  { id: "pin", title: "Pin to moment", desc: "Tag this message with the video moment" },
];

function fallbackCopy(text: string, done: () => void) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    done();
  } catch {
    toast.error("Copy failed on this browser.");
  }
}

// ---------- Voice bubble (own player state per message) ----------

function VoiceBubble({
  attachment,
  mine,
}: {
  attachment: MessageAttachment;
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1);
  const [progress, setProgress] = useState(0);
  const peaks = attachment.waveform?.length
    ? attachment.waveform
    : new Array(24).fill(0.35);

  return (
    <div className="flex items-center gap-2 min-w-44 max-w-full">
      <audio
        ref={audioRef}
        src={attachment.url}
        preload="none"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (a.duration > 0) setProgress(a.currentTime / a.duration);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => {
          const a = audioRef.current;
          if (!a) return;
          if (isPlaying) a.pause();
          else {
            a.playbackRate = speed;
            a.play().catch(() => {});
          }
        }}
        aria-label={isPlaying ? "Pause voice note" : "Play voice note"}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg cursor-pointer border border-border ${
          mine ? "bg-background text-foreground" : "bg-foreground text-background"
        }`}
      >
        {isPlaying ? "⏸" : "▶"}
      </button>
      <div className="flex h-9 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
        {peaks.map((p, i) => (
          <span
            key={i}
            className={`w-[3px] shrink-0 rounded-full ${
              i / peaks.length < progress
                ? mine
                  ? "bg-white"
                  : "bg-violet-500"
                : mine
                  ? "bg-white/40"
                  : "bg-muted-foreground/40"
            }`}
            style={{ height: `${Math.max(12, Math.min(1, p) * 100)}%` }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
          setSpeed(next);
          if (audioRef.current) audioRef.current.playbackRate = next;
        }}
        aria-label="Voice playback speed"
        className={`h-11 min-w-11 shrink-0 rounded-lg px-1.5 font-mono text-[11px] font-bold cursor-pointer ${
          mine ? "text-white/90" : "text-foreground"
        }`}
      >
        {speed}x
      </button>
      <span
        className={`font-mono text-[10px] tabular-nums shrink-0 ${
          mine ? "text-white/80" : "text-muted-foreground"
        }`}
      >
        {formatClock(attachment.duration ?? 0)}
      </span>
    </div>
  );
}

// ---------- Image bubble (tap-to-expand, data-saver tap-to-load) ----------

function ImageBubble({
  attachment,
  mine,
  dataSaver,
  loaded,
  onLoad,
  onExpand,
}: {
  attachment: MessageAttachment;
  mine: boolean;
  dataSaver: boolean;
  loaded: boolean;
  onLoad: () => void;
  onExpand: () => void;
}) {
  const showImage = !dataSaver || loaded;
  return (
    <div className="max-w-full">
      {showImage ? (
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand image"
          className="block max-w-full cursor-pointer overflow-hidden rounded-lg"
        >
          <img
            src={attachment.url}
            alt={attachment.name || "Shared photo"}
            loading="lazy"
            className="max-h-64 w-auto max-w-full rounded-lg object-cover"
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={onLoad}
          className={`flex min-h-11 min-w-44 items-center gap-2 rounded-lg border px-3 py-2 text-xs cursor-pointer ${
            mine
              ? "border-border bg-background/10 text-inherit"
              : "border-border bg-background text-foreground"
          }`}
        >
          <span className="text-left">
            Tap to load image
            {typeof attachment.size === "number" && (
              <span className="block font-mono text-[10px] opacity-70">
                ~{formatBytes(attachment.size)} · Data Saver
              </span>
            )}
          </span>
        </button>
      )}
    </div>
  );
}

// ---------- Video bubble (native player, tap-to-play) ----------

function VideoBubble({
  attachment,
  onExpand,
}: {
  attachment: MessageAttachment;
  onExpand: () => void;
}) {
  return (
    <div className="relative max-w-full">
      <video
        src={attachment.url}
        controls
        playsInline
        preload="metadata"
        className="max-h-64 w-auto max-w-full rounded-lg bg-black object-contain"
      />
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand video"
        title="Expand video"
        className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-lg bg-black/60 text-sm text-white cursor-pointer hover:bg-black/80"
      >
        ⤢
      </button>
      {attachment.name && (
        <p className="mt-1 truncate text-[10px] opacity-70 font-mono">
          {attachment.name}
          {typeof attachment.size === "number" &&
            ` · ${formatBytes(attachment.size)}`}
        </p>
      )}
    </div>
  );
}

// ---------- View-once preview (WhatsApp-style: blurred until tapped,
// burns after the first open) ----------

function ViewOncePreview({
  msg,
  burned,
  onOpen,
}: {
  msg: ChatMessage;
  burned: boolean;
  onOpen: () => void;
}) {
  if (burned) {
    return (
      <div className="mb-1 flex min-h-11 min-w-44 items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
        <EyeOff size={15} className="shrink-0" aria-hidden />
        Opened
      </div>
    );
  }
  if (msg.attachment?.kind === "image" && msg.attachment.url) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open view-once photo"
        className="relative mb-1 block max-w-full cursor-pointer overflow-hidden rounded-lg"
      >
        <img
          src={msg.attachment.url}
          alt=""
          aria-hidden
          loading="lazy"
          className="max-h-64 w-auto max-w-full object-cover blur-xl"
        />
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-background/40 text-foreground">
          <Eye size={20} aria-hidden />
          <span className="text-[11px] font-medium">Tap to view once</span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open view-once video"
      className="mb-1 flex min-h-11 min-w-44 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-foreground cursor-pointer"
    >
      <Eye size={16} className="shrink-0" aria-hidden />
      Tap to view once video
    </button>
  );
}

// ---------- Long text (WhatsApp-style "Read more") ----------

const READ_MORE_LIMIT = 280;

function LongText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (text.length <= READ_MORE_LIMIT) {
    return <div className="whitespace-pre-wrap break-words">{text}</div>;
  }
  return (
    <div className="break-words">
      <div className="whitespace-pre-wrap">
        {open ? text : `${text.slice(0, READ_MORE_LIMIT).trimEnd()}…`}
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-0.5 min-h-9 text-xs font-medium text-sky-600 dark:text-sky-400 cursor-pointer"
      >
        {open ? "Show less" : "Read more"}
      </button>
    </div>
  );
}

// ---------- Main panel ----------

export function ChatPanel({
  slug,
  messages,
  currentUserId,
  onSendMessage,
  uploadMedia,
  slowModeSeconds = 0,
  chatMuted = false,
  userMuted = false,
  isPrivileged = false,
  dataSaver = false,
  typingUsers = [],
  onTyping,
  canDeleteAny = false,
  onReact,
  onDelete,
  canControl = false,
  onCaptureMoment,
  onPinJump,
  fontSize = "m",
}: ChatPanelProps) {
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [replyDraft, setReplyDraft] = useState<MessageReplyRef | null>(null);
  const [pinDraft, setPinDraft] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachBusy, setAttachBusy] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<"emoji" | "gif" | "stickers">("emoji");
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [videoLightbox, setVideoLightbox] = useState<{ url: string; name: string } | null>(null);
  /** WhatsApp-style view-once: armed for the next photo/video send. */
  const [viewOnceArmed, setViewOnceArmed] = useState(false);
  /** Guard-collapsed messages the user tapped open (per message id). */
  const [expandedGuards, setExpandedGuards] = useState<Set<string>>(new Set());
  /** View-once messages this device already opened (burned optimistically). */
  const [burnedLocal, setBurnedLocal] = useState<Set<string>>(new Set());
  // Portals render into document.body — always above the sticky video
  // on every viewport. Lazily true on the client; portal content lives
  // outside the React root so there is no hydration mismatch.
  const [mounted] = useState(() => typeof document !== "undefined");
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  /** While recording/previewing voice, the text row hides so 360px never overflows. */
  const [voiceActive, setVoiceActive] = useState(false);
  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const scrollHostRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Only auto-scroll when the user was already near the bottom, so
    // reading history never gets yanked away. Scroll the message
    // container itself (never scrollIntoView on the sentinel — that
    // scrolls the whole page and drags the pinned input bar with it).
    if (stickToBottomRef.current) {
      const el = scrollHostRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    }
  }, [messages, typingUsers]);

  // Close menus on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuFor(null);
        setAttachOpen(false);
        setEmojiOpen(false);
        setLightbox(null);
        setVideoLightbox(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const viewersMuted = chatMuted && !isPrivileged;
  const inputDisabled = userMuted || viewersMuted || isSending;
  /** WhatsApp rule: any draft text swaps the mic for the send button. */
  const hasText = inputText.trim().length > 0 || pinDraft !== null;
  const disabledReason = userMuted
    ? "You are muted in this room"
    : viewersMuted
      ? "Chat is muted for viewers"
      : "Type a message...";

  const clearDrafts = () => {
    setReplyDraft(null);
    setPinDraft(null);
  };

  const buildOpts = () => ({
    ...(replyDraft ? { replyTo: replyDraft } : {}),
    ...(pinDraft !== null ? { moment: pinDraft } : {}),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || inputDisabled) return;
    // Sending always dismisses the emoji/GIF/sticker panel.
    setEmojiOpen(false);
    setAttachOpen(false);
    try {
      setIsSending(true);
      const ok = await onSendMessage({ text: inputText, ...buildOpts() });
      if (ok !== false) {
        setInputText("");
        clearDrafts();
      }
    } finally {
      setIsSending(false);
      // Keep the cursor in the box so the next message flows (WhatsApp-style).
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const startPress = (id: string) => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => setMenuFor(id), 450);
  };
  const cancelPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${CSS.escape(id)}`);
    if (!el) {
      toast.info("Original message isn't loaded.");
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
    setTimeout(() => setFlashId((prev) => (prev === id ? null : prev)), 1600);
  };

  const handleAttachOption = (id: AttachOptionId) => {
    setAttachOpen(false);
    if (id === "document") fileInputRef.current?.click();
    else if (id === "photos") imageInputRef.current?.click();
    else if (id === "camera") cameraInputRef.current?.click();
    else if (id === "audio") audioInputRef.current?.click();
    else if (id === "stickers") {
      setPickerTab("stickers");
      setEmojiOpen(true);
    } else if (id === "pin" && onCaptureMoment) {
      setPinDraft(Math.floor(onCaptureMoment()));
    }
  };

  const openCopy = (msg: ChatMessage) => {
    const text = msg.text || msg.attachment?.url || "";
    if (!text) {
      toast.info("Nothing to copy.");
      return;
    }
    const done = () => toast.success("Copied to clipboard.");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => copyText(text));
    } else {
      copyText(text);
    }
    setMenuFor(null);
  };

  // ----- Media send pipeline: compress -> CDN upload (or tiny inline
  // fallback) -> rich send. Redis never takes multi-MB blobs.
  const resolveMediaUrl = async (
    blob: Blob,
    name: string,
    kind: "image" | "file"
  ): Promise<{ url: string }> => {
    try {
      return await uploadMedia(blob, name, kind);
    } catch (err: unknown) {
      // Small blobs can ride inline when the CDN path is down; big ones
      // must wait for a live connection (keeps server payloads tiny).
      if (
        err instanceof ChatSendError &&
        (err.code === "OFFLINE_MEDIA" || err.code === "UPLOAD_FAILED") &&
        blob.size <= INLINE_MAX_BYTES
      ) {
        return { url: await blobToDataUrl(blob) };
      }
      throw err instanceof Error ? err : new Error("Upload failed.");
    }
  };

  const sendAttachmentMessage = async (
    text: string,
    attachment: MessageAttachment
  ): Promise<boolean> => {
    // Media sends also dismiss the emoji/GIF/sticker panel.
    setEmojiOpen(false);
    setAttachOpen(false);
    // View-once applies to the next photo/video only, then disarms.
    const armed = viewOnceArmed;
    if (armed) setViewOnceArmed(false);
    const withOnce =
      armed && (attachment.kind === "image" || attachment.kind === "video")
        ? { ...attachment, viewOnce: true as const }
        : attachment;
    const ok = await onSendMessage({ text, ...buildOpts(), attachment: withOnce });
    if (ok !== false) {
      setInputText("");
      clearDrafts();
      return true;
    }
    return false;
  };

  /** Burn a view-once message after opening (server persists, poll converges). */
  const markViewed = async (id: string) => {
    setBurnedLocal((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      await fetch(`/api/rooms/${slug}/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "viewed", actorId: currentUserId }),
      });
    } catch {
      // poll converges it; local burn already applied
    }
  };

  const handleVoiceSend = async (v: RecordedVoice) => {
    const name = `voice-note.${audioExtension(v.mime)}`;
    setAttachBusy("Uploading voice note…");
    try {
      const { url } = await resolveMediaUrl(v.blob, name, "file");
      await sendAttachmentMessage("", {
        kind: "voice",
        url,
        name,
        size: v.blob.size,
        mime: v.mime,
        duration: Math.round(v.duration),
        waveform: v.waveform,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Voice note failed to send.");
    } finally {
      setAttachBusy(null);
    }
  };

  const handleImageFile = async (file: File) => {
    await handleMediaFiles([file]);
  };

  // One or many photos and/or videos: images are compressed on-device,
  // videos ride the file CDN path with a video bubble. Each file sends
  // as its own message so captions stay readable.
  const handleMediaFiles = async (files: File[]) => {
    const list = files.filter(Boolean).slice(0, 10);
    if (list.length === 0) return;
    setAttachOpen(false);
    setEmojiOpen(false);
    const caption = inputText;
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const isVideo =
        file.type.startsWith("video/") ||
        /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name);
      try {
        if (isVideo) {
          if (file.size > FILE_MAX_BYTES) {
            toast.error(
              `${file.name}: videos are limited to ${formatBytes(FILE_MAX_BYTES)}.`
            );
            continue;
          }
          setAttachBusy(
            `Uploading video ${i + 1}/${list.length}…`
          );
          const { url } = await resolveMediaUrl(file, file.name, "file");
          await sendAttachmentMessage(i === 0 ? caption : "", {
            kind: "video",
            url,
            name: file.name,
            size: file.size,
            mime: file.type || undefined,
          });
        } else {
          setAttachBusy(
            `Compressing image ${i + 1}/${list.length}…`
          );
          const { blob } = await compressImage(file, (_stage, f) => {
            if (f < 1)
              setAttachBusy(
                `Compressing image ${i + 1}/${list.length}… ${Math.round(f * 100)}%`
              );
          });
          setAttachBusy(`Uploading image ${i + 1}/${list.length}…`);
          const { url } = await resolveMediaUrl(
            blob,
            file.name.replace(/\.[^.]+$/, "") + ".jpg",
            "image"
          );
          await sendAttachmentMessage(i === 0 ? caption : "", {
            kind: "image",
            url,
            name: file.name,
            size: blob.size,
            mime: "image/jpeg",
          });
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : `${file.name} failed to send.`
        );
      }
    }
    setAttachBusy(null);
  };

  const handleDocFile = async (file: File) => {
    setAttachOpen(false);
    if (file.size > FILE_MAX_BYTES) {
      toast.error(`Files are limited to ${formatBytes(FILE_MAX_BYTES)}.`);
      return;
    }
    setAttachBusy(`Uploading ${file.name}…`);
    try {
      const { url } = await resolveMediaUrl(file, file.name, "file");
      await sendAttachmentMessage(inputText, {
        kind: "file",
        url,
        name: file.name,
        size: file.size,
        mime: file.type || undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "File failed to send.");
    } finally {
      setAttachBusy(null);
    }
  };

  // Deleted messages stay as tombstones (so replies still resolve) — the
  // header count only tracks visible messages, so it drops on delete.
  // System notices never count as chat.
  const visibleCount = messages.filter((m) => !m.deleted && !m.system).length;
  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0].name} is typing…`
        : typingUsers.length <= 3
          ? `${typingUsers.map((u) => u.name).join(", ")} are typing…`
          : `${typingUsers.length} people are typing…`;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
          <span>Party Chat</span>
          {slowModeSeconds > 0 && (
            <span className="rounded-lg border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {slowModeSeconds}s slow
            </span>
          )}
        </h3>
        <span className="text-[11px] text-muted-foreground font-mono">
          {visibleCount} messages
        </span>
      </div>

      {/* Moderation notices */}
      {(userMuted || viewersMuted) && (
        <div className="border-b border-border bg-muted px-4 py-2 text-[11px] text-foreground" role="status">
          {userMuted
            ? "You are muted and cannot send messages."
            : "Chat is muted for viewers right now."}
        </div>
      )}

      {/* Messages — independently scrollable, scrollbar hidden, input stays pinned */}
      <div
        ref={scrollHostRef}
        role="log"
        aria-label="Party chat messages"
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="chat-messages min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4"
      >
        <div className="space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-muted-foreground">
              <span>No messages yet. Say hello to everyone!</span>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.user.id === currentUserId;
              const myReactions = new Set(
                Object.entries(msg.reactions ?? {})
                  .filter(([, users]) => users.includes(currentUserId))
                  .map(([emoji]) => emoji)
              );

              // Room system notices (auto slow-mode calm-downs).
              if (msg.system) {
                return (
                  <div key={msg.id} className="flex justify-center px-6">
                    <span className="rounded-full border border-border bg-muted px-3 py-1 text-center text-[11px] text-muted-foreground">
                      {msg.text}
                    </span>
                  </div>
                );
              }

              // Chat Guard collapse (tap to view). Deleted still wins.
              const guardHidden = !!msg.hiddenByGuard && !msg.deleted;
              const guardOpen = expandedGuards.has(msg.id);
              if (guardHidden && !guardOpen) {
                return (
                  <div
                    key={msg.id}
                    id={`msg-${msg.id}`}
                    className={`flex flex-col ${
                      isMe ? "items-end" : "items-start"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 px-1">
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {isMe ? "You" : msg.user.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {new Date(msg.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedGuards((prev) => {
                          const next = new Set(prev);
                          next.add(msg.id);
                          return next;
                        })
                      }
                      aria-label="Hidden by Chat Guard, tap to view"
                      className="flex min-h-11 max-w-[85%] items-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground cursor-pointer"
                    >
                      <EyeOff size={15} className="shrink-0" aria-hidden />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">
                          Hidden by Chat Guard, tap to view
                          {isMe ? " (hidden from others)" : ""}
                        </span>
                        {msg.guardReason && (
                          <span className="block truncate text-[11px]">
                            {msg.guardReason}
                          </span>
                        )}
                      </span>
                    </button>
                  </div>
                );
              }

              // View-once burn state (server flag or local optimistic burn).
              const burned = !!msg.viewedOnce || burnedLocal.has(msg.id);

              return (
                <div
                  key={msg.id}
                  id={`msg-${msg.id}`}
                  className={`relative flex flex-col ${
                    isMe ? "items-end" : "items-start"
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {isMe ? "You" : msg.user.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <div
                    onPointerDown={() => !msg.deleted && startPress(msg.id)}
                    onPointerUp={cancelPress}
                    onPointerMove={cancelPress}
                    onPointerLeave={cancelPress}
                    onContextMenu={(e) => {
                      if (!msg.deleted) {
                        e.preventDefault();
                        cancelPress();
                        setMenuFor(msg.id);
                      }
                    }}
                    className={`relative max-w-[85%] rounded-lg px-3.5 py-2 leading-relaxed select-none ${
                      fontSize === "s" ? "text-[11px]" : fontSize === "l" ? "text-sm" : "text-xs"
                    } ${
                      flashId === msg.id ? "outline-2 outline-offset-2 outline-foreground" : ""
                    } ${
                      isMe
                        ? "bg-foreground text-background"
                        : "bg-muted text-foreground border border-border"
                    }`}
                  >
                    {msg.deleted ? (
                      <span className="italic opacity-70">This message was deleted.</span>
                    ) : (
                      <>
                        {/* Guard-hidden notice on expanded content */}
                        {msg.hiddenByGuard && (
                          <p className="mb-1.5 flex items-center gap-1 text-[10px] opacity-70">
                            <EyeOff size={11} aria-hidden />
                            Hidden by Chat Guard
                            {msg.guardReason ? ` · ${msg.guardReason}` : ""}
                          </p>
                        )}
                        {/* Reply quote */}
                        {msg.replyTo && (
                          <button
                            type="button"
                            onClick={() => jumpToMessage(msg.replyTo!.id)}
                            className="mb-1.5 block w-full truncate rounded-lg border-l-2 border-border bg-background/60 px-2 py-1 text-left text-[11px] cursor-pointer text-muted-foreground"
                            title="Jump to quoted message"
                          >
                            <span className="font-semibold">{msg.replyTo.userName}: </span>
                            {msg.replyTo.text || "(attachment)"}
                          </button>
                        )}

                        {/* Moment pin chip */}
                        {typeof msg.moment === "number" && (
                          canControl ? (
                            <button
                              type="button"
                              onClick={() => onPinJump?.(msg.moment as number)}
                              className="mb-1.5 inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium cursor-pointer"
                              title="Jump video to this moment (host/co-host)"
                            >
                              Pin {formatClock(msg.moment)}
                            </button>
                          ) : (
                            <span
                              className="mb-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] opacity-80"
                              title="Pinned moment — the host can jump the video here"
                            >
                              {formatClock(msg.moment)}
                            </span>
                          )
                        )}

                        {/* Attachment */}
                        {msg.attachment?.kind === "image" &&
                          (msg.attachment.viewOnce && !isMe ? (
                            <ViewOncePreview
                              msg={msg}
                              burned={burned}
                              onOpen={() => {
                                if (burned || !msg.attachment?.url) return;
                                setLightbox({
                                  url: msg.attachment.url,
                                  name: msg.attachment.name || "View-once photo",
                                });
                                void markViewed(msg.id);
                              }}
                            />
                          ) : (
                            <div className="mb-1">
                              <ImageBubble
                                attachment={msg.attachment}
                                mine={isMe}
                                dataSaver={dataSaver}
                                loaded={loadedImages.has(msg.id)}
                                onLoad={() =>
                                  setLoadedImages((prev) => new Set(prev).add(msg.id))
                                }
                                onExpand={() =>
                                  setLightbox({
                                    url: msg.attachment!.url,
                                    name: msg.attachment!.name || "Shared photo",
                                  })
                                }
                              />
                              {msg.attachment.viewOnce && (
                                <p className="mt-1 flex items-center gap-1 font-mono text-[10px] opacity-70">
                                  <Eye size={11} aria-hidden />
                                  {burned ? "Opened" : "View once"}
                                </p>
                              )}
                            </div>
                          ))}
                        {msg.attachment?.kind === "voice" && (
                          <div className="mb-1">
                            <VoiceBubble attachment={msg.attachment} mine={isMe} />
                          </div>
                        )}
                        {msg.attachment?.kind === "video" &&
                          (msg.attachment.viewOnce && !isMe ? (
                            <ViewOncePreview
                              msg={msg}
                              burned={burned}
                              onOpen={() => {
                                if (burned || !msg.attachment?.url) return;
                                setVideoLightbox({
                                  url: msg.attachment.url,
                                  name: msg.attachment.name || "View-once video",
                                });
                                void markViewed(msg.id);
                              }}
                            />
                          ) : (
                            <div className="mb-1">
                              <VideoBubble
                                attachment={msg.attachment}
                                onExpand={() =>
                                  setVideoLightbox({
                                    url: msg.attachment!.url,
                                    name: msg.attachment!.name || "Shared video",
                                  })
                                }
                              />
                              {msg.attachment.viewOnce && (
                                <p className="mt-1 flex items-center gap-1 font-mono text-[10px] opacity-70">
                                  <Eye size={11} aria-hidden />
                                  {burned ? "Opened" : "View once"}
                                </p>
                              )}
                            </div>
                          ))}
                        {msg.attachment?.kind === "file" && (
                          <div className="mb-1">
                            {(() => {
                              const { label } = fileIcon(
                                msg.attachment!.name || "",
                                msg.attachment!.mime
                              );
                              return (
                                <a
                                  href={msg.attachment!.url}
                                  download={msg.attachment!.name || true}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border px-3 py-2"
                                >
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-medium">
                                      {msg.attachment!.name || label}
                                    </span>
                                    {typeof msg.attachment!.size === "number" && (
                                      <span className="block font-mono text-[10px] opacity-70">
                                        {label} · {formatBytes(msg.attachment!.size)}
                                      </span>
                                    )}
                                  </span>
                                  <span className="shrink-0 text-xs" aria-hidden>Download</span>
                                </a>
                              );
                            })()}
                          </div>
                        )}

                        {msg.text && <LongText text={msg.text} />}
                      </>
                    )}
                  </div>

                  {/* Reactions row */}
                  {!msg.deleted && msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="mt-1 flex max-w-[85%] flex-wrap gap-1 px-1">
                      {Object.entries(msg.reactions).map(([emoji, users]) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => onReact?.(msg.id, emoji)}
                          aria-label={`React ${emoji} (${users.length})`}
                          className={`flex min-h-11 items-center gap-1 rounded-lg border px-2 text-xs cursor-pointer ${
                            myReactions.has(emoji)
                              ? "border-foreground text-foreground"
                              : "border-border bg-background text-muted-foreground"
                          }`}
                        >
                          <span aria-hidden>{emoji}</span>
                          <span className="font-mono text-[10px]">{users.length}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Message actions — compact popover anchored to the bubble
                      (same inline pattern as the emoji picker, never fullscreen) */}
                  {!msg.deleted && menuFor === msg.id && (
                    <>
                      <div
                        className="fixed inset-0 z-20"
                        onClick={() => setMenuFor(null)}
                        aria-hidden
                      />
                      <div
                        className={`absolute top-full z-30 mt-1 w-60 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground ${
                          isMe ? "right-0" : "left-0"
                        }`}
                        role="dialog"
                        aria-label="Message actions"
                      >
                        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Quick reactions">
                          {ALLOWED_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => {
                                onReact?.(msg.id, emoji);
                                setMenuFor(null);
                              }}
                              aria-label={`React ${emoji}`}
                              className="flex min-h-11 items-center justify-center rounded-lg border border-border text-xl cursor-pointer hover:bg-muted"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => openCopy(msg)}
                          className="mt-1 flex min-h-11 w-full items-center rounded-lg px-3 text-xs text-foreground cursor-pointer hover:bg-muted"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReplyDraft({
                              id: msg.id,
                              text: (msg.text || "").slice(0, 140),
                              userName:
                                msg.user.id === currentUserId ? "You" : msg.user.name,
                            });
                            setMenuFor(null);
                            requestAnimationFrame(() => inputRef.current?.focus());
                          }}
                          className="flex min-h-11 w-full items-center rounded-lg px-3 text-xs text-foreground cursor-pointer hover:bg-muted"
                        >
                          Reply
                        </button>
                        {(msg.user.id === currentUserId || canDeleteAny) && (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFor(null);
                              onDelete?.(msg.id);
                            }}
                            className="flex min-h-11 w-full items-center rounded-lg px-3 text-xs cursor-pointer hover:bg-muted"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
          {/* WhatsApp-style typing bubble */}
          {typingUsers.length > 0 && (
            <div className="flex flex-col items-start" aria-live="polite">
              <div className="flex items-center gap-1.5 mb-1 px-1">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {typingUsers.length === 1
                    ? typingUsers[0].name
                    : `${typingUsers.length} people`}
                </span>
              </div>
              <div
                className="flex items-center gap-1 rounded-lg border border-border bg-muted px-3.5 py-3"
                role="status"
                aria-label={typingLabel ?? "Someone is typing"}
              >
                <span className="typing-dot" />
                <span className="typing-dot typing-dot-2" />
                <span className="typing-dot typing-dot-3" />
              </div>
            </div>
          )}
          <div ref={scrollBottomRef} />
        </div>
      </div>

      {/* Reply draft */}
      {replyDraft && (
        <div className="flex items-center gap-2 border-t border-border bg-muted px-3 py-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border-l-2 border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Replying to {replyDraft.userName}: </span>
            {replyDraft.text || "(attachment)"}
          </div>
          <button
            type="button"
            onClick={() => setReplyDraft(null)}
            aria-label="Cancel reply"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Upload status */}
      {attachBusy && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-[11px] text-muted-foreground" role="status">
          <Spinner className="size-3.5 shrink-0" />
          {attachBusy}
        </div>
      )}

      {/* Pin draft indicator — above the input so the send bar stays
          pinned at the bottom and never shifts. */}
      {pinDraft !== null && (
        <div className="flex items-center gap-2 border-t border-border bg-muted px-3 py-1.5 text-[11px] shrink-0">
          <span className="min-w-0 flex-1 truncate">Pinned to {formatClock(pinDraft)} — host taps jump the video</span>
          <button
            type="button"
            onClick={() => setPinDraft(null)}
            aria-label="Remove moment pin"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Chat Input — WhatsApp-style pill bar with safe-area padding.
          Typing swaps the mic for a circular send button; the voice
          recorder owns the full row while recording/previewing. */}
      <div className="relative shrink-0 border-t border-border p-2 sm:p-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)]">
        {emojiOpen && !voiceActive && (
          <EmojiPicker
            key={pickerTab}
            initialTab={pickerTab}
            onPick={(emoji) => {
              setInputText((prev) => prev + emoji);
              inputRef.current?.focus();
            }}
            onSendSticker={(emoji) => {
              setEmojiOpen(false);
              void onSendMessage({ text: emoji });
            }}
          />
        )}
        {/* Attach popover — compact inline panel like the emoji picker
            (same spot, same size language), never a fullscreen sheet. */}
        {attachOpen && (
          <>
            <div
              className="fixed inset-0 z-20"
              onClick={() => setAttachOpen(false)}
              aria-hidden
            />
            <div
              className="absolute inset-x-0 bottom-full z-30 mb-2 rounded-lg border border-border bg-popover text-popover-foreground"
              role="dialog"
              aria-label="Attach options"
            >
              <div className="flex items-center justify-between px-3 pt-2.5">
                <p className="text-xs font-semibold">Share</p>
                <button
                  type="button"
                  onClick={() => setAttachOpen(false)}
                  aria-label="Close attach options"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X size={17} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5 p-2.5 pt-1">
                {ATTACH_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleAttachOption(opt.id)}
                    title={opt.id === "document" ? `Send a file (up to ${formatBytes(FILE_MAX_BYTES)})` : opt.desc}
                    className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border px-2.5 text-left cursor-pointer hover:bg-muted"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border">
                      {opt.id === "document" ? (
                        <FileText size={16} />
                      ) : opt.id === "photos" ? (
                        <ImageIcon size={16} />
                      ) : opt.id === "camera" ? (
                        <Camera size={16} />
                      ) : opt.id === "audio" ? (
                        <Music size={16} />
                      ) : opt.id === "stickers" ? (
                        <Sticker size={16} />
                      ) : (
                        <Pin size={16} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {opt.title}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={viewOnceArmed}
                aria-label="View once for the next photo or video"
                onClick={() => setViewOnceArmed((v) => !v)}
                className="mx-2.5 mb-2.5 flex min-h-11 w-[calc(100%-1.25rem)] items-center gap-2.5 rounded-lg border border-border px-3 text-left cursor-pointer hover:bg-muted"
              >
                <Eye size={16} className="shrink-0" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium">View once</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    Next photo/video burns after opening
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
                    viewOnceArmed ? "border-foreground bg-foreground" : "border-border bg-muted"
                  }`}
                >
                  <span
                    className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-all ${
                      viewOnceArmed ? "left-[1.35rem]" : "left-1"
                    }`}
                  />
                </span>
              </button>
            </div>
          </>
        )}
        <form onSubmit={handleSubmit} className="flex items-center gap-1.5">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            aria-label="Attach photos or videos (multiple allowed)"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length > 0) void handleMediaFiles(files);
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            aria-label="Attach a document"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleDocFile(f);
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Take a photo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleImageFile(f);
            }}
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            aria-label="Attach audio"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleDocFile(f);
            }}
          />
          {/* Single stable recorder instance: it stays mounted while the
              pill chrome hides around it, so starting a recording can
              never unmount (and kill) itself mid-gesture. */}
          <div
            className={
              voiceActive
                ? "flex min-w-0 flex-1 items-center"
                : "flex min-h-12 min-w-0 flex-1 items-center gap-0.5 rounded-full border border-border bg-muted py-1 pl-1.5 pr-1.5"
            }
          >
            {!voiceActive && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEmojiOpen(false);
                    setAttachOpen(true);
                  }}
                  disabled={inputDisabled}
                  aria-label="Attach"
                  title="Attach"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground cursor-pointer disabled:opacity-50"
                >
                  <Paperclip size={20} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAttachOpen(false);
                    setPickerTab("emoji");
                    setEmojiOpen((v) => !v);
                  }}
                  disabled={inputDisabled}
                  aria-label="Emoji, GIF and stickers"
                  title="Emoji, GIF and stickers"
                  aria-pressed={emojiOpen}
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full cursor-pointer disabled:opacity-50 ${
                    emojiOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Sticker size={20} />
                </button>
                <input
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Auto-capitalize the first letter of every message.
                    setInputText(
                      inputText.length === 0 && /^[a-z]/.test(v)
                        ? v.charAt(0).toUpperCase() + v.slice(1)
                        : v
                    );
                    if (v.length > 0) onTyping?.();
                  }}
                  placeholder={disabledReason}
                  disabled={inputDisabled}
                  aria-label="Type a message"
                  autoCapitalize="sentences"
                  autoCorrect="on"
                  className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-60"
                />
              </>
            )}
            {(!hasText || voiceActive) && (
              <VoiceRecorder
                key="chat-voice-recorder"
                disabled={inputDisabled}
                ptt={PTT_ENABLED}
                transparentIdle={!voiceActive}
                onSend={handleVoiceSend}
                onError={(m) => toast.error(m)}
                onActiveChange={setVoiceActive}
              />
            )}
          </div>
          {hasText && !voiceActive && (
            <button
              type="submit"
              disabled={isSending || inputDisabled}
              aria-label="Send message"
              title="Send"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground text-background cursor-pointer disabled:opacity-50"
            >
              {isSending ? (
                <span className="text-sm">…</span>
              ) : (
                <Send size={18} />
              )}
            </button>
          )}
        </form>
      </div>

      {/* Image lightbox — portaled above video */}
      {mounted &&
        lightbox &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex flex-col bg-black/95 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
            role="dialog"
            aria-label="Expanded image"
          >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-zinc-300">{lightbox.name}</span>
            <div className="flex gap-2">
              <a
                href={lightbox.url}
                download={lightbox.name}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Download image"
                className="flex h-11 px-3 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-xs text-white"
              >
                Download
              </a>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Close image"
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden py-2">
            <img
              src={lightbox.url}
              alt={lightbox.name}
              className="max-h-full max-w-full rounded-lg object-contain"
            />
          </div>
        </div>,
        document.body
      )}

      {/* Video lightbox — portaled above video */}
      {mounted &&
        videoLightbox &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex flex-col bg-black/95 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
            role="dialog"
            aria-label="Expanded video"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-zinc-300">{videoLightbox.name}</span>
              <div className="flex gap-2">
                <a
                  href={videoLightbox.url}
                  download={videoLightbox.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Download video"
                  className="flex h-11 px-3 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-xs text-white"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setVideoLightbox(null)}
                  aria-label="Close video"
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-hidden py-2">
              <video
                src={videoLightbox.url}
                controls
                autoPlay
                playsInline
                preload="auto"
                className="max-h-full max-w-full rounded-lg bg-black object-contain"
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
