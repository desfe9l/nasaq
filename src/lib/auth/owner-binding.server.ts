/**
 * The durable owner binding — and the ONE authorized path that repairs it.
 *
 * ## The failure this module exists for
 *
 * Administrator authority in NASAQ is bound to an ACCOUNT ID:
 *
 *   · `NASAQ_OWNER_ID` / `NASAQ_SUPER_ADMIN_IDS` / `NASAQ_ADMIN_USER_IDS`
 *     name an id;
 *   · an `admin_users` row is keyed by `user_id`;
 *   · licences, subscriptions, projects and `users/<id>/…` storage are keyed
 *     by the same id.
 *
 * The first-party auth migration (#153) started a NEW identity store. An
 * account that signed in again after the cutover was minted a NEW id, so
 * everything named above stopped belonging to its holder: the `admin_users`
 * row (SUPER_ADMIN) still exists but under an id nobody can sign in as, and
 * `NASAQ_OWNER_ID` — when it was copied from the old database — points at the
 * same dead id. Every gate, correctly, answers "no": both authority probes
 * deny, the console shows «لا تملك صلاحية الوصول», and there is no recovery
 * because `adminBootstrapFirst` and `adminBootstrapOwnerFn` both require the
 * caller to ALREADY match the owner configuration — the very thing that broke.
 *
 * #155 added legacy adoption, which keeps the original id when the holder
 * proves the OLD Better Auth password. That proof is unavailable to anyone who
 * set a new password after the cutover (the normal re-registration case), so
 * the original id stays orphaned forever. Email allowlists cannot help either:
 * they all require `emailVerified`, and this product ships no mailbox
 * verification, so a password account is unverified permanently.
 *
 * ## The repair
 *
 * Authority is bound to an id, so the fix cannot be to stop matching on ids —
 * it must be to MOVE the binding to the id the person actually signs in with.
 * This module does exactly that, under a rule that can never usurp a
 * LIVE administrator:
 *
 *   **A binding is only written when no account that still exists holds
 *   administrator authority.** An `admin_users` row is "live" when its
 *   `user_id` resolves to an account in the identity store; a row whose id
 *   does not resolve is an ORPHAN left behind by the migration, and re-binding
 *   it grants nothing that anybody could currently exercise.
 *
 * Two proofs are accepted, both server-side and both about the CALLER:
 *
 *   1. `legacy_role_transfer` — an orphaned `admin_users` row belongs to a
 *      pre-migration id whose address (read from the legacy `\"user\"`
 *      projection or the Better Auth R2 state) equals the caller's address.
 *      Same human, dead id, live id. Works with NO environment variable.
 *   2. `owner_email_binding` — the deployment names the caller's address as
 *      the owner (`NASAQ_OWNER_EMAIL` / `NASAQ_SUPER_ADMIN_EMAILS`) and the
 *      caller is the store's unique holder of it.
 *
 * What is never accepted: a browser-supplied id, a browser-supplied role, an
 * unverified address that the deployment did not name, or anything at all when
 * a live administrator exists. The write is once-only and audited.
 */
import type { Sql } from "../db.ts";
import {
  isConfiguredAdminIdentity,
  readAdminIdentityConfig,
  type VerifiedIdentity,
} from "./admin-identity.server.ts";
import {
  isConfiguredSuperAdminIdentity,
  readSuperAdminConfig,
  ADMIN_ROLE,
  SUPER_ADMIN_ROLE,
} from "./super-admin.server.ts";
import { isOwnerIdentity, readOwnerConfig } from "./owner.server.ts";

/** `site_settings` key holding the binding. Namespaced, versioned, server-only. */
export const OWNER_BINDING_KEY = "nasaq.owner_binding.v1";

export type OwnerBindingSource = "legacy_role_transfer" | "owner_email_binding";

export type OwnerBinding = {
  userId: string;
  email: string | null;
  boundAt: string;
  source: OwnerBindingSource;
  /** The orphaned pre-migration id the authority was carried over from. */
  previousUserId: string | null;
  /**
   * The role the binding carries.
   *
   * Role separation survives the repair: a transferred staff `ADMIN` row stays
   * an administrator and never becomes the platform owner, so the vault keeps
   * redacting secret values for them.
   */
  role: string;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Rebuild a binding from stored jsonb. Anything unrecognised is "no binding". */
export function parseOwnerBinding(value: unknown): OwnerBinding | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const userId = asText(raw.userId);
  if (!userId) return null;
  const role = asText(raw.role)?.toUpperCase();
  return {
    userId,
    email: asText(raw.email)?.toLowerCase() ?? null,
    boundAt: asText(raw.boundAt) ?? new Date(0).toISOString(),
    source: raw.source === "legacy_role_transfer" ? "legacy_role_transfer" : "owner_email_binding",
    previousUserId: asText(raw.previousUserId),
    role: role === SUPER_ADMIN_ROLE ? SUPER_ADMIN_ROLE : ADMIN_ROLE,
  };
}

