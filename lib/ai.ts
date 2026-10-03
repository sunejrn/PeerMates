/**
 * Provider-agnostic AI module — the ONLY place that talks to an LLM.
 * SERVER-ONLY: import exclusively from API routes / server code. Never
 * import from client components — API keys live here and must never ship
 * to the browser.
 *
 * Feature code (translation, recap, …) calls `generate(prompt)` and never
 * touches provider SDKs, URLs, or keys.
 *
 * Providers (swappable via env, no feature-code changes):
 *   AI_PROVIDER=gemini     Google Gemini free tier (default, Flash-Lite)
 *   AI_PROVIDER=openrouter  OpenRouter (any model, key in OPENROUTER_API_KEY)
 *   AI_PROVIDER=claude      Anthropic Claude directly (key in CLAUDE_API_KEY)
 *
 * Fallback: when the primary provider reports quota/credit exhaustion
 * (429 / 402 / "insufficient credits") and a Gemini key is configured, the
 * call is retried once against Gemini free tier so the feature degrades
 * instead of dying. Keys never leave the server (server-only module).
 */

export type AIProvider = "gemini" | "openrouter" | "claude";

export class AIQuotaError extends Error {
  readonly retryable = true;
  constructor(message = "Translation is busy, try again later") {
    super(message);
    this.name = "AIQuotaError";
  }
}

export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIError";
  }
}

function primaryProvider(): AIProvider {
  const raw = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  if (raw === "openrouter" || raw === "claude" || raw === "gemini") return raw;
  return "gemini";
}

function geminiModel(): string {
  return process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";
}

function openRouterModel(): string {
  return process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-lite-001";
}

function claudeModel(): string {
  return process.env.CLAUDE_MODEL || "claude-3-5-haiku-20241022";
}

function isQuotaLike(status: number, bodyText: string): boolean {
  if (status === 429 || status === 402 || status === 503) return true;
  const t = bodyText.toLowerCase();
  return (
    t.includes("insufficient") ||
    t.includes("quota") ||
    t.includes("rate limit") ||
    t.includes("credit") ||
    t.includes("overloaded") ||
    t.includes("resource_exhausted")
  );
}

async function readBodyText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function callGemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AIError("Gemini is not configured (missing GEMINI_API_KEY).");
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(geminiModel())}:generateContent?key=${encodeURIComponent(key)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
    });
  } catch (err) {
    throw new AIError(`Gemini request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const raw = await readBodyText(res);
  if (!res.ok) {
    if (isQuotaLike(res.status, raw)) throw new AIQuotaError();
    throw new AIError(`Gemini error (${res.status}).`);
  }
  try {
    const data = JSON.parse(raw) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim();
    if (!text) throw new AIError("Gemini returned an empty response.");
    return text;
  } catch (err) {
    if (err instanceof AIError) throw err;
    throw new AIError("Gemini returned an unreadable response.");
  }
}

async function callOpenRouter(prompt: string): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AIError("OpenRouter is not configured (missing OPENROUTER_API_KEY).");
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": process.env.BETTER_AUTH_URL || "http://localhost:3000",
        "X-Title": "SyncMe",
      },
      body: JSON.stringify({
        model: openRouterModel(),
        temperature: 0.2,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You always reply with valid JSON only. No markdown fences, no commentary.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
  } catch (err) {
    throw new AIError(`OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const raw = await readBodyText(res);
  if (!res.ok) {
    if (isQuotaLike(res.status, raw)) {
      const e = new AIQuotaError();
      (e as unknown as { quotaLike: boolean }).quotaLike = true;
      throw e;
    }
    throw new AIError(`OpenRouter error (${res.status}).`);
  }
  try {
    const data = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = (data.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new AIError("OpenRouter returned an empty response.");
    return text;
  } catch (err) {
    if (err instanceof AIError) throw err;
    throw new AIError("OpenRouter returned an unreadable response.");
  }
}

async function callClaude(prompt: string): Promise<string> {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new AIError("Claude is not configured (missing CLAUDE_API_KEY).");
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: claudeModel(),
        max_tokens: 8000,
        temperature: 0.2,
        system: "You always reply with valid JSON only. No markdown fences, no commentary.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    throw new AIError(`Claude request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const raw = await readBodyText(res);
  if (!res.ok) {
    if (isQuotaLike(res.status, raw)) throw new AIQuotaError();
    throw new AIError(`Claude error (${res.status}).`);
  }
  try {
    const data = JSON.parse(raw) as {
      content?: { type?: string; text?: string }[];
    };
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text || "")
      .join("")
      .trim();
    if (!text) throw new AIError("Claude returned an empty response.");
    return text;
  } catch (err) {
    if (err instanceof AIError) throw err;
    throw new AIError("Claude returned an unreadable response.");
  }
}

/**
 * Generate text with the configured provider. Always returns the raw model
 * text (callers parse JSON). Throws AIQuotaError when the free quota is hit
 * ("Translation is busy, try again later" at the UI layer) — callers keep
 * the original subtitles playing in that case.
 *
 * Automatic fallback: OpenRouter/Claude quota-or-credit failures retry once
 * on Gemini free tier when GEMINI_API_KEY is set.
 */
export async function generate(prompt: string): Promise<string> {
  const provider = primaryProvider();
  try {
    if (provider === "openrouter") return await callOpenRouter(prompt);
    if (provider === "claude") return await callClaude(prompt);
    return await callGemini(prompt);
  } catch (err) {
    const quotaLike =
      err instanceof AIQuotaError ||
      (err instanceof AIError && provider !== "gemini");
    // Only fall back on quota/credit-class failures, and only to Gemini.
    if (
      provider !== "gemini" &&
      err instanceof AIQuotaError &&
      process.env.GEMINI_API_KEY
    ) {
      console.warn(`[ai] ${provider} quota hit — falling back to Gemini free tier.`);
      return await callGemini(prompt);
    }
    if (quotaLike && err instanceof AIQuotaError) throw err;
    throw err;
  }
}

/** Which provider will serve generate() right now (for logs, never keys). */
export function activeProvider(): AIProvider {
  return primaryProvider();
}
