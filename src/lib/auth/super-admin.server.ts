/**
 * Super-administrator (platform owner) identity.
 *
 * Two levels exist on purpose:
 *   · **ADMIN** — promoted staff. They approve payments, extend subscriptions
 *     and manage customers. They may NOT mint licences.
 *   · **SUPER_ADMIN** — the platform owner. Licence creation, hand activation,
 *     re-assignment and forced renewal are theirs alone, because a licence is
 *     the one artefact that outlives an operator's judgement call.
 *
 * The owner is recognised from **server-side configuration only**, never from
 * anything the browser sends:
 *   1. `NASAQ_SUPER_ADMIN_IDS` / `NASAQ_SUPER_ADMIN_EMAILS` — the explicit
 *      owner bypass allowlist;
 *   2. `NASAQ_OWNER_ID` / `NASAQ_OWNER_EMAIL` — the platform owner record;
 *   3. an `admin_users` row whose `role` is `SUPER_ADMIN`.
 *
 * ## Why a bootstrap exists
 *
 * A fresh database has no `admin_users` row, so the owner — the one person who
 * must never be locked out — was exactly the person the licence panel turned
 * away: `adminVerifyFn` looked for a row that had never been written and
 * answered "not authorized". `ensureOwnerSuperAdmin` closes that hole: on any
 * privileged call from an identity that matches the owner configuration, the
 * row is created with `SUPER_ADMIN`. It is idempotent, and it can never promote
 * an identity the deployment did not already name.
 */
import type { Sql } from "../db.ts";
import {
  isConfiguredAdminIdentity,
  parseIdentityList,
  readAdminIdentityConfig,
  type AdminIdentityConfig,
  type VerifiedIdentity,
} from "./admin-identity.server.ts";
import { isOwnerIdentity, ownerConfigPresent, type OwnerIdentity } from "./owner.server.ts";

/** Value of `admin_users.role` that unlocks licence administration. */
export const SUPER_ADMIN_ROLE = "SUPER_ADMIN";
export const ADMIN_ROLE = "ADMIN";

/**
 * The owner bypass allowlist.
 *
 * `NASAQ_SUPER_ADMIN_IDS` accepts verified user ids, emails, or both, comma
 * separated — one variable instead of two, because splitting them is how a
 * deployment ends up configuring one and assuming the other took effect.
 */
export function readSuperAdminConfig(): AdminIdentityConfig {
  const parsed = parseIdentityList(
    process.env.NASAQ_SUPER_ADMIN_IDS?.trim(),
    process.env.NASAQ_SUPER_ADMIN_EMAILS?.trim(),
  );
  // The owner record is a super-administrator source: the platform owner is not
  // "promoted", they ARE the authority.
  const ownerId = process.env.NASAQ_OWNER_ID?.trim();
  const ownerEmail = process.env.NASAQ_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerId) parsed.ids.add(ownerId);
  if (ownerEmail) parsed.emails.add(ownerEmail);
  return parsed;
}

export function superAdminConfigPresent(
  config = readSuperAdminConfig(),
): boolean {
  return config.ids.size > 0 || config.emails.size > 0;
}

/** Match a verified session identity against the super-admin allowlist. */
export function isConfiguredSuperAdminIdentity(
  identity: OwnerIdentity,
  config = readSuperAdminConfig(),
): boolean {
  return Boolean(
    config.ids.has(identity.id) ||
      (identity.email && config.emails.has(identity.email.trim().toLowerCase())),
  );
}

/**
 * Authoritative super-administrator lookup.
 *
 * Configuration wins (it is the deployment's own declaration), the table is the
 * fallback for a promoted owner. A plain `ADMIN` row is deliberately not
 * enough — that is the whole point of having two levels.
 */
export async function isSuperAdminIdentity(
  sql: Sql,
  identity: VerifiedIdentity,
): Promise<boolean> {
  if (isConfiguredSuperAdminIdentity(identity)) return true;
  try {
    const rows = await sql<{ role: string }>`
      select role from admin_users where user_id = ${identity.id} limit 1
    `;
    return rows[0]?.role === SUPER_ADMIN_ROLE;
  } catch {
    // A database without the `role` column (pre-0006) degrades to the
    // configuration check rather than locking the owner out mid-deploy.
    return false;
  }
}

/**
 * Owner self-heal: make sure a configured owner holds a SUPER_ADMIN row.
 *
 * Returns without writing when the identity is not the configured owner — this
 * is a repair for the deployment's own declaration, not a way to gain access.
 * Idempotent: an existing row keeps its current role unless it is a plain
 * ADMIN, which is promoted so an earlier deployment's bootstrap is not lost.
 */
export async function ensureOwnerSuperAdmin(
  sql: Sql,
  identity: VerifiedIdentity,
): Promise<{ ok: boolean; reason: string; created: boolean }> {
  const config = readSuperAdminConfig();
  const isConfigured = isConfiguredSuperAdminIdentity(identity, config);
  const isOwner = isOwnerIdentity(identity);
  if (!isConfigured && !isOwner) {
    return { ok: false, reason: "not_owner", created: false };
  }
  try {
    const existing = await sql<{ role: string }>`
      select role from admin_users where user_id = ${identity.id} limit 1
    `;
    if (!existing.length) {
      await sql`
        insert into admin_users (user_id, created_by, note, role)
        values (${identity.id}, 'system:owner-bootstrap', 'منحة المالك — تفعيل صلاحيات التراخيص', ${SUPER_ADMIN_ROLE})
        on conflict (user_id) do nothing
      `;
      return { ok: true, reason: "created", created: true };
    }
    if (existing[0]?.role === SUPER_ADMIN_ROLE) {
      return { ok: true, reason: "already_super_admin", created: false };
    }
    await sql`
      update admin_users
      set role = ${SUPER_ADMIN_ROLE}, updated_at = now()
      where user_id = ${identity.id}
    `;
    return { ok: true, reason: "promoted", created: false };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "bootstrap_failed",
      created: false,
    };
  }
}

/**
 * The diagnostic the admin panel shows.
 *
 * "Not authorized" is useless to an owner staring at their own screen. This
 * says which signal was missing — no owner configured, no allowlist entry, or a
 * row that is only ADMIN — so the fix is a one-line environment change instead
 * of a guess. Values are booleans: never the configured ids or emails.
 */
export async function superAdminDiagnostics(
  sql: Sql,
  identity: VerifiedIdentity,
): Promise<{
  isSuperAdmin: boolean;
  isAdmin: boolean;
  ownerConfigured: boolean;
  superAdminConfigured: boolean;
  adminConfigured: boolean;
  hasRow: boolean;
  role: string | null;
}> {
  const superConfig = readSuperAdminConfig();
  const adminConfig = readAdminIdentityConfig();
  let hasRow = false;
  let role: string | null = null;
  let isAdmin = isConfiguredAdminIdentity(identity, adminConfig);
  try {
    const rows = await sql<{ role: string }>`
      select role from admin_users where user_id = ${identity.id} limit 1
    `;
    hasRow = rows.length > 0;
    role = rows[0]?.role ?? null;
    if (hasRow) isAdmin = true;
  } catch {
    /* pre-0006 schema: configuration is the only signal available */
  }
  return {
    isSuperAdmin:
      isConfiguredSuperAdminIdentity(identity, superConfig) || role === SUPER_ADMIN_ROLE,
    isAdmin,
    ownerConfigured: ownerConfigPresent(),
    superAdminConfigured: superAdminConfigPresent(superConfig),
    adminConfigured: adminConfig.ids.size > 0 || adminConfig.emails.size > 0,
    hasRow,
    role,
  };
}