/** The stored binding, or null. Never throws — an unreadable store is "none". */
export async function readOwnerBinding(sql: Sql): Promise<OwnerBinding | null> {
  try {
    const rows = await sql<{ value: unknown }>`
      select value from site_settings where key = ${OWNER_BINDING_KEY} limit 1
    `;
    return parseOwnerBinding(rows[0]?.value);
  } catch {
    return null;
  }
}

/**
 * Does the stored binding name this identity at all?
 *
 * The id is the whole test: it is the value the binding was written for and it
 * comes from the verified session, never from the request. Used for the
 * ADMINISTRATOR decision, where any binding counts.
 */
export function isBoundAdmin(binding: OwnerBinding | null, identity: VerifiedIdentity): boolean {
  return Boolean(binding && identity.id && binding.userId === identity.id);
}

/**
 * Does the binding make this identity the platform OWNER?
 *
 * Stricter on purpose: a staff `ADMIN` row carried across from a pre-migration
 * id keeps its own level. Secret values in the owner vault and licence minting
 * stay owner-only, so the repair must never double as a promotion.
 */
export function isBoundOwner(binding: OwnerBinding | null, identity: VerifiedIdentity): boolean {
  return isBoundAdmin(binding, identity) && binding?.role === SUPER_ADMIN_ROLE;
}

// ── Identity directory ──────────────────────────────────────────────────────

/**
 * What the recovery needs to know about accounts.
 *
 * `ready` is the important field: "the identity store is answering" is not the
 * same claim as "this id is unknown". Without it an outage would make every
 * `admin_users` row look orphaned, and the guard would wave an attacker
 * through. A directory that is not ready refuses the recovery outright.
 */
export type IdentityDirectory = {
  ready: boolean;
  lookup(id: string): Promise<{ id: string; email: string } | null>;
  byEmail(email: string): Promise<{ id: string; email: string } | null>;
};

/** The production directory: the AuthStore (R2 or Postgres). */
export async function authIdentityDirectory(): Promise<IdentityDirectory> {
  const [{ findAuthUserById, findAuthUserByEmail }, { getAuthStore }] = await Promise.all([
    import("./identities.server.ts"),
    import("./store/index.server.ts"),
  ]);
  let ready = false;
  try {
    ready = Boolean(await getAuthStore());
  } catch {
    ready = false;
  }
  return {
    ready,
    lookup: async (id) => {
      const user = await findAuthUserById(id);
      return user ? { id: user.id, email: user.email } : null;
    },
    byEmail: async (email) => {
      const user = await findAuthUserByEmail(email);
      return user ? { id: user.id, email: user.email } : null;
    },
  };
}

/** A directory that knows no accounts — tests and disabled deployments. */
export const EMPTY_DIRECTORY: IdentityDirectory = {
  ready: true,
  lookup: async () => null,
  byEmail: async () => null,
};

// ── Recovery ────────────────────────────────────────────────────────────────

export type RecoveryRefusal =
  | "disabled"
  | "no_session"
  | "store_unavailable"
  | "already_authorized"
  | "live_admin_exists"
  | "binding_owned_by_other"
  | "not_named"
  | "no_address"
  | "address_not_unique"
  | "write_failed";

export type RecoveryResult =
  | {
      ok: true;
      reason: "already_authorized" | "bound";
      role: string;
      source: OwnerBindingSource;
      previousUserId: string | null;
    }
  | { ok: false; reason: RecoveryRefusal; error: string };

const REFUSAL_MESSAGES: Record<RecoveryRefusal, string> = {
  disabled: "استعادة صلاحية المالك معطّلة في إعدادات النشر.",
  no_session: "سجّل الدخول بحساب المالك أولًا.",
  store_unavailable: "مخزن الحسابات غير متاح الآن — لا يمكن التحقق من الهوية.",
  already_authorized: "هذا الحساب يملك الصلاحية بالفعل.",
  live_admin_exists: "يوجد مسؤول يمكنه تسجيل الدخول — لا يمكن نقل الصلاحية إليك.",
  binding_owned_by_other: "صلاحية المالك مرتبطة بحساب آخر بالفعل.",
  not_named:
    "هذا الحساب ليس مسمّى مالكًا في إعدادات النشر. اضبط NASAQ_OWNER_EMAIL أو NASAQ_OWNER_ID ببيانات هذا الحساب.",
  no_address: "حسابك بلا بريد إلكتروني — لا يمكن مطابقته مع إعدادات المالك.",
  address_not_unique: "هذا البريد غير مرتبط بحسابك وحدك.",
  write_failed: "تعذّر حفظ ربط المالك — تحقّق من قاعدة البيانات.",
};

