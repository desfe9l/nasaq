/** Durable handoff across OAuth/reloads. Never promise durability via memory. */
import { NSQ_LIMITS, NsqError } from "./format";
const DB_NAME = "nasaq-inbox",
  STORE = "pending",
  KEY = "current";
export const INBOX_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export interface PendingSummary {
  title: string;
  pageCount: number;
  thumbnail?: string;
  createdWith?: string;
}
export interface PendingNsq {
  id: string;
  fileName: string;
  size: number;
  receivedAt: number;
  summary: PendingSummary;
  blob: Blob;
}
type Row = Omit<PendingNsq, "blob"> & { buffer: ArrayBuffer; type: string };
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined")
      return reject(new NsqError("storage"));
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      reject(new NsqError("storage"));
      return;
    }
    let settled = false;
    const fail = () => {
      settled = true;
      reject(new NsqError("storage"));
    };
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      if (settled) req.result.close();
      else {
        req.result.onversionchange = () => req.result.close();
        resolve(req.result);
      }
    };
    req.onerror = fail;
    req.onblocked = fail;
  });
}

/** A read-modify-write transaction; settles on COMMIT, never request success. */
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    done: (value: T) => void,
    fail: (error: Error) => void,
  ) => void,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result: T, reason: Error | undefined;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(reason || new NsqError("storage"));
      try {
        operation(
          tx.objectStore(STORE),
          (value) => {
            result = value;
          },
          (error) => {
            reason = error;
            tx.abort();
          },
        );
      } catch {
        reason = new NsqError("storage");
        tx.abort();
      }
    });
  } finally {
    db.close();
  }
}
const rowId = (row: Row) => row.id || `legacy-${row.receivedAt}`;

/** Never overwrite an unconsumed received file. Quota failures keep the old row. */
export async function putPending(
  entry: Omit<PendingNsq, "id">,
): Promise<PendingNsq> {
  if (entry.blob.size > NSQ_LIMITS.maxFileBytes)
    throw new NsqError("too-large");
  const id = crypto.randomUUID();
  const buffer = await entry.blob.arrayBuffer();
  const { blob, ...metadata } = entry;
  await transaction<void>("readwrite", (store, done, fail) => {
    const read = store.get(KEY);
    read.onsuccess = () => {
      const previous = read.result as Row | undefined;
      if (previous && Date.now() - previous.receivedAt <= INBOX_TTL_MS) {
        fail(new NsqError("pending"));
        return;
      }
      store.put(
        { ...metadata, id, size: blob.size, buffer, type: blob.type },
        KEY,
      );
      done(undefined);
    };
  });
  return { ...entry, id, size: blob.size };
}

export async function getPending(): Promise<PendingNsq | null> {
  let row: Row | undefined;
  try {
    row = await transaction<Row | undefined>("readonly", (store, done) => {
      const req = store.get(KEY);
      req.onsuccess = () => done(req.result);
    });
  } catch {
    return null;
  }
  if (!row) return null;
  if (
    !(row.buffer instanceof ArrayBuffer) ||
    row.buffer.byteLength > NSQ_LIMITS.maxFileBytes ||
    !Number.isFinite(row.receivedAt) ||
    Date.now() - row.receivedAt > INBOX_TTL_MS
  ) {
    await clearPending(rowId(row));
    return null;
  }
  const { buffer, type, ...rest } = row;
  return {
    ...rest,
    id: rowId(row),
    blob: new Blob([buffer], { type: type || "" }),
  };
}

/** Compare-and-delete: a stale completion must never discard a newer file. */
export async function clearPending(expectedId?: string): Promise<void> {
  await transaction<void>("readwrite", (store, done) => {
    const req = store.get(KEY);
    req.onsuccess = () => {
      if (req.result && (!expectedId || rowId(req.result) === expectedId))
        store.delete(KEY);
      done(undefined);
    };
  });
}
