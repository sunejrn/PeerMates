export interface EmojiCategory {
  id: string;
  label: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys & People",
    emojis: [
      "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "🥰", "😎", "🤔",
      "😅", "😭", "😡", "🥳", "😴", "🤯", "🥺", "😇", "🙂", "🙃",
      "😉", "😌", "😜", "🤪", "😝", "🤑", "🤠", "🥸", "😷", "🤒",
      "🤕", "🤢", "🤮", "🥴", "😵", "🤐", "🤨", "😐", "😑", "😬",
      "🙄", "😯", "😦", "😧", "😮", "😲", "🥱", "😪", "😫", "🥵",
      "🥶", "😳", "🤗", "🤭", "🫡", "🫣", "🫠", "🫢", "🫶", "👋",
    ],
  },
  {
    id: "gestures",
    label: "Gestures & Hands",
    emojis: [
      "👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "👏", "🙌", "🙏",
      "💪", "🫀", "👋", "🤚", "🖐️", "✋", "🖖", "👋", "💅", "🤝",
      "👊", "✊", "🤛", "🤜", "👆", "👇", "👉", "👈", "🖕", "🫵",
    ],
  },
  {
    id: "hearts",
    label: "Hearts & Love",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💟", "♥️",
      "💋", "💌", "💐", "🌹", "🌷", "🌸", "💒", "💍", "👩‍❤️‍👨", "💑",
    ],
  },
  {
    id: "animals",
    label: "Animals & Nature",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
      "🦁", "🐮", "🐷", "🐸", "🐵", "🙈", "🙉", "🙊", "🐒", "🐔",
      "🐧", "🐦", "🐤", "🦄", "🐝", "🦋", "🐌", "🐞", "🌳", "🌲",
      "🌵", "🌷", "🌹", "🌻", "🌙", "⭐", "🔥", "💧", "❄️", "⚡",
    ],
  },
  {
    id: "food",
    label: "Food & Drink",
    emojis: [
      "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍒", "🍑",
      "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🍔", "🍟", "🍕", "🌭",
      "🍿", "🍩", "🍪", "🎂", "🍰", "🍫", "🍦", "🍺", "🍷", "☕",
      "🧋", "🥤", "🍾", "🌮", "🌯", "🥗", "🍜", "🍣", "🍤", "🥘",
    ],
  },
  {
    id: "activity",
    label: "Activity & Sports",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🏉", "🎱", "🏓", "🏸",
      "🥊", "⛷️", "🎿", "🏋️", "🚴", "🏊", "🎮", "🎲", "🎯", "🎳",
      "🎸", "🎤", "🎧", "🎬", "🎨", "🎭", "🎪", "🎡", "🎢", "✈️",
      "🚗", "🚀", "⛵", "🏝️", "⛺", "🎁", "🎊", "🎉", "🏆", "🥇",
    ],
  },
  {
    id: "objects",
    label: "Objects",
    emojis: [
      "💡", "🔦", "📱", "💻", "⌨️", "🖥️", "🖨️", "📷", "🎥", "📺",
      "📻", "⏰", "⌚", "💰", "💎", "🔑", "🔨", "🧰", "📦", "✉️",
      "📝", "📚", "🔖", "📌", "📎", "✂️", "📏", "🔬", "🔭", "🧪",
    ],
  },
  {
    id: "symbols",
    label: "Symbols & Flags",
    emojis: [
      "❤️", "💯", "✅", "❌", "⚠️", "🚫", "💤", "💢", "💥", "💫",
      "🌀", "🔔", "🔕", "🎵", "🎶", "🔀", "▶️", "⏸️", "🔁", "➡️",
      "⬆️", "⬇️", "©️", "®️", "™️", "0️⃣", "1️⃣", "🔟", "🏁", "🚩",
      "🇺🇸", "🇬🇧", "🇳🇬", "🇬🇭", "🇰🇪", "🇿🇦", "🇨🇦", "🇦🇺", "🇩🇪", "🇫🇷",
    ],
  },
];

export const STICKER_SET: string[] = [
  "😂", "😍", "🥳", "😎", "🤯", "🥺", "😭", "🤣",
  "👍", "👏", "🙌", "🔥", "💯", "❤️", "🎉", "👑",
  "🐶", "🐱", "🦄", "🐸", "🍕", "⚽", "🚀", "💪",
];

export const ALL_EMOJIS: string[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

const RECENT_KEY = "peermates_recent_emoji";

export function getRecentEmojis(limit = 12): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((e) => typeof e === "string").slice(0, limit)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(emoji: string): void {
  try {
    const current = getRecentEmojis(30).filter((e) => e !== emoji);
    localStorage.setItem(RECENT_KEY, JSON.stringify([emoji, ...current].slice(0, 30)));
  } catch {
    // private mode — ignore
  }
}
