import { setStorageOwner } from "@/lib/editor/storage-owner";
import { authEnabled, getSession, getSessionSnapshot, revalidateSession } from "./client";
import { cachedSessionUserId } from "./session-cache";
import { DEV_USER } from "./use-current-user";

/**
 * Session → storage-owner bridge.
 *
 * The local library (`src/lib/editor/storage.ts`) is partitioned per owner;
 * this module resolves WHO the current session belongs to and pins the
 * storage scope accordingly, so a signed-out visitor can never read an
 * account's rows and a second account only ever sees its own:
 *
 * - auth disabled (`VITE_AUTH_ENABLED=false`) → the shared dev user, matching
 *   what `useCurrentUserState()` and the server-side verifier report;
 * - auth enabled → the signed-in account (`getSession()` — the same
 *   source `useCurrentUserState()` renders from), or `null` when signed out.
 *
 * Called at every identity boundary: `hydrate()` in the editor store (each
 * page load) and the sign-in/sign-out sequences in `client.ts`.
 *
 * The owner is resolved from the CACHED session when one is on hand
 * (`session-cache.ts`), so this bridge never sits on the editor's open path
 * waiting for a request; the probe that follows in the background only ever
 * corrects the answer.
 */

/** Coalesces bursts of syncs (several components hydrate on one mount). */
let inFlight: Promise<string> | null = null;
const LAST_OWNER_KEY = "nasaq-last-owner";
/** A session probe must never hold document open. Local cache proceeds either way. */
const SESSION_BUDGET_MS = 900;

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("session-budget")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function rememberOwner(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_OWNER_KEY, id);
  } catch {
    /* Remembering the owner is an offline convenience, never an auth requirement. */
  }
}
function recallOwner(): string | null {
  try { return localStorage.getItem(LAST_OWNER_KEY); } catch { return null; }
}

/**
 * Drop the entitlement cached under an account id we no longer sign in as.
 *
 * After the first-party auth migration minted a new account id, the cache
 * entry under the OLD id still describes the same person — but it can never be
 * refreshed for that id again, so honouring it later (offline, or a remembered
 * owner) would show a stale, usually FREE, licence state. Best-effort: the
 * cache is a convenience, never a source of truth.
 */
async function dropStaleOwnerCache(previousOwner: string): Promise<void> {
  try {
    const { clearEntitlementCache } = await import("@/lib/offline/entitlement-cache");
    await clearEntitlementCache(previousOwner);
  } catch {
    /* an unavailable cache store leaves nothing to clean up */
  }
}

/**
 * Adopt a session the background probe resolved that disagrees with the owner
 * we opened with (the cache said account A, the server says account B — a
 * sign-in or sign-out that happened in another tab, or a revoked session).
 *
 * The probe is the SESSION STORE's own (`revalidateSession`), not a second
 * `/get-session` of its own: the store already shares one request between every
 * consumer on the page, so the library's owner check costs nothing extra and, if
 * the server has disowned the session, the store's revocation path takes over
 * from here.
 */
function reconcileOwnerInBackground(currentOwner: string): void {
  void revalidateSession()
    .then(() => {
      const id = getSessionSnapshot().data?.user?.id ?? null;
      if (!id || id === currentOwner) return;
      void dropStaleOwnerCache(currentOwner);
      rememberOwner(id);
      setStorageOwner(id);
      window.dispatchEvent(new CustomEvent("nasaq:owner-changed"));
    })
    .catch(() => undefined);
}

async function resolveOwnerId(): Promise<string | null> {
  if (!authEnabled) return DEV_USER.id;
  // Never probe a session during SSR — the client library is browser-only.
  if (typeof window === "undefined") return null;
  const remembered = recallOwner();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  // A local document must open without a session round-trip. Offline (and a
  // hung session probe) keep the last owner so IndexedDB stays readable.
  if (offline && remembered) return remembered;

  /*
   * Stale-While-Revalidate: the cached session already names the owner, so the
   * library opens NOW. The session probe that used to hold this decision (up to
   * `SESSION_BUDGET_MS`) still runs — in the background — and re-pins the owner
   * if the server disagrees. This is the editor's open path: waiting here for a
   * round trip delayed the first painted document on every page load.
   */
  const cachedOwner = cachedSessionUserId();
  if (cachedOwner) {
    if (remembered && remembered !== cachedOwner) void dropStaleOwnerCache(remembered);
    rememberOwner(cachedOwner);
    reconcileOwnerInBackground(cachedOwner);
    return cachedOwner;
  }

  try {
    const { data } = await withDeadline(getSession(), SESSION_BUDGET_MS);
    const id = data?.user?.id ?? null;
    if (id) {
      if (remembered && remembered !== id) void dropStaleOwnerCache(remembered);
      rememberOwner(id);
    }
    return id;
  } catch {
    if (remembered) {
      // The probe failed or exceeded the budget. Open the remembered library
      // now, and adopt a later session only if it is actually a different owner.
      void getSession()
        .then(({ data }) => {
          const id = data?.user?.id ?? null;
          if (!id || id === remembered) return;
          void dropStaleOwnerCache(remembered);
          rememberOwner(id);
          setStorageOwner(id);
          window.dispatchEvent(new CustomEvent("nasaq:owner-changed"));
        })
        .catch(() => undefined);
      return remembered;
    }
    return null;
  }
}

/**
 * Resolve the current session and pin the storage owner to it.
 * Returns the effective owner id (`ANON_OWNER` when signed out). A failed
 * session probe fails CLOSED: the scope resets to signed-out, except when
 * offline where the last known owner is retained for offline cache access.
 */
export function syncStorageOwner(): Promise<string> {
  if (!inFlight) {
    inFlight = resolveOwnerId()
      .then((id) => {
        if (id) rememberOwner(id);
        // When offline and no remembered id, keep current owner (fail closed already anon)
        // setStorageOwner handles ANON mapping
        return setStorageOwner(id);
      })
      .catch(() => setStorageOwner(null))
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}
