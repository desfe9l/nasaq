/**
 * Ownership of the local library storage session.
 *
 * The editor library (projects, assets and the account-scoped settings rows)
 * persists in THIS browser's IndexedDB/localStorage, which outlives sessions:
 * without an owner tag a signed-out visitor — or a second account on the same
 * browser — reads straight back into the previous account's library. Every
 * persisted row is therefore stamped with the current owner (the account id,
 * or `ANON_OWNER` when signed out) and `storage.ts` only ever returns rows
 * belonging to that owner.
 *
 * This module is deliberately dependency-free (no auth, no React) so the
 * storage layer — and the node test runner — can use it. The auth layer
 * resolves the session and calls `setStorageOwner` (see
 * `src/lib/auth/storage-owner-sync.ts`); until that happens the owner is
 * `ANON_OWNER`, which fails closed: only visitor-owned rows are readable.
 */

/** Owner tag for signed-out visitors. */
export const ANON_OWNER = "__anon__";

let currentOwner: string = ANON_OWNER;

/** The owner every storage read/write is scoped to right now. */
export function getStorageOwner(): string {
  return currentOwner;
}

/**
 * Pin the storage session to an account id. `null`/empty means signed out,
 * which resets the scope to `ANON_OWNER`. Returns the effective owner.
 */
export function setStorageOwner(ownerId: string | null | undefined): string {
  const id = typeof ownerId === "string" ? ownerId.trim() : "";
  currentOwner = id || ANON_OWNER;
  return currentOwner;
}

/** True when a real account (not a signed-out visitor) owns the session. */
export function hasSignedInOwner(): boolean {
  return currentOwner !== ANON_OWNER;
}

/** How a persisted row relates to the current owner (see `rowOwnership`). */
export type RowOwnership = "own" | "adoptable" | "foreign";

/**
 * Classify one persisted row against the current owner:
 *
 * - `"own"` — stamped with the current owner; always readable.
 * - `"adoptable"` — a pre-isolation (unstamped) or visitor-stamped row while
 *   the current owner is a signed-in account. The account adopts it once
 *   (readers re-stamp it), which keeps libraries saved before ownership
 *   tracking — and demo work a visitor did before signing in — reachable.
 * - `"foreign"` — stamped with a DIFFERENT owner; never readable, writable or
 *   deletable through this session.
 *
 * A signed-out visitor adopts nothing: an unstamped row may be an account's
 * private library, so it stays invisible until an account claims it.
 */
export function rowOwnership(
  row: { ownerId?: string | null } | null | undefined,
): RowOwnership {
  if (!row) return "foreign";
  const owner = currentOwner;
  const tag =
    typeof row.ownerId === "string" && row.ownerId.trim() ? row.ownerId : null;
  if (tag === owner) return "own";
  if (owner !== ANON_OWNER && (tag === null || tag === ANON_OWNER)) {
    return "adoptable";
  }
  return "foreign";
}
