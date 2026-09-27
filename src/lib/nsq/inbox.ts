/**
 * The `.nsq` inbox — a received file, preserved until it can be opened.
 *
 * When a visitor opens an `.nsq` before signing in, the file is validated and
 * then kept here (the raw bytes, in a dedicated IndexedDB database) so the
 * sign-in round trip — including a full-page OAuth redirect — can never lose
 * it. The inbox is deliberately NOT owner-scoped like the project library:
 * the file belongs to whoever is at this browser, and it moves into the
 * signed-in account's library the moment they authenticate.
 *
 * Falls back to memory when IndexedDB is unavailable (the popup sign-in used
 * in the live preview never reloads the page, so memory survives it).
 */

const DB_NAME = "nasaq-inbox";
const STORE = "pending";
const KEY = "current";
/** A received file waits at most this long for its owner to sign in. */
export const INBOX_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export interface PendingSummary {
  title: string;
  pageCount: number;
  /** PNG data URL of the first page, when the file carries one. */
  thumbnail?: string;
  createdWith?: string;
}

export interface PendingNsq {
  fileName: string;
  size: number;
  receivedAt: number;
  summary: PendingSummary;
  blob: Blob;
}

let memory: PendingNsq | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) throw new Error("indexeddb unavailable");
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Preserve a validated file. Resolves once it is durably stored. */
export async function putPending(entry: PendingNsq): Promise<void> {
  memory = entry;
  try {
    // Store the bytes as an ArrayBuffer: Blob-in-IndexedDB is unreliable in
    // some Safari versions, an ArrayBuffer is not.
    const buffer = await entry.blob.arrayBuffer();
    const { blob: _blob, ...rest } = entry;
    await run("readwrite", (s) =>
      s.put({ ...rest, buffer, type: entry.blob.type }, KEY),
    );
  } catch {
    /* memory copy still serves this page session */
  }
}

export async function getPending(): Promise<PendingNsq | null> {
  let entry: PendingNsq | null = memory;
  if (!entry) {
    try {
      const row = (await run("readonly", (s) => s.get(KEY))) as
        | (Omit<PendingNsq, "blob"> & { buffer: ArrayBuffer; type?: string })
        | undefined;
      if (row?.buffer) {
        const { buffer, type, ...rest } = row;
        entry = { ...rest, blob: new Blob([buffer], { type: type || "" }) };
      }
    } catch {
      entry = null;
    }
  }
  if (entry && Date.now() - entry.receivedAt > INBOX_TTL_MS) {
    await clearPending();
    return null;
  }
  return entry;
}

export async function clearPending(): Promise<void> {
  memory = null;
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    /* nothing persisted */
  }
}
