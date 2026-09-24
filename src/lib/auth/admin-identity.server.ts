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
 * verified Better Auth user ids or comma-separated email addresses. Owner
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
      (identity.email &&
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
  if (isConfiguredAdminIdentity(identity, config)) return true;

  const rows = await sql<{ user_id: string }>`
    select user_id from admin_users where user_id = ${identity.id} limit 1
  `;
  return rows.length > 0;
}

/** Compatibility helper for commercial call sites/tests, checking ID and optional session email or custom config. */
export async function isAdminUser(
  sql: Sql,
  userId: string,
  userEmailOrConfig?: string | null | AdminIdentityConfig,
  customConfig?: AdminIdentityConfig,
): Promise<boolean> {
  const userEmail = typeof userEmailOrConfig === "string" ? userEmailOrConfig : null;
  const config =
    userEmailOrConfig && typeof userEmailOrConfig === "object" && "ids" in userEmailOrConfig
      ? userEmailOrConfig
      : customConfig || readAdminIdentityConfig();

  const rows = await sql<{ user_id: string }>`
    select user_id from admin_users where user_id = ${userId} limit 1
  `;
  if (rows.length > 0) return true;
  if (config.ids.has(userId)) return true;
  if (userEmail && config.emails.has(userEmail.trim().toLowerCase())) return true;
  if (config.emails.size === 0) return false;

  const userRows = await sql<{ email: string | null }>`
    select email from "user" where id = ${userId} limit 1
  `;
  const email = userEmail || userRows[0]?.email || null;
  return isConfiguredAdminIdentity({ id: userId, email }, config);
}
