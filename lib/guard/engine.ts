/**
 * Chat Guard engine client — SERVER ONLY (imports nothing client-safe and
 * must only be called from route handlers). Calls the Python sidecar
 * (api/chatguard.py, same Vercel project) with a short timeout and FAILS
 * OPEN: slow, unreachable, or erroring engine => allow the message.
 * Chat must never block on the guard.
 */

export type GuardAction = "allow" | "hide" | "block";

export interface GuardVerdict {
  score: number;
  action: GuardAction;
  reasons: string[];
  /** True when the engine wasn't reached (fail-open), for observability. */
  failOpen?: boolean;
}

export interface GuardContextMessage {
  text: string;
  secondsAgo: number;
}

const ALLOW: GuardVerdict = { score: 0, action: "allow", reasons: [] };

function engineUrl(): string | null {
  // Same-project function: absolute URL required for server-side fetch.
  const base =
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "") ||
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");
  return base ? `${base}/api/chatguard` : null;
}

export async function checkChatGuard(opts: {
  text: string;
  senderId: string;
  sensitivity: "low" | "medium" | "high";
  recent: GuardContextMessage[];
  slowModeSeconds: number;
  timeoutMs?: number;
}): Promise<GuardVerdict> {
  const url = engineUrl();
  if (!url) return { ...ALLOW, failOpen: true };
  const text = (opts.text || "").slice(0, 1000);
  if (!text.trim()) return ALLOW;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        senderId: opts.senderId,
        sensitivity: opts.sensitivity,
        context: {
          recentMessagesFromSender: opts.recent.slice(0, 5),
          roomSlowModeSeconds: opts.slowModeSeconds,
        },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 800),
    });
    if (!res.ok) return { ...ALLOW, failOpen: true };
    const data = await res.json().catch(() => null);
    const action: GuardAction =
      data?.action === "hide" || data?.action === "block" ? data.action : "allow";
    const score = typeof data?.score === "number" ? Math.max(0, Math.min(100, data.score)) : 0;
    const reasons = Array.isArray(data?.reasons)
      ? data.reasons.filter((r: unknown): r is string => typeof r === "string").slice(0, 6)
      : [];
    return { score, action, reasons };
  } catch {
    return { ...ALLOW, failOpen: true };
  }
}
