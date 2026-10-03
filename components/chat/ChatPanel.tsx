"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "@/lib/stream/realtimeClient";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ChatPanelProps {
  messages: ChatMessage[];
  currentUserId: string;
  onSendMessage: (text: string) => Promise<boolean> | boolean | void;
  slowModeSeconds?: number;
  chatMuted?: boolean;
  userMuted?: boolean;
  isPrivileged?: boolean;
}

export function ChatPanel({
  messages,
  currentUserId,
  onSendMessage,
  slowModeSeconds = 0,
  chatMuted = false,
  userMuted = false,
  isPrivileged = false,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const scrollBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const viewersMuted = chatMuted && !isPrivileged;
  const inputDisabled = userMuted || viewersMuted || isSending;
  const disabledReason = userMuted
    ? "You are muted in this room"
    : viewersMuted
      ? "Chat is muted for viewers"
      : "Type a message...";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || inputDisabled) return;
    try {
      setIsSending(true);
      const ok = await onSendMessage(inputText);
      if (ok !== false) setInputText("");
    } finally {
      setIsSending(false);
    }
  };

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

              return (
                <div
                  key={msg.id}
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
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                      isMe
                        ? "bg-linear-to-r from-violet-600 to-indigo-600 text-white rounded-tr-xs shadow-sm shadow-violet-500/10"
                        : "bg-muted text-foreground border border-border/70 rounded-tl-xs"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={scrollBottomRef} />
        </div>
      </ScrollArea>

      {/* Chat Input pinned to bottom with safe-area padding */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-border/80 p-2.5 sm:p-3 bg-muted/20 pb-[max(env(safe-area-inset-bottom),0.75rem)]"
      >
        <Input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={disabledReason}
          disabled={inputDisabled}
          aria-label="Chat message"
          className="h-11 sm:h-11 bg-background/80 border-input text-sm text-foreground focus-visible:ring-violet-500 disabled:opacity-60"
        />
        <Button
          type="submit"
          size="sm"
          disabled={!inputText.trim() || inputDisabled}
          className="h-11 sm:h-11 px-4 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold cursor-pointer shrink-0 disabled:opacity-50"
        >
          {isSending ? "…" : "Send"}
        </Button>
      </form>
    </div>
  );
}
