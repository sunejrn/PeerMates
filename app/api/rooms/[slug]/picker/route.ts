import { NextRequest, NextResponse } from "next/server";
import { getRoomBySlug, changeRoomSource } from "@/lib/rooms/store";
import { getRole } from "@/lib/redis/roles";
import { getPresence } from "@/lib/redis/presence";
import { checkRateLimit, RATE_LIMITS } from "@/lib/redis/ratelimit";
import {
  addCandidate,
  listCandidates,
  getVotes,
  castVote,
  getPickerMeta,
  setPickerMeta,
  markHaveFile,
  getHaveFile,
} from "@/lib/redis/picker";
import { detectVideoSource, localFileSourceFor } from "@/lib/video/detector";
import { isValidFingerprint } from "@/lib/video/localfile";
import { broadcastRoomEvent } from "@/lib/stream/server";
import { resolveActorId, forbidden, rateLimited, errMessage } from "@/lib/rooms/actor";

type RouteParams = { params: Promise<{ slug: string }> };

async function persistCandidateNeon(
  slug: string,
  c: { id: string; title: string; kind: string; url?: string | null; fpId?: string | null; fingerprint?: unknown; addedBy: string; addedByName?: string }
): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const { db } = await import("@/db/drizzle");
    const { pickerCandidates } = await import("@/db/schema");
    await db.insert(pickerCandidates).values({
      id: c.id,
      roomSlug: slug,
      title: c.title,
      kind: c.kind,
      url: c.url ?? null,
      fpId: c.fpId ?? null,
      fingerprint: c.fingerprint ?? null,
      addedBy: c.addedBy,
      addedByName: c.addedByName ?? null,
    });
  } catch {
    // Neon mirror is best-effort; Redis stays live
  }
}

async function persistVoteNeon(
  slug: string,
  candidateId: string,
  voterId: string,
  voterName?: string
): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) return;
    const { db } = await import("@/db/drizzle");
    const { pickerVotes } = await import("@/db/schema");
    const { eq, and } = await import("drizzle-orm");
    // One vote per person: delete prior vote rows for this room+voter, then insert.
    try {
      await db
        .delete(pickerVotes)
        .where(and(eq(pickerVotes.roomSlug, slug), eq(pickerVotes.voterId, voterId)));
    } catch {
      // table may not exist yet — insert still attempted
    }
    await db.insert(pickerVotes).values({
      roomSlug: slug,
      candidateId,
      voterId,
      voterName: voterName ?? null,
    });
  } catch {
    // best-effort
  }
}

async function notify(slug: string): Promise<void> {
  try {
    await broadcastRoomEvent(slug, { type: "room_picker_changed" });
  } catch {
    // polling covers it
  }
}

