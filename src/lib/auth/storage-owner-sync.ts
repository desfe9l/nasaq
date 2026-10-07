import { setStorageOwner } from "@/lib/editor/storage-owner";
import { authEnabled, getSession } from "./client";
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

async function resolveOwnerId(): Promise<string | null> {
  if (!authEnabled) return DEV_USER.id;
  // Never probe a session during SSR — the client library is browser-only.
  if (typeof window === "undefined") return null;
  const remembered = recallOwner();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  // A local document must open without a session round-trip. Offline (and a
  // hung session probe) keep the last owner so IndexedDB stays readable.
  if (offline && remembered) return remembered;
  try {
    const { data } = await withDeadline(getSession(), SESSION_BUDGET_MS);
    const id = data?.user?.id ?? null;
    if (id) rememberOwner(id);
    return id;
  } catch {
    if (remembered) {
      // The probe failed or exceeded the budget. Open the remembered library
      // now, and adopt a later session only if it is actually a different owner.
      void getSession()
        .then(({ data }) => {
          const id = data?.user?.id ?? null;
          if (!id || id === remembered) return;
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
