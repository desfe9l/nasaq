/**
 * Offline entitlement cache — signed/validated entitlement with grace period.
 *
 * Server is source of truth. We cache only what the server validated (via
 * getLicenseStatusFn / getAuthorizationContext) and honor it offline for a
 * limited window (7 days). After grace expiry the cache is not trusted.
 * Local data is never treated as proof of permanent authorization.
 */

import { getStorageOwner } from "@/lib/editor/storage-owner";

const CACHE_KEY_PREFIX = "entitlementCache::";
const GRACE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days reasonable offline grace
const SETTINGS_STORE = "settings";

function cacheKey(ownerId: string): string {
  return `${CACHE_KEY_PREFIX}${ownerId}`;
}

export interface CachedEntitlement {
  ownerId: string;
  entitlements: Record<string, boolean>;
  validatedAt: number; // Date.now() when server validated
  expiresAt: string | null;
  isAdmin: boolean;
  isOwner: boolean;
  isSuspended?: boolean;
  hasLicense: boolean;
  source: "server";
}

async function openDb(): Promise<IDBDatabase | null> {
  const { getOfflineDb } = await import("@/lib/editor/storage");
  return getOfflineDb();
}

function tx<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(store, mode);
    } catch (e) {
      reject(e);
      return;
    }
    t.onerror = () => reject(t.error ?? new Error("tx failed"));
    t.onabort = () => reject(t.error ?? new Error("tx aborted"));
    let result: T;
    t.oncomplete = () => resolve(result as T);
    Promise.resolve(run(t)).then(
      (v) => {
        result = v;
      },
      (e) => {
        t.abort();
        reject(e);
      },
    );
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("request failed"));
  });
}

/**
 * Persist a server-validated entitlement. Only call after a successful
 * getLicenseStatus / getAuthorizationContext response.
 */
export async function cacheEntitlement(ent: CachedEntitlement): Promise<void> {
  const db = await openDb();
  if (!db) {
    // fallback to localStorage for environments without IndexedDB
    try {
      localStorage.setItem(cacheKey(ent.ownerId), JSON.stringify(ent));
    } catch {}
    return;
  }
  const key = cacheKey(ent.ownerId);
  await tx(db, SETTINGS_STORE, "readwrite", (t) =>
    request(t.objectStore(SETTINGS_STORE).put({ key, value: ent })),
  );
}

export async function getCachedEntitlement(
  ownerId: string = getStorageOwner(),
): Promise<CachedEntitlement | null> {
  const key = cacheKey(ownerId);
  // Try IndexedDB first
  try {
    const db = await openDb();
    if (db) {
      const row = (await tx(db, SETTINGS_STORE, "readonly", (t) =>
        request(t.objectStore(SETTINGS_STORE).get(key)),
      )) as { key: string; value: CachedEntitlement } | undefined;
      if (row?.value) return row.value;
    }
  } catch {}
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as CachedEntitlement;
  } catch {}
  return null;
}

/**
 * Whether cached entitlement is still within offline grace.
 * Checks: validatedAt + GRACE_MS > now and server expiry (if any) not passed.
 */
export function isEntitlementValidOffline(
  ent: CachedEntitlement | null,
  now: number = Date.now(),
): boolean {
  if (!ent) return false;
  if (ent.isSuspended) return false;
  // Grace window since last server validation
  if (now - ent.validatedAt > GRACE_MS) return false;
  // If license has explicit expiry and it's past, not valid
  if (ent.expiresAt) {
    const exp = new Date(ent.expiresAt).getTime();
    if (Number.isFinite(exp) && now > exp) return false;
  }
  return true;
}

/**
 * Get entitlements for current owner, preferring fresh server data if available,
 * else falling back to cached grace. Returns null when no valid entitlement.
 */
export async function resolveOfflineEntitlement(
  ownerId: string = getStorageOwner(),
): Promise<CachedEntitlement | null> {
  const cached = await getCachedEntitlement(ownerId);
  if (isEntitlementValidOffline(cached)) return cached;
  return null;
}

/** Clear cache for an owner (on sign-out or revocation). */
export async function clearEntitlementCache(ownerId: string): Promise<void> {
  const key = cacheKey(ownerId);
  try {
    const db = await openDb();
    if (db) {
      await tx(db, SETTINGS_STORE, "readwrite", (t) =>
        request(t.objectStore(SETTINGS_STORE).delete(key)),
      );
    }
  } catch {}
  try {
    localStorage.removeItem(key);
  } catch {}
}

export const OFFLINE_GRACE_MS = GRACE_MS;