/**
 * GET /api/rooms/[slug]/picker
 * Live vote counts (Upstash) + saved shortlist (Neon mirror best-effort).
 * Returns candidates with voteCount, voters, haveFile counts, meta.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const [candidates, votes, meta, presence] = await Promise.all([
      listCandidates(slug),
      getVotes(slug),
      getPickerMeta(slug),
      getPresence(slug).catch(() => []),
    ]);
    const memberCount = Math.max(presence.length, 1);
    // Tally
    const counts: Record<string, number> = {};
    const votersBy: Record<string, { id: string; name: string }[]> = {};
    const nameById = new Map(presence.map((m) => [m.id, m.name]));
    for (const [voterId, candId] of Object.entries(votes)) {
      counts[candId] = (counts[candId] ?? 0) + 1;
      (votersBy[candId] ??= []).push({
        id: voterId,
        name: nameById.get(voterId) ?? "Member",
      });
    }
    const enriched = await Promise.all(
      candidates.map(async (c) => {
        const have = c.kind === "file" ? await getHaveFile(slug, c.id) : [];
        const missing = c.kind === "file"
          ? presence.filter((m) => !have.includes(m.id)).map((m) => ({ id: m.id, name: m.name }))
          : [];
        return {
          ...c,
          voteCount: counts[c.id] ?? 0,
          voters: votersBy[c.id] ?? [],
          haveCount: have.length,
          haveIds: have,
          missing,
          readyText: `Ready for ${c.kind === "file" ? have.length : counts[c.id] ?? 0} of ${memberCount}`,
          playable: c.kind === "link" && c.url ? detectVideoSource(c.url).isValid : null,
        };
      })
    );
    enriched.sort((a, b) => b.voteCount - a.voteCount || a.createdAt - b.createdAt);
    return NextResponse.json({ candidates: enriched, meta, memberCount });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}

/**
 * POST /api/rooms/[slug]/picker  { action, ... }
 * - add: { title, url? | fingerprint } — any member
 * - vote: { candidateId } — one vote pp, changeable until close
 * - have: { candidateId, fingerprint? } — "I have this file"
 * - close: host/co-host only — winner becomes room source + countdown
 * - reopen: host/co-host only
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const room = await getRoomBySlug(slug);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const body = await req.json().catch(() => ({}));
    const { actorId } = await resolveActorId(req, body);
    if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = await checkRateLimit(
      `picker:${slug}:${actorId}`,
      RATE_LIMITS.picker.limit,
      RATE_LIMITS.picker.windowSeconds
    );
    if (!rl.allowed) return rateLimited(rl.retryAfter);

    const action = String(body?.action ?? "");
    const actorName =
      typeof body?.actorName === "string" ? body.actorName.slice(0, 60) : "Member";

    if (action === "add") {
      const meta = await getPickerMeta(slug);
      if (!meta.votingOpen) {
        return NextResponse.json({ error: "Voting is closed." }, { status: 400 });
      }
      const title = String(body?.title ?? "").trim().slice(0, 120) || "Untitled pick";
      const url = typeof body?.url === "string" ? body.url.trim().slice(0, 2000) : "";
      const fp = body?.fingerprint;
      if (fp && typeof fp === "object") {
        if (!isValidFingerprint(fp)) {
          return NextResponse.json({ error: "Invalid file fingerprint." }, { status: 400 });
        }
        const c = await addCandidate(slug, {
          title,
          kind: "file",
          fpId: fp.fpId,
          fingerprint: fp,
          url: null,
          addedBy: actorId,
          addedByName: actorName,
        });
        await markHaveFile(slug, c.id, actorId);
        await persistCandidateNeon(slug, { id: c.id, title: c.title, kind: "file", fpId: c.fpId, fingerprint: fp, addedBy: actorId, addedByName: actorName });
        await notify(slug);
        return NextResponse.json({ success: true, candidate: c });
      }
      if (!url) return NextResponse.json({ error: "Provide a link or a file." }, { status: 400 });
      const det = detectVideoSource(url);
      if (!det.isValid || !det.type) {
        return NextResponse.json({ error: "That link isn't playable (YouTube / HLS / MP4)." }, { status: 400 });
      }
      const c = await addCandidate(slug, {
        title,
        kind: "link",
        url: det.cleanUrl,
        addedBy: actorId,
        addedByName: actorName,
      });
      await persistCandidateNeon(slug, { id: c.id, title: c.title, kind: "link", url: det.cleanUrl, addedBy: actorId, addedByName: actorName });
      await notify(slug);
      return NextResponse.json({ success: true, candidate: c });
    }

    if (action === "vote") {
      const candidateId = String(body?.candidateId ?? "");
      if (!candidateId) return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
      const ok = await castVote(slug, actorId, candidateId);
      if (!ok) return NextResponse.json({ error: "Voting is closed." }, { status: 400 });
      await persistVoteNeon(slug, candidateId, actorId, actorName);
      await notify(slug);
      return NextResponse.json({ success: true });
    }

    if (action === "have") {
      const candidateId = String(body?.candidateId ?? "");
      if (!candidateId) return NextResponse.json({ error: "candidateId is required." }, { status: 400 });
      const fp = body?.fingerprint;
      if (fp && typeof fp === "object" && !isValidFingerprint(fp)) {
        return NextResponse.json({ error: "Invalid file fingerprint." }, { status: 400 });
      }
      await markHaveFile(slug, candidateId, actorId);
      await notify(slug);
      return NextResponse.json({ success: true });
    }

    if (action === "close" || action === "reopen") {
      const role = await getRole(slug, actorId, room.hostId);
      if (role !== "host" && role !== "cohost") return forbidden("Only hosts and co-hosts can close voting.");
      if (action === "reopen") {
        await setPickerMeta(slug, { votingOpen: true, winnerId: null, countdownAt: null });
        await notify(slug);
        return NextResponse.json({ success: true, votingOpen: true });
      }
      // close: tally + winner becomes room source + countdown lobby
      const [candidates, votes] = await Promise.all([listCandidates(slug), getVotes(slug)]);
      if (candidates.length === 0) {
        return NextResponse.json({ error: "Add at least one candidate first." }, { status: 400 });
      }
      const counts = new Map<string, number>();
      for (const cid of Object.values(votes)) counts.set(cid, (counts.get(cid) ?? 0) + 1);
      const sorted = [...candidates].sort(
        (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.createdAt - b.createdAt
      );
      const winner = sorted[0];
      const countdownAt = Date.now() + 10_000;
      await setPickerMeta(slug, { votingOpen: false, winnerId: winner.id, countdownAt });
      // Winner becomes the room source immediately (countdown is the lobby UI).
      if (winner.kind === "link" && winner.url) {
        const det = detectVideoSource(winner.url);
        if (det.isValid && det.type) {
          await changeRoomSource(slug, det.cleanUrl, det.type);
        }
      } else if (winner.kind === "file" && winner.fingerprint) {
        await changeRoomSource(
          slug,
          localFileSourceFor(winner.fpId ?? winner.fingerprint.fpId),
          "localfile",
          winner.fingerprint
        );
      }
      await notify(slug);
      try {
        await broadcastRoomEvent(slug, { type: "room_source_changed" });
      } catch {
        // polling covers it
      }
      return NextResponse.json({ success: true, winner, countdownAt });
    }

    return NextResponse.json({ error: 'action must be "add", "vote", "have", "close", or "reopen".' }, { status: 400 });
  } catch (error: unknown) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 });
  }
}
