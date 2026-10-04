"use client";

import { useMemo, useState } from "react";
import { Clock, Smile, Hand, Heart, Dog, Pizza, Trophy, Lightbulb, Flag, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  EMOJI_CATEGORIES,
  STICKER_SET,
  ALL_EMOJIS,
  getRecentEmojis,
  pushRecentEmoji,
} from "./emojiData";

type Tab = "emoji" | "gif" | "stickers";

const CATEGORY_ICONS = [Clock, Smile, Hand, Heart, Dog, Pizza, Trophy, Lightbulb, Flag] as const;

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onSendSticker: (emoji: string) => void;
  initialTab?: Tab;
}

export function EmojiPicker({ onPick, onSendSticker, initialTab = "emoji" }: EmojiPickerProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("smileys");
  const [recent, setRecent] = useState<string[]>(() => getRecentEmojis());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    // Match whole categories by label (e.g. "heart", "food", "flag"),
    // otherwise fall back to the full set so every query shows results.
    const matched = EMOJI_CATEGORIES.filter((c) =>
      c.label.toLowerCase().includes(q)
    );
    const pool = matched.length > 0 ? matched.flatMap((c) => c.emojis) : ALL_EMOJIS;
    return Array.from(new Set(pool)).slice(0, 120);
  }, [query]);

  const handlePick = (emoji: string) => {
    pushRecentEmoji(emoji);
    setRecent(getRecentEmojis());
    onPick(emoji);
  };

  const handleSticker = (emoji: string) => {
    pushRecentEmoji(emoji);
    setRecent(getRecentEmojis());
    onSendSticker(emoji);
  };

  return (
    <div
      className="absolute inset-x-0 bottom-full z-30 mb-2 flex max-h-80 min-h-64 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground"
      role="dialog"
      aria-label="Emoji picker"
    >
      {/* Category tabs */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 pt-2">
        {tab === "emoji" &&
          EMOJI_CATEGORIES.map((cat, i) => {
            const Icon = CATEGORY_ICONS[i % CATEGORY_ICONS.length];
            const active = activeCat === cat.id && !query;
            return (
              <button
                key={cat.id}
                type="button"
                title={cat.label}
                aria-label={cat.label}
                onClick={() => {
                  setActiveCat(cat.id);
                  setQuery("");
                  document
                    .getElementById(`emoji-cat-${cat.id}`)
                    ?.scrollIntoView({ block: "start" });
                }}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg cursor-pointer ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4.5 w-4.5" size={18} />
                {active && (
                  <span className="absolute mt-7 h-0.5 w-6 rounded-lg bg-foreground" aria-hidden />
                )}
              </button>
            );
          })}
        {(tab === "gif" || tab === "stickers") && (
          <p className="px-2 py-2 text-xs font-medium text-muted-foreground">
            {tab === "gif" ? "GIFs" : "Stickers"} — tap to send instantly
          </p>
        )}
      </div>

      {/* Search */}
      <div className="border-b border-border p-2">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "emoji" ? "Search emoji" : "Search"}
            aria-label="Search emoji"
            className="h-10 rounded-lg bg-muted pl-9 text-sm"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === "stickers" ? (
          <div>
            <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Stickers</p>
            <div className="grid grid-cols-4 gap-1.5">
              {STICKER_SET.filter((e) => !query || e.includes(query)).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => handleSticker(e)}
                  aria-label={`Send sticker ${e}`}
                  className="flex min-h-16 items-center justify-center rounded-lg border border-border text-3xl cursor-pointer hover:bg-muted"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : tab === "gif" ? (
          <div>
            <div className="rounded-lg border border-border bg-muted px-3 py-2 text-[11px] text-muted-foreground">
              GIF provider is not connected yet — showing quick reactions. Tap any
              reaction to send it instantly.
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {STICKER_SET.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => handleSticker(e)}
                  aria-label={`Send reaction ${e}`}
                  className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border border-border cursor-pointer hover:bg-muted"
                >
                  <span className="text-3xl">{e}</span>
                  <span className="text-[9px] font-mono uppercase text-muted-foreground">GIF</span>
                </button>
              ))}
            </div>
          </div>
        ) : filtered ? (
          <div>
            <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">Results</p>
            <div className="grid grid-cols-8 gap-0.5">
              {filtered.map((e, i) => (
                <button
                  key={`${e}-${i}`}
                  type="button"
                  onClick={() => handlePick(e)}
                  aria-label={`Insert ${e}`}
                  className="flex h-10 items-center justify-center rounded-lg text-xl cursor-pointer hover:bg-muted"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {recent.length > 0 && (
              <div id="emoji-cat-recent">
                <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Recent</p>
                <div className="grid grid-cols-8 gap-0.5">
                  {recent.map((e) => (
                    <button
                      key={`recent-${e}`}
                      type="button"
                      onClick={() => handlePick(e)}
                      aria-label={`Insert ${e}`}
                      className="flex h-10 items-center justify-center rounded-lg text-xl cursor-pointer hover:bg-muted"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {EMOJI_CATEGORIES.map((cat) => (
              <div key={cat.id} id={`emoji-cat-${cat.id}`}>
                <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">{cat.label}</p>
                <div className="grid grid-cols-8 gap-0.5">
                  {cat.emojis.map((e, i) => (
                    <button
                      key={`${cat.id}-${i}`}
                      type="button"
                      onClick={() => handlePick(e)}
                      aria-label={`Insert ${e}`}
                      className="flex h-10 items-center justify-center rounded-lg text-xl cursor-pointer hover:bg-muted"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom tabs: Emoji / GIF / Stickers */}
      <div className="flex items-center justify-center gap-0 border-t border-border p-1.5">
        <div className="flex w-full max-w-64 items-center rounded-lg border border-border">
          {(["emoji", "gif", "stickers"] as Tab[]).map((t, i) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setQuery("");
              }}
              aria-pressed={tab === t}
              className={`h-10 flex-1 text-xs font-medium cursor-pointer ${
                i > 0 ? "border-l border-border" : ""
              } ${tab === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"} ${
                i === 0 ? "rounded-l-lg" : ""
              } ${i === 2 ? "rounded-r-lg" : ""}`}
            >
              {t === "emoji" ? "Emoji" : t === "gif" ? "GIF" : "Stickers"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
