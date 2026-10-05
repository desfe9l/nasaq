import { setStorageOwner } from "@/lib/editor/storage-owner";
import { authClient, authEnabled } from "./client";
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
 * - auth enabled → the Better Auth session user (`getSession()` — the same
 *   source `useCurrentUserState()` renders from), or `null` when signed out.
 *
 * Called at every identity boundary: `hydrate()` in the editor store (each
 * page load) and the sign-in/sign-out sequences in `client.ts`.
 */

/** Coalesces bursts of syncs (several components hydrate on one mount). */
let inFlight: Promise<string> | null = null;
const LAST_OWNER_KEY = "nasaq-last-owner";

function rememberOwner(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_OWNER_KEY, id);
  } catch {}
}
function recallOwner(): string | null {
  try { return localStorage.getItem(LAST_OWNER_KEY); } catch { return null; }
}

async function resolveOwnerId(): Promise<string | null> {
  if (!authEnabled) return DEV_USER.id;
  // Never probe a session during SSR — the client library is browser-only.
  if (typeof window === "undefined") return null;
  try {
    const { data } = await authClient.getSession();
    const id = data?.user?.id ?? null;
    if (id) rememberOwner(id);
    return id;
  } catch {
    // Offline: session probe failed. If we have a remembered owner and are
    // offline, keep that owner so cached workspace/projects remain visible.
    // Otherwise fail closed to anon.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const remembered = recallOwner();
      if (remembered) return remembered;
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
