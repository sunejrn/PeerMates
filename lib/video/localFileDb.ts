/**
 * Browser-side persistence for "My Files" picks (IndexedDB).
 *
 * Browsers cannot keep a `<input type="file">` selection across a navigation
 * or an OAuth sign-in redirect. Storing the picked file in IndexedDB lets the
 * same device re-open the room (or finish creating it after sign-in) without
 * asking the host to pick the same file again.
 *
 * Media bytes never leave the device — IndexedDB is local storage, not an
 * upload. Quota/permission failures are non-fatal: the room still works, the
 * user just picks the file again.
 */

import type { LocalFingerprint } from "@/lib/video/localfile";

const DB_NAME = "peermates-local-files";
const STORE = "files";
const VERSION = 1;

export const PENDING_CREATE_FILE_KEY = "pending-create";

export function roomFileKey(slug: string): string {
  return `room:${slug}`;
}

export function fpFileKey(fpId: string): string {
  return `fp:${fpId}`;
}

export interface StoredLocalFile {
  key: string;
  file: File;
  fpId: string;
  savedAt: number;
}

interface StoredRecord {
  key: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
  fpId: string;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function runRequest<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (database) =>
      new Promise<T | null>((resolve) => {
        if (!database) {
          resolve(null);
          return;
        }
        try {
          const tx = database.transaction(STORE, mode);
          const request = action(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

/** Persist a picked file under a key (room slug, fingerprint id, pending). */
export async function saveLocalFile(
  key: string,
  file: File,
  fpId: string
): Promise<boolean> {
  const record: StoredRecord = {
    key,
    blob: file,
    name: file.name,
    type: file.type || "",
    lastModified: file.lastModified || Date.now(),
    fpId,
    savedAt: Date.now(),
  };
  try {
    await runRequest("readwrite", (store) => store.put(record));
    return true;
  } catch {
    return false;
  }
}

/** Load a previously picked file, preserving its name/type/lastModified. */
export async function loadLocalFileRecord(
  key: string
): Promise<StoredLocalFile | null> {
  const record = await runRequest<StoredRecord | undefined>(
    "readonly",
    (store) => store.get(key)
  );
  if (!record || !record.blob || typeof record.fpId !== "string") return null;
  const file = new File([record.blob], record.name, {
    type: record.type,
    lastModified: record.lastModified,
  });
  return { key: record.key, file, fpId: record.fpId, savedAt: record.savedAt };
}

export async function deleteLocalFile(key: string): Promise<void> {
  try {
    await runRequest("readwrite", (store) => store.delete(key));
  } catch {
    // best-effort
  }
}

const FP_CACHE_PREFIX = "peermates:hostfp:v1:";

function fpCacheKey(slug: string): string {
  return `${FP_CACHE_PREFIX}${slug}`;
}

/** Mirror the tiny host fingerprint locally so the room can render its file
 *  info instantly while the network refresh happens in the background. */
export function saveRoomFingerprintCache(
  slug: string,
  fp: LocalFingerprint
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(fpCacheKey(slug), JSON.stringify(fp));
  } catch {
    // storage blocked/full — the server copy still works
  }
}

export function readRoomFingerprintCache(
  slug: string
): LocalFingerprint | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(fpCacheKey(slug));
    if (!raw) return null;
    const fp = JSON.parse(raw) as LocalFingerprint;
    if (!fp || fp.v !== 1 || typeof fp.fpId !== "string") return null;
    return fp;
  } catch {
    return null;
  }
}

export function clearRoomFingerprintCache(slug: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(fpCacheKey(slug));
  } catch {
    // best-effort
  }
}
