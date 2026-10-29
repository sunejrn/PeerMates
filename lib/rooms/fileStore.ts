import { sql } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { isValidFingerprint, type LocalFingerprint } from "@/lib/video/localfile";

/**
 * Durable "My Files" fingerprint storage.
 *
 * Redis stays the fast path, but a small Postgres table means a host's file
 * identity survives Redis expiry/restarts, so the room does not ask the host
 * to pick the same movie again. Only the tiny fingerprint is stored — video
 * bytes always stay on the user's device.
 *
 * The table is created lazily with IF NOT EXISTS so existing deployments keep
 * working without a manual migration step. Failures are non-fatal: callers
 * still have Redis + in-memory fallbacks.
 */

let tableReady: Promise<boolean> | null = null;

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function ensureTable(): Promise<boolean> {
  if (tableReady) return tableReady;
  tableReady = (async () => {
    if (!process.env.DATABASE_URL) return false;
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS room_files (
          slug text PRIMARY KEY,
          fingerprint jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      return true;
    } catch (err) {
      console.warn("room_files table unavailable, using Redis only:", err);
      tableReady = null;
      return false;
    }
  })();
  return tableReady;
}

export async function saveRoomFileFingerprint(
  slug: string,
  fingerprint: LocalFingerprint
): Promise<void> {
  try {
    if (!slug || !isValidFingerprint(fingerprint)) return;
    if (!(await ensureTable())) return;
    await db.execute(sql`
      INSERT INTO room_files (slug, fingerprint, updated_at)
      VALUES (${slug}, ${JSON.stringify(fingerprint)}::jsonb, now())
      ON CONFLICT (slug)
      DO UPDATE SET fingerprint = EXCLUDED.fingerprint, updated_at = now()
    `);
  } catch (err) {
    console.warn("Could not persist room file fingerprint:", err);
  }
}

export async function getRoomFileFingerprint(
  slug: string
): Promise<LocalFingerprint | null> {
  try {
    if (!slug) return null;
    if (!(await ensureTable())) return null;
    const result = await db.execute(sql`
      SELECT fingerprint FROM room_files WHERE slug = ${slug} LIMIT 1
    `);
    const row = rowsOf(result)[0];
    const raw = row?.fingerprint;
    const parsed =
      typeof raw === "string"
        ? JSON.parse(raw)
        : (raw as LocalFingerprint | null);
    return isValidFingerprint(parsed) ? parsed : null;
  } catch (err) {
    console.warn("Could not read room file fingerprint:", err);
    return null;
  }
}
