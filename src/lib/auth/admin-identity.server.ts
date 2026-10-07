import type { Sql } from "@/lib/db";
import type { OwnerIdentity } from "./owner.server";

/**
 * Parse a comma-separated identity allowlist.
 *
 * Entries containing "@" are emails (lower-cased, because a session may hand
 * back the address in any case), everything else is a verified user id. Shared
 * by the administrator and super-administrator readers so one variable's
 * parsing can never drift from the other's.
 */
export function parseIdentityList(
  ...sources: Array<string | undefined>
): AdminIdentityConfig {
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const raw of sources) {
    if (!raw) continue;
    for (const entry of raw.split(",")) {
      const value = entry.trim();
      if (!value) continue;
      if (value.includes("@")) emails.add(value.toLowerCase());
      else ids.add(value);
    }
  }
  return { ids, emails };
}

export type VerifiedIdentity = OwnerIdentity;

export type AdminIdentityConfig = {
  ids: Set<string>;
  emails: Set<string>;
};

/**
 * Read the server-side administrator allowlist.
 *
 * `NASAQ_ADMIN_USER_IDS` is the existing deployment setting and accepts either
 * verified account user ids or comma-separated email addresses. Owner
 * configuration is included as an explicit administrator source as well. There
 * is deliberately no hard-coded fallback address.
 */
export function readAdminIdentityConfig(): AdminIdentityConfig {
  // The super-administrator allowlist counts as an administrator source: an
  // owner named only there would otherwise pass the licence checks while being
  // turned away by every ordinary admin surface.
  const parsed = parseIdentityList(
    process.env.NASAQ_ADMIN_USER_IDS?.trim(),
    process.env.NASAQ_SUPER_ADMIN_IDS?.trim(),
    process.env.NASAQ_SUPER_ADMIN_EMAILS?.trim(),
  );
  const ownerId = process.env.NASAQ_OWNER_ID?.trim();
  const ownerEmail = process.env.NASAQ_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerId) parsed.ids.add(ownerId);
  if (ownerEmail) parsed.emails.add(ownerEmail);
  return parsed;
}

export function adminIdentityConfigPresent(
  config = readAdminIdentityConfig(),
): boolean {
  return config.ids.size > 0 || config.emails.size > 0;
}

/** Match a verified session identity against explicit server configuration. */
export function isConfiguredAdminIdentity(
  identity: VerifiedIdentity,
  config = readAdminIdentityConfig(),
): boolean {
  return Boolean(
    config.ids.has(identity.id) ||
      (identity.emailVerified &&
        identity.email &&
        config.emails.has(identity.email.trim().toLowerCase())),
  );
}

/**
 * Authoritative administrator lookup for a verified session identity.
 *
 * Configuration is checked first because the email itself is supplied by the
 * verified auth session. A table row is the second source, and therefore a
 * promoted administrator keeps full access even when no owner env value exists.
 */
export async function isAdminIdentity(
  sql: Sql,
  identity: VerifiedIdentity,
  config = readAdminIdentityConfig(),
): Promise<boolean> {
  /*
   * Delegated to `isAdminCaller` on purpose. This used to be a second,
   * shorter copy of the same decision (configuration, then the row), and the
   * two drifted the moment the durable owner binding was added: the template
   * console and the vault would have kept answering "not an admin" for an
   * owner whose id changed, while the commercial console let them in. One
   * implementation, one answer.
   */
  return isAdminCaller(sql, identity, { config });
}

/** Where an account's verified address is read from when the caller has no session flag. */
export type AdminAccountLookup = (
  userId: string,
) => Promise<{ email: string | null; emailVerified: boolean } | null>;

/**
 * The account's address and verification state from the AUTHORITATIVE identity
 * store (first-party AuthStore), falling back to the legacy `"user"` projection
 * only when the store has no such account. Since #153 the projection can lag
 * or be missing (the mirror is best-effort and collides with pre-migration
 * rows), so it is never the first source any more.
 */
function defaultAccountLookup(sql: Sql): AdminAccountLookup {
  return async (userId) => {
    try {
      const { findAuthUserById } = await import("./identities.server");
      const account = await findAuthUserById(userId);
      if (account) return { email: account.email, emailVerified: account.emailVerified };
    } catch {
      /* identity store unavailable — fall through to the projection */
    }
    try {
      const rows = await sql<{ email: string | null; emailVerified: boolean }>`
        select email, "emailVerified" from "user" where id = ${userId} limit 1
      `;
      const row = rows[0];
      return row ? { email: row.email, emailVerified: row.emailVerified === true } : null;
    } catch {
      return null;
    }
  };
}

