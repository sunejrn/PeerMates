"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChatMessage,
  ChatSendError,
  MessageAttachment,
  MessageReplyRef,
} from "@/lib/stream/realtimeClient";
import { ALLOWED_REACTIONS } from "@/lib/chat/moderate";
import { PTT_ENABLED } from "@/lib/chat/moderate";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VoiceRecorder, RecordedVoice } from "./VoiceRecorder";
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
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full cursor-pointer ${
          mine ? "bg-white/20 text-white" : "bg-violet-600 text-white"
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
          className="block max-w-full cursor-pointer overflow-hidden rounded-xl"
        >
          <img
            src={attachment.url}
            alt={attachment.name || "Shared photo"}
            loading="lazy"
            className="max-h-64 w-auto max-w-full rounded-xl object-cover"
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={onLoad}
          className={`flex min-h-11 min-w-44 items-center gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer ${
            mine
              ? "border-white/25 bg-white/10 text-white"
              : "border-border bg-background/60 text-foreground"
          }`}
        >
          <span aria-hidden>🖼️</span>
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

// ---------- Main panel ----------

export function ChatPanel({
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
}: ChatPanelProps) {
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [replyDraft, setReplyDraft] = useState<MessageReplyRef | null>(null);
  const [pinDraft, setPinDraft] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachBusy, setAttachBusy] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [flashId, setFlashId] = useState<string | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close menus on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuFor(null);
        setAttachOpen(false);
        setLightbox(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const viewersMuted = chatMuted && !isPrivileged;
  const inputDisabled = userMuted || viewersMuted || isSending;
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
    try {
      setIsSending(true);
      const ok = await onSendMessage({ text: inputText, ...buildOpts() });
      if (ok !== false) {
        setInputText("");
        clearDrafts();
      }
    } finally {
      setIsSending(false);
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
    const ok = await onSendMessage({ text, ...buildOpts(), attachment });
    if (ok !== false) {
      setInputText("");
      clearDrafts();
      return true;
    }
    return false;
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
    setAttachOpen(false);
    setAttachBusy("Compressing image…");
    try {
      const { blob } = await compressImage(file, (_stage, f) => {
        if (f < 1) setAttachBusy(`Compressing image… ${Math.round(f * 100)}%`);
      });
      setAttachBusy("Uploading image…");
      const { url } = await resolveMediaUrl(
        blob,
        file.name.replace(/\.[^.]+$/, "") + ".jpg",
        "image"
      );
      await sendAttachmentMessage(inputText, {
        kind: "image",
        url,
        name: file.name,
        size: blob.size,
        mime: "image/jpeg",
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image failed to send.");
    } finally {
      setAttachBusy(null);
    }
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

  const menuMsg = menuFor ? messages.find((m) => m.id === menuFor) ?? null : null;
  const typingLabel =
    typingUsers.length === 0
      ? null
      : typingUsers.length === 1
        ? `${typingUsers[0].name} is typing…`
        : typingUsers.length <= 3
          ? `${typingUsers.map((u) => u.name).join(", ")} are typing…`
          : `${typingUsers.length} people are typing…`;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card/75 backdrop-blur-xl shadow-xl">
      {/* Chat Header */}
      <div className="flex items-center justify-between border-b border-border/80 px-4 py-3 bg-muted/20">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span>💬 Party Chat</span>
          {slowModeSeconds > 0 && (
            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              🐢 {slowModeSeconds}s slow
            </span>
          )}
        </h3>
        <span className="text-[11px] text-muted-foreground font-mono">
          {messages.length} messages
        </span>
      </div>

      {/* Moderation notices */}
      {(userMuted || viewersMuted) && (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-[11px] text-red-600 dark:text-red-400" role="status">
          {userMuted
            ? "🔇 You are muted and cannot send messages."
            : "🔇 Chat is muted for viewers right now."}
        </div>
      )}

      {/* Messages Scroll Area */}
      <ScrollArea className="flex-1 p-3 sm:p-4">
        <div className="space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-muted-foreground">
              <span className="text-2xl mb-2">🍿</span>
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
                    className={`relative max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed select-none ${
                      flashId === msg.id ? "ring-2 ring-violet-500" : ""
                    } ${
                      isMe
                        ? "bg-linear-to-r from-violet-600 to-indigo-600 text-white rounded-tr-xs shadow-sm shadow-violet-500/10"
                        : "bg-muted text-foreground border border-border/70 rounded-tl-xs"
                    }`}
                  >
                    {msg.deleted ? (
                      <span className="italic opacity-70">🚫 This message was deleted.</span>
                    ) : (
                      <>
                        {/* Reply quote */}
                        {msg.replyTo && (
                          <button
                            type="button"
                            onClick={() => jumpToMessage(msg.replyTo!.id)}
                            className={`mb-1.5 block w-full truncate rounded-lg border-l-2 px-2 py-1 text-left text-[11px] cursor-pointer ${
                              isMe
                                ? "border-white/50 bg-white/10 text-white/90"
                                : "border-violet-500/60 bg-background/60 text-muted-foreground"
                            }`}
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
                              className={`mb-1.5 inline-flex min-h-11 items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold cursor-pointer ${
                                isMe
                                  ? "bg-white/15 text-white"
                                  : "bg-violet-500/10 text-violet-700 dark:text-violet-300 border border-violet-500/30"
                              }`}
                              title="Jump video to this moment (host/co-host)"
                            >
                              📌 {formatClock(msg.moment)}
                            </button>
                          ) : (
                            <span
                              className={`mb-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] opacity-80 ${
                                isMe ? "bg-white/10 text-white" : "bg-background/60 text-muted-foreground"
                              }`}
                              title="Pinned moment — the host can jump the video here"
                            >
                              🕐 {formatClock(msg.moment)}
                            </span>
                          )
                        )}

                        {/* Attachment */}
                        {msg.attachment?.kind === "image" && (
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
                          </div>
                        )}
                        {msg.attachment?.kind === "voice" && (
                          <div className="mb-1">
                            <VoiceBubble attachment={msg.attachment} mine={isMe} />
                          </div>
                        )}
                        {msg.attachment?.kind === "file" && (
                          <div className="mb-1">
                            {(() => {
                              const { icon, label } = fileIcon(
                                msg.attachment!.name || "",
                                msg.attachment!.mime
                              );
                              return (
                                <a
                                  href={msg.attachment!.url}
                                  download={msg.attachment!.name || true}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 ${
                                    isMe
                                      ? "bg-white/10 text-white"
                                      : "bg-background/60 text-foreground border border-border/60"
                                  }`}
                                >
                                  <span className="text-xl shrink-0" aria-hidden>{icon}</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-xs font-semibold">
                                      {msg.attachment!.name || label}
                                    </span>
                                    {typeof msg.attachment!.size === "number" && (
                                      <span className="block font-mono text-[10px] opacity-70">
                                        {label} · {formatBytes(msg.attachment!.size)}
                                      </span>
                                    )}
                                  </span>
                                  <span className="shrink-0 text-sm" aria-hidden>⬇️</span>
                                </a>
                              );
                            })()}
                          </div>
                        )}

                        {msg.text && <div className="whitespace-pre-wrap break-words">{msg.text}</div>}
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
                          className={`flex min-h-11 items-center gap-1 rounded-full border px-2 text-xs cursor-pointer ${
                            myReactions.has(emoji)
                              ? "border-violet-500 bg-violet-500/15 text-foreground"
                              : "border-border bg-background/60 text-muted-foreground"
                          }`}
                        >
                          <span aria-hidden>{emoji}</span>
                          <span className="font-mono text-[10px]">{users.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={scrollBottomRef} />
        </div>
      </ScrollArea>

      {/* Typing indicator */}
      {typingLabel && (
        <div className="border-t border-border/50 px-4 py-1.5 text-[11px] text-muted-foreground italic" role="status">
          {typingLabel}
        </div>
      )}

      {/* Reply draft */}
      {replyDraft && (
        <div className="flex items-center gap-2 border-t border-border/80 bg-muted/30 px-3 py-2">
          <div className="min-w-0 flex-1 truncate rounded-lg border-l-2 border-violet-500 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
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
        <div className="flex items-center gap-2 border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground" role="status">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          {attachBusy}
        </div>
      )}

      {/* Chat Input pinned to bottom with safe-area padding */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-1.5 border-t border-border/80 p-2.5 sm:p-3 bg-muted/20 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label="Attach a photo"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void handleImageFile(f);
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          aria-label="Attach a file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void handleDocFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => setAttachOpen(true)}
          disabled={inputDisabled}
          aria-label="Attach photo or file"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border bg-background/80 text-lg cursor-pointer disabled:opacity-50"
        >
          📎
        </button>
        <button
          type="button"
          onClick={() => {
            if (pinDraft !== null) {
              setPinDraft(null);
            } else if (onCaptureMoment) {
              setPinDraft(Math.floor(onCaptureMoment()));
            }
          }}
          disabled={inputDisabled}
          aria-label={pinDraft !== null ? `Pinned to ${formatClock(pinDraft)}, tap to remove` : "Pin message to current video moment"}
          title={pinDraft !== null ? `Pinned to ${formatClock(pinDraft)}` : "Pin to current moment"}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-base cursor-pointer disabled:opacity-50 ${
            pinDraft !== null
              ? "border-violet-500 bg-violet-500/15"
              : "border-border bg-background/80"
          }`}
        >
          📌
        </button>
        <Input
          value={inputText}
          onChange={(e) => {
            setInputText(e.target.value);
            if (e.target.value.length > 0) onTyping?.();
          }}
          placeholder={disabledReason}
          disabled={inputDisabled}
          aria-label="Chat message"
          className="h-11 sm:h-11 bg-background/80 border-input text-sm text-foreground focus-visible:ring-violet-500 disabled:opacity-60 min-w-0 flex-1"
        />
        <VoiceRecorder
          disabled={inputDisabled}
          ptt={PTT_ENABLED}
          onSend={handleVoiceSend}
          onError={(m) => toast.error(m)}
        />
        <Button
          type="submit"
          size="sm"
          disabled={(!inputText.trim() && pinDraft === null) || inputDisabled}
          className="h-11 sm:h-11 px-4 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer shrink-0 disabled:opacity-50"
        >
          {isSending ? "…" : "Send"}
        </Button>
      </form>

      {/* Pin draft indicator */}
      {pinDraft !== null && (
        <div className="flex items-center gap-2 border-t border-violet-500/30 bg-violet-500/5 px-3 py-1.5 text-[11px] text-violet-700 dark:text-violet-300">
          <span>📌 Pinned to {formatClock(pinDraft)} — host taps jump the video</span>
          <button
            type="button"
            onClick={() => setPinDraft(null)}
            aria-label="Remove moment pin"
            className="flex h-11 w-11 items-center justify-center rounded-lg cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Attach bottom sheet */}
      {attachOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-label="Attach">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setAttachOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card p-4 pb-[max(env(safe-area-inset-bottom),1rem)] space-y-2">
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-4 text-sm text-foreground cursor-pointer"
            >
              <span aria-hidden>📷</span> Photo (compressed on-device)
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-4 text-sm text-foreground cursor-pointer"
            >
              <span aria-hidden>📎</span> File (up to {formatBytes(FILE_MAX_BYTES)})
            </button>
            <button
              type="button"
              onClick={() => setAttachOpen(false)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl text-sm text-muted-foreground cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Message action sheet (long-press menu) */}
      {menuMsg && (
        <div className="fixed inset-0 z-50" role="dialog" aria-label="Message actions">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuFor(null)}
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card p-4 pb-[max(env(safe-area-inset-bottom),1rem)] space-y-2">
            <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Quick reactions">
              {ALLOWED_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onReact?.(menuMsg.id, emoji);
                    setMenuFor(null);
                  }}
                  aria-label={`React ${emoji}`}
                  className="flex min-h-11 items-center justify-center rounded-xl border border-border text-xl cursor-pointer hover:bg-muted"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => openCopy(menuMsg)}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-4 text-sm text-foreground cursor-pointer"
            >
              <span aria-hidden>📋</span> Copy
            </button>
            <button
              type="button"
              onClick={() => {
                setReplyDraft({
                  id: menuMsg.id,
                  text: (menuMsg.text || "").slice(0, 140),
                  userName:
                    menuMsg.user.id === currentUserId ? "You" : menuMsg.user.name,
                });
                setMenuFor(null);
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-border px-4 text-sm text-foreground cursor-pointer"
            >
              <span aria-hidden>↩️</span> Reply
            </button>
            {(menuMsg.user.id === currentUserId || canDeleteAny) && (
              <button
                type="button"
                onClick={() => {
                  setMenuFor(null);
                  onDelete?.(menuMsg.id);
                }}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-red-500/30 px-4 text-sm text-red-500 cursor-pointer"
              >
                <span aria-hidden>🗑️</span> Delete
              </button>
            )}
            <button
              type="button"
              onClick={() => setMenuFor(null)}
              className="flex min-h-11 w-full items-center justify-center rounded-xl text-sm text-muted-foreground cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Image lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95 p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
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
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white"
              >
                ⬇️
              </a>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                aria-label="Close image"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white cursor-pointer"
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
        </div>
      )}
    </div>
  );
}