export function recoveryMessage(reason: RecoveryRefusal): string {
  return REFUSAL_MESSAGES[reason];
}

function refusal(reason: RecoveryRefusal): RecoveryResult {
  return { ok: false, reason, error: REFUSAL_MESSAGES[reason] };
}

/**
 * Addresses the deployment named as owner / super-administrator, lower-cased.
 *
 * Deliberately the EMAIL half of the configuration only: `NASAQ_OWNER_ID` is
 * already an exact id match, and nothing about it is ambiguous, so it never
 * needs repair.
 */
export function configuredOwnerEmails(): Set<string> {
  const emails = new Set<string>();
  const ownerEmail = process.env.NASAQ_OWNER_EMAIL?.trim().toLowerCase();
  if (ownerEmail) emails.add(ownerEmail);
  for (const entry of readSuperAdminConfig().emails) emails.add(entry);
  return emails;
}

/**
 * The address a pre-migration id carried, from the legacy sources.
 *
 * Read-only and best-effort: the `\"user\"` projection is the table
 * `admin_users` rows were keyed against, and the Better Auth R2 state is the
 * copy that predates it. Best effort, because a missing table or bucket must
 * answer "unknown", never crash a recovery attempt.
 */
export async function legacyEmailForId(sql: Sql, id: string): Promise<string | null> {
  try {
    const rows = await sql<{ email: string | null }>`
      select email from "user" where id = ${id} limit 1
    `;
    const email = rows[0]?.email;
    if (email) return String(email).trim().toLowerCase();
  } catch {
    /* projection unavailable — fall through to the R2 state */
  }
  try {
    const { r2LegacySource } = await import("./legacy-accounts.server.ts");
    const { getObjectStorage } = await import("../storage/r2.server.ts");
    const storage = getObjectStorage();
    if (!storage) return null;
    const bytes = await storage.get("_nasaq-auth/state-v1.json");
    if (!bytes) return null;
    const state = JSON.parse(new TextDecoder().decode(bytes)) as {
      tables?: Record<string, Array<Record<string, unknown>>>;
    };
    const row = (state?.tables?.user ?? []).find((entry) => String(entry.id ?? "") === id);
    const email = row?.email;
    return typeof email === "string" && email.trim() ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Re-bind administrator authority to the account the caller signs in with.
 *
 * Returns `already_authorized` when there is nothing to repair, so the caller
 * can be told the truth instead of being handed a silent no-op.
 */
export async function recoverOwnerAuthority(
  sql: Sql,
  identity: VerifiedIdentity,
  directory: IdentityDirectory,
  options: { audit?: (entry: { action: string; detail: Record<string, string | null> }) => Promise<void> } = {},
): Promise<RecoveryResult> {
  // Kill switch: `NASAQ_OWNER_BINDING=off` turns the whole repair off without
  // touching any other authorization rule.
  if (process.env.NASAQ_OWNER_BINDING?.trim().toLowerCase() === "off") return refusal("disabled");

  const userId = identity.id?.trim();
  if (!userId || userId === "dev-user") return refusal("no_session");
  // An unready store cannot tell "orphan" from "live", so fail CLOSED.
  if (!directory.ready) return refusal("store_unavailable");

  const email = identity.email?.trim().toLowerCase() || null;

  // ── 1. Nothing to repair? Say so. ────────────────────────────────────────
  const adminConfig = readAdminIdentityConfig();
  const superConfig = readSuperAdminConfig();
  const existing = await sql<{ role: string }>`
    select role from admin_users where user_id = ${userId} limit 1
  `;
  if (
    existing.length > 0 ||
    adminConfig.ids.has(userId) ||
    superConfig.ids.has(userId) ||
    (identity.emailVerified && isConfiguredAdminIdentity(identity, adminConfig)) ||
    (identity.emailVerified && isConfiguredSuperAdminIdentity(identity, superConfig)) ||
    isOwnerIdentity(identity)
  ) {
    return {
      ok: true,
      reason: "already_authorized",
      role: existing[0]?.role ?? (isOwnerIdentity(identity) ? SUPER_ADMIN_ROLE : ADMIN_ROLE),
      source: "owner_email_binding",
      previousUserId: null,
    };
  }

  // ── 2. Write-once: an existing binding for someone else ends this. ───────
  const stored = await readOwnerBinding(sql);
  if (stored && stored.userId !== userId) return refusal("binding_owned_by_other");

  // ── 3. The guard: no LIVE administrator may exist. ──────────────────────
  const rows = await sql<{ user_id: string; role: string }>`
    select user_id, role from admin_users
  `;
  const namedIds = new Set<string>([
    ...adminConfig.ids,
    ...superConfig.ids,
    ...(readOwnerConfig().id ? [readOwnerConfig().id as string] : []),
  ]);
  for (const id of namedIds) {
    if (id === userId) continue;
    if (await directory.lookup(id)) return refusal("live_admin_exists");
  }
  for (const row of rows) {
    if (row.user_id === userId) continue;
    if (await directory.lookup(row.user_id)) return refusal("live_admin_exists");
  }

  if (!email) return refusal("no_address");

  // ── 4. Proof 1: an ORPHANED administrator row for this address. ──────────
  // The orphan cannot sign in (its id is absent from the identity store), so
  // moving its role to the live account grants nothing anybody could exercise
  // today — it restores what the migration detached.
  for (const row of rows) {
    const legacyEmail = await legacyEmailForId(sql, row.user_id);
    if (!legacyEmail || legacyEmail !== email) continue;
    const role = row.role === SUPER_ADMIN_ROLE ? SUPER_ADMIN_ROLE : ADMIN_ROLE;
    const bound = await bindOwner(sql, {
      userId,
      email,
      source: "legacy_role_transfer",
      previousUserId: row.user_id,
      role,
    });
    if (!bound) return refusal("write_failed");
    await options.audit?.({
      action: "owner.recovered",
      detail: { source: "legacy_role_transfer", previousUserId: row.user_id, role },
    });
    return { ok: true, reason: "bound", role, source: "legacy_role_transfer", previousUserId: row.user_id };
  }

  // ── 5. Proof 2: the deployment names this address as the owner. ─────────
  const ownerEmails = configuredOwnerEmails();
  if (!ownerEmails.has(email)) return refusal("not_named");
  // Uniqueness: an address the caller does not exclusively hold cannot prove
  // identity, so a second account holding it ends the attempt.
  const holder = await directory.byEmail(email);
  if (!holder || holder.id !== userId) return refusal("address_not_unique");

  const bound = await bindOwner(sql, {
    userId,
    email,
    source: "owner_email_binding",
    previousUserId: null,
    role: SUPER_ADMIN_ROLE,
  });
  if (!bound) return refusal("write_failed");
  await options.audit?.({
    action: "owner.recovered",
    detail: { source: "owner_email_binding", previousUserId: null, role: SUPER_ADMIN_ROLE },
  });
  return { ok: true, reason: "bound", role: SUPER_ADMIN_ROLE, source: "owner_email_binding", previousUserId: null };
}

/**
 * Write the row and the binding together.
 *
 * The `admin_users` insert is `on conflict do nothing` and the binding is only
 * accepted when this call is the one that wrote it, so two racing requests can
 * never both believe they own the platform: exactly one binding row exists and
 * it names one account.
 */
async function bindOwner(
  sql: Sql,
  input: {
    userId: string;
    email: string;
    source: OwnerBindingSource;
    previousUserId: string | null;
    role: string;
  },
): Promise<boolean> {
  const binding: OwnerBinding = {
    userId: input.userId,
    email: input.email,
    boundAt: new Date().toISOString(),
    source: input.source,
    previousUserId: input.previousUserId,
    role: input.role === SUPER_ADMIN_ROLE ? SUPER_ADMIN_ROLE : ADMIN_ROLE,
  };
  try {
    await sql`
      insert into admin_users (user_id, created_by, note, role)
      values (
        ${input.userId},
        ${`system:owner-binding:${input.source}`},
        ${input.previousUserId ? "نقل صلاحية حساب ما قبل الترحيل" : "ربط حساب المالك"},
        ${input.role}
      )
      on conflict (user_id) do nothing
    `;
    const inserted = await sql<{ key: string }>`
      insert into site_settings (key, value, updated_at)
      values (${OWNER_BINDING_KEY}, ${JSON.stringify(binding)}::jsonb, now())
      on conflict (key) do nothing
      returning key
    `;
    if (!inserted.length) {
      // Someone bound first. Honour that row only when it is ours.
      const current = await readOwnerBinding(sql);
      return current?.userId === input.userId;
    }
    return true;
  } catch {
    return false;
  }
}
