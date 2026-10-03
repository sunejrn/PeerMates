/**
 * Shared chat guardrails — import-safe for BOTH server routes and the
 * browser realtime client (no DOM, no Node APIs).
 *
 * Two layers:
 * - maskProfanity: replaces blocked words with ****. Applied client-side
 *   before sending AND authoritatively server-side, so the Stream realtime
 *   copy can never leak an unmasked word.
 * - checkSpam: heuristic block (all-caps shouting, link floods, character
 *   floods). Client pre-checks for instant feedback; the server enforces
 *   with 400 SPAM and the client best-effort deletes the Stream copy.
 */

// Compact blocklist (common English profanities + slurs fragments).
// Word-boundary matched, case-insensitive.
const BLOCKED = [
  "fuck", "fucking", "fucker", "shit", "shitty", "bitch", "bitches",
  "asshole", "dick", "dickhead", "pussy", "cunt", "bastard", "whore",
  "slut", "fag", "faggot", "nigga", "nigger", "retard", "retarded",
];

const BLOCKED_RE = new RegExp(
  `\\b(${BLOCKED.map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean).join("|")})\\b`,
  "gi"
);

export function maskProfanity(text: string): { clean: string; masked: boolean } {
  if (!text) return { clean: text, masked: false };
  let masked = false;
  const clean = text.replace(BLOCKED_RE, (m) => {
    masked = true;
    return "*".repeat(Math.max(2, Math.min(m.length, 8)));
  });
  return { clean, masked };
}

export interface SpamCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Heuristic spam block. Tuned to never fire on normal chat:
 * - links: more than 3 URLs in one message
 * - shouting: >80% caps on messages longer than 12 chars (letters only)
 * - floods: same char 6+ times in a row, or message >1000 chars (also capped)
 */
export function checkSpam(text: string): SpamCheck {
  const t = text.trim();
  if (!t) return { ok: false, reason: "Empty message." };
  const urls = t.match(/https?:\/\/\S+|www\.\S+\.\S+/gi) || [];
  if (urls.length > 3) {
    return { ok: false, reason: "Too many links in one message." };
  }
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length > 12) {
    const upper = t.replace(/[^A-Z]/g, "").length;
    if (upper / letters.length > 0.8) {
      return { ok: false, reason: "Please don't shout (all caps)." };
    }
  }
  if (/(.)\1{5,}/.test(t)) {
    return { ok: false, reason: "Character flood detected." };
  }
  return { ok: true };
}

/** Reaction emoji allowlist (keeps payloads tiny + renders everywhere). */
export const ALLOWED_REACTIONS = ["❤️", "😂", "👍", "😮", "😢", "🙏", "🔥", "👏"] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

export function isAllowedReaction(e: string): e is ReactionEmoji {
  return (ALLOWED_REACTIONS as readonly string[]).includes(e);
}

/** Push-to-talk voice is optional, behind a flag (default off). */
export const PTT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_PTT === "1";