export type AdminCallerOptions = {
  config?: AdminIdentityConfig;
  lookupAccount?: AdminAccountLookup;
};

/**
 * THE administrator decision for a caller, shared by every admin surface.
 *
 * `emailVerified` comes from the session the server resolved (`authMiddleware`
 * → AuthStore), never from the browser, so when it is supplied it is the
 * authority for the address. Order:
 *
 *   1. configured id (`NASAQ_OWNER_ID`, `NASAQ_ADMIN_USER_IDS`, `NASAQ_SUPER_ADMIN_IDS`)
 *      — no database needed;
 *   2. configured address with a server-VERIFIED session address — no database needed;
 *   3. an `admin_users` row (ADMIN or SUPER_ADMIN);
 *   4. the durable owner binding — the account the deployment's owner was
 *      re-bound to after the first-party auth migration changed their id;
 *   5. only when the caller supplied no session verification state (id-only
 *      internal callers): the account's verified address from the identity store.
 *
 * Before this existed the commercial console (users, payments, plans, settings,
 * requests) answered step 4 from the `"user"` table ONLY, ignoring the verified
 * session — so an owner who signed in after the first-party migration (whose
 * account is not in `"user"`) was refused there while the template console and
 * the vault, which use the session, let them in.
 */
export async function isAdminCaller(
  sql: Sql,
  identity: { id: string; email?: string | null; emailVerified?: boolean | null },
  options: AdminCallerOptions = {},
): Promise<boolean> {
  const config = options.config ?? readAdminIdentityConfig();
  const sessionVerified = typeof identity.emailVerified === "boolean";
  if (config.ids.has(identity.id)) return true;
  if (
    sessionVerified &&
    isConfiguredAdminIdentity(
      { id: identity.id, email: identity.email ?? null, emailVerified: identity.emailVerified === true },
      config,
    )
  ) {
    return true;
  }

  const rows = await sql<{ user_id: string }>`
    select user_id from admin_users where user_id = ${identity.id} limit 1
  `;
  if (rows.length > 0) return true;

  /*
   * 5. the durable owner binding.
   *
   * An account whose id changed in the first-party auth migration matches no
   * configured id and owns no `admin_users` row until `recoverOwnerAuthority`
   * re-binds it; once bound, this is what lets it back in. It is read from
   * server-held state and matched on the verified session id, so it is no more
   * forgeable than the `admin_users` row above it.
   */
  try {
    const { readOwnerBinding, isBoundAdmin } = await import("./owner-binding.server.ts");
    if (isBoundAdmin(await readOwnerBinding(sql), { id: identity.id, email: identity.email ?? null, emailVerified: identity.emailVerified === true })) {
      return true;
    }
  } catch {
    /* unreadable binding is "not an admin", exactly like an unreadable row */
  }

  if (sessionVerified || config.emails.size === 0) return false;

  const account = await (options.lookupAccount ?? defaultAccountLookup(sql))(identity.id);
  return isConfiguredAdminIdentity(
    {
      id: identity.id,
      // The stored account wins over a caller-provided address: an id-only
      // caller must not be able to name an allowlisted address it does not own.
      email: account?.email ?? null,
      emailVerified: account?.emailVerified === true,
    },
    config,
  );
}

/** Compatibility helper for commercial call sites/tests, checking ID and optional session email or custom config. */
export async function isAdminUser(
  sql: Sql,
  userId: string,
  userEmailOrConfig?: string | null | AdminIdentityConfig,
  customConfig?: AdminIdentityConfig,
  lookupAccount?: AdminAccountLookup,
): Promise<boolean> {
  const config =
    userEmailOrConfig && typeof userEmailOrConfig === "object" && "ids" in userEmailOrConfig
      ? userEmailOrConfig
      : customConfig || readAdminIdentityConfig();
  // No session verification state here: the address is re-read from the
  // account (step 4 of `isAdminCaller`), never taken from the argument.
  return isAdminCaller(sql, { id: userId }, { config, lookupAccount });
}
