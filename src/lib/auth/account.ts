/**
 * The account access layer — the standard view of "who is signed in".
 *
 * This module is deliberately PURE and dependency-free (it imports only the
 * `AppUser` type, which is erased at runtime), so the normalization rules can be
 * unit-tested and reused on the server. The React hooks that consume it live in
 * `./use-account`, which is the module components import.
 *
 * Fields it exposes, once each:
 *   id · name · email · createdAt · emailVerified · image · session source
 *
 * WHY: the id/email/name triple used to be re-derived at every call site, and the
 * session, storage owner and licence were each fetched by a different hook — so a
 * page could render a name from the session, a licence from a cached key and a
 * library from the previous owner in the same frame. One normalization keeps
 * every view of "the account" in step.
 *
 * Nothing here decides ACCESS. Entitlements come from the server
 * (`useLicense` → `getLicenseStatusFn`); this layer only reads them.
 */

import type { AppUser } from "./use-current-user";

/** The standard, normalized view of the signed-in account. */
export type AccountProfile = {
  /** The verified user id every row is scoped by (`context.userId` server-side). */
  id: string;
  /** Display name as stored on the account row. */
  name: string | null;
  /** Primary email as stored on the account row. */
  email: string | null;
  /** ISO creation timestamp of the account row, or null for the dev fallback. */
  createdAt: string | null;
  /** True when the account's email is verified. */
  emailVerified: boolean;
  /** Avatar URL from the provider, when any. */
  imageUrl: string | null;
  /** True for the local-only dev user (auth explicitly disabled). */
  isDevFallback: boolean;
  /**
   * True when this identity came from a real session that the server also
   * verifies. False for the disabled-auth dev user, and false with no user.
   */
  hasRealSession: boolean;
};

/** The live session record, narrowed to what the UI may show. */
export type AccountSession = {
  id: string;
  /** ISO expiry timestamp of the session row. */
  expiresAt: string | null;
  /** The session token is NEVER exposed here — it stays in the HttpOnly cookie. */
};

export type AccountState = {
  profile: AccountProfile | null;
  session: AccountSession | null;
  /** True while the session is still resolving (don't treat null as signed out). */
  isPending: boolean;
};

/** Trim a nullable string down to a value or `null` (never an empty string). */
export function cleanAccountValue(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

/**
 * Normalize an `AppUser` into the standard profile. Returns null for "no user".
 * Pure: same input, same output, no I/O.
 */
export function accountProfile(
  user: AppUser | null | undefined,
): AccountProfile | null {
  if (!user) return null;
  const id = cleanAccountValue(user.id) ?? "";
  return {
    id,
    name: cleanAccountValue(user.displayName),
    email: cleanAccountValue(user.primaryEmail),
    createdAt: cleanAccountValue(user.createdAt ?? null),
    emailVerified: user.emailVerified === true,
    imageUrl: cleanAccountValue(user.profileImageUrl),
    isDevFallback: user.isDevFallback === true,
    hasRealSession: user.isDevFallback !== true && Boolean(id),
  };
}
