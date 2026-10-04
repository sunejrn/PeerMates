/**
 * Simulated 500-viewer reaction burst for Party Replay capture.
 * Usage: node scripts/replay-burst.mjs <roomSlug> [count] [baseUrl]
 * Fires `count` reaction/message events from rotating fake viewers across
 * the runtime, then reports throughput + 429s. Room must exist.
 */
const slug = process.argv[2];
const count = Number(process.argv[3] || 500);
const base = (process.argv[4] || "http://localhost:3000").replace(/\/+$/, "");

if (!slug) {
  console.error("Usage: node scripts/replay-burst.mjs <roomSlug> [count] [baseUrl]");
  process.exit(1);
}

const EMOJIS = ["😂", "❤️", "👍", "😮", "🔥", "👏", "😢", "🙏"];
const rand = (n) => Math.floor(Math.random() * n);

async function fire(i) {
  const actorId = `burst_${String(i % 500).padStart(3, "0")}`;
  const isReaction = Math.random() < 0.75;
  const body = isReaction
    ? {
        type: "reaction",
        videoTime: Math.floor(Math.random() * 3600),
        payload: { emoji: EMOJIS[rand(EMOJIS.length)] },
        actorId,
        userName: `Fan${i % 500}`,
        ts: Date.now(),
      }
    : {
        type: "message",
        videoTime: Math.floor(Math.random() * 3600),
        messageId: `burst-msg-${i}`,
        payload: { text: `burst message ${i}`, messageId: `burst-msg-${i}` },
        actorId,
        userName: `Fan${i % 500}`,
        ts: Date.now(),
      };
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/rooms/${slug}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0 };
  }
}

(async () => {
  const t0 = Date.now();
  const results = [];
  // 25-wide concurrency: bursty like a real laugh spike, not a DDoS.
  for (let i = 0; i < count; i += 25) {
    const batch = [];
    for (let j = i; j < Math.min(i + 25, count); j++) batch.push(fire(j));
    results.push(...(await Promise.all(batch)));
  }
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const ok = results.filter((r) => r.ok).length;
  const limited = results.filter((r) => r.status === 429).length;
  const p95 = ms[Math.floor(ms.length * 0.95)] ?? 0;
  console.log(`burst: ${count} events in ${Date.now() - t0}ms`);
  console.log(`accepted: ${ok}/${count}, rate-limited(429): ${limited}, p95: ${p95}ms`);
  process.exit(ok === 0 ? 1 : 0);
})();
