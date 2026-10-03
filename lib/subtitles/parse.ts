/**
 * Subtitle parsing + serialization. Import-safe for server routes and the
 * browser (no DOM, no Node APIs) — the upload panel parses locally so only
 * clean VTT text is ever posted.
 */

export interface SubCue {
  start: number;
  end: number;
  text: string;
}

const MAX_CUES = 5000;
const MAX_TEXT_LEN = 500;

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return (
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
  );
}

function fmtTime(total: number): string {
  const t = Math.max(0, total);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t - Math.floor(t)) * 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

function cleanText(raw: string): string {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^NOTE\b/.test(l))
    .join("\n")
    .replace(/<[^>]*>/g, "")
    .slice(0, MAX_TEXT_LEN);
}

function parseBlocks(body: string, sep: RegExp): SubCue[] {
  const cues: SubCue[] = [];
  for (const block of body.split(sep)) {
    const lines = block
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l, i, arr) => l.trim() !== "" || (i > 0 && arr[i - 1].trim() !== ""));
    if (lines.length === 0) continue;
    // Optional numeric index (SRT) or cue id (VTT) on the first line.
    let cursor = 0;
    if (!lines[0].includes("-->")) cursor = 1;
    if (cursor >= lines.length) continue;
    const m = lines[cursor].match(
      /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!m) continue;
    const start = toSeconds(m[1], m[2], m[3], m[4]);
    const end = toSeconds(m[5], m[6], m[7], m[8]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const text = cleanText(lines.slice(cursor + 1).join("\n"));
    if (!text) continue;
    cues.push({ start, end, text });
    if (cues.length >= MAX_CUES) break;
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** Parse .srt or .vtt file text into cues. Throws on garbage. */
export function parseSubtitleFile(text: string, fileName: string): SubCue[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  if (!normalized.trim()) throw new Error("That subtitle file is empty.");
  const lower = fileName.toLowerCase();
  const isSrt = lower.endsWith(".srt");
  const isVtt = lower.endsWith(".vtt");
  if (!isSrt && !isVtt) throw new Error("Upload a .srt or .vtt file.");
  const body = isVtt ? normalized.replace(/^WEBVTT[^\n]*\n/, "") : normalized;
  const cues = parseBlocks(body, /\n{2,}/);
  if (cues.length === 0) throw new Error("No usable cues found in that file.");
  return cues;
}

/** Serialize cues to WebVTT for the <track> element. */
export function cuesToVtt(cues: SubCue[]): string {
  const out = ["WEBVTT", ""];
  for (const c of cues) {
    out.push(`${fmtTime(c.start)} --> ${fmtTime(c.end)}`, c.text, "");
  }
  return out.join("\n");
}

/** Parse VTT text back to cues (for translation chunking server-side). */
export function vttToCues(vtt: string): SubCue[] {
  const body = vtt.replace(/\r\n?/g, "\n").replace(/^WEBVTT[^\n]*\n/, "");
  return parseBlocks(body, /\n{2,}/);
}

/** Cue text only, up to a playback timestamp — the recap input. */
export function cuesTextUpTo(cues: SubCue[], currentTime: number, maxChars = 4000): string {
  const parts: string[] = [];
  let chars = 0;
  for (const c of cues) {
    if (c.start > currentTime) break;
    const line = c.text.replace(/\n/g, " ").trim();
    if (!line) continue;
    if (chars + line.length + 1 > maxChars) break;
    parts.push(line);
    chars += line.length + 1;
  }
  return parts.join("\n");
}
