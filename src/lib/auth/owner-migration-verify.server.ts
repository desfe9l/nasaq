/**
 * Owner identity migration — verification and integrity reporting.
 *
 * The reconciliation (`owner-reconciliation.server.ts`) MOVES the owner's
 * records; this module PROVES the move is complete and that nothing else
 * broke. It is read-only: it never writes a row, never calls a provider, and
 * never returns a value an operator could not safely paste into a ticket —
 * every user id is a one-way fingerprint (`sha256(id)[:12]`), emails are
 * masked, licence keys and hashes are never selected at all.
 *
 * What it checks, and why each one matters:
 *
 *   · `identity_store`        — the store that decides "orphan vs live" must
 *                               answer before any verdict is trusted. The
 *                               whole report fails closed without it.
 *   · `owner_binding`         — the durable proof of WHO the canonical owner
 *                               is. Without it there is nothing to verify a
 *                               migration against.
 *   · `binding_admin_row`     — the bound account must actually hold an
 *                               `admin_users` row, or authority and the
 *                               binding have drifted apart.
 *   · `orphan_rows`           — rows still keyed to the owner's proven
 *                               pre-migration ids. After reconciliation this
 *                               must be 0 in every owned table.
 *   · `duplicate_live_subscriptions` — more than one ACTIVE/SUSPENDED row per
 *                               account would make the entitlement read
 *                               ambiguous.
 *   · `duplicate_license_keys`— one key hash must exist exactly once, or a
 *                               claim/validation could bind either copy.
 *   · `subscription_plan`     — every subscription must reference a plan that
 *                               exists, or the account view cannot render it.
 *   · `owner_license_scope`   — the canonical owner's Keygen rows must scope
 *                               to the owner's id (directly or via the
 *                               server-written `ownerReboundFrom` trail), or
 *                               the editor and the console disagree.
 *   · `rebound_marker_live`   — an `ownerReboundFrom` id that RESOLVES in the
 *                               identity store would name a live account as
 *                               someone's past self: refused anywhere it
 *                               appears.
 *   · `license_orphan_owner`  — ACTIVE licences owned by an id that resolves
 *                               to nothing and is NOT a proven orphan of the
 *                               bound owner. Historical rows from customers
 *                               who never returned are expected (report only,
 *                               never auto-fixed); a count the operator can
 *                               eyeball.
 *   · `unowned_active_license`— ACTIVE licences with no owner at all. Some
 *                               are legitimate unissued inventory; reported,
 *                               severity "warn", never silently "fixed".
 *   · `orphan_admin_rows`     — `admin_users` rows whose id no longer
 *                               resolves. Expected legacy state after a
 *                               migration; reported so the operator can see
 *                               the retired authority, never deleted here.
 *
 * The same module backs `scripts/owner-migration-verify.mjs` (operator CLI),
 * `scripts/owner-migration-run.mjs` (before/after proof around the move), and
 * the regression suite, so the numbers an operator reads are the numbers the
 * tests pin.
 */
import { createHash } from "node:crypto";
import type { Sql } from "../db.ts";
import { keygenScopeSatisfied, reboundFromIds } from "../license/scope.ts";
import {
  authIdentityDirectory,
  readOwnerBinding,
  type IdentityDirectory,
  type OwnerBinding,
} from "./owner-binding.server.ts";
import {
  provenOwnerOrphanIds,
  resolveOwnershipTargets,
} from "./owner-reconciliation.server.ts";
import { isSafeIdentifier } from "./owner-schema-sweep.server.ts";
import { adminRowsFor } from "./owner-admin-rebind.server.ts";

export type CheckSeverity = "fail" | "warn" | "info";

export type IntegrityCheck = {
  /** Stable machine name — safe to assert on. */
  name: string;
  /** Failing-grade checks turn the report (and the CLI exit code) red. */
  severity: CheckSeverity;
  /** Did this check pass? Info checks always pass; they exist to be read. */
  ok: boolean;
  /** The magnitude of what was found (rows, ids). Never an id itself. */
  count: number;
  /** Short operator-facing explanation. No ids, no addresses. */
  detail: string;
};

/** One-way, non-reversible stand-in for a user id in any report. */
export function fingerprint(id: string): string {
  return createHash("sha256").update(`nasaq-owner-verify:${id}`).digest("hex").slice(0, 12);
}

export type OwnerMigrationReport = {
  at: string;
  /** Which SQL backend answered ("postgres" vs the local fallback). */
  identityStoreReady: boolean;
  binding: {
    present: boolean;
    role: string | null;
    source: string | null;
    /** Fingerprint of the canonical owner id — never the id. */
    ownerFingerprint: string | null;
  };
  /** Fingerprints of the proven orphaned pre-migration ids. */
  orphans: string[];
  /** Rows the canonical owner currently holds, per owned table. */
  canonicalRows: Record<string, number>;
  /** Rows still held by proven orphan ids, per owned table (target: all 0). */
  orphanRows: Record<string, number>;
  checks: IntegrityCheck[];
  /** True when no "fail"-severity check failed. */
  ok: boolean;
  /** Count of "warn"-severity findings (never blocks `ok`). */
  warnings: number;
};

function check(
  name: string,
  severity: CheckSeverity,
  ok: boolean,
  count: number,
  detail: string,
): IntegrityCheck {
  return { name, severity, ok, count, detail };
}

/**
 * Rows keyed to ANY of `ids`, per owned table, in one pass per table. An
 * empty id set short-circuits to all-zero without touching the database.
 */
export async function ownershipRowsByTable(
  sql: Sql,
  ids: readonly string[],
): Promise<Record<string, number>> {
  const uniqueIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const counts: Record<string, number> = {};
  if (!uniqueIds.length) return counts;
  const joined = uniqueIds.join("\n");
  /*
   * The SAME target set the reconciliation moves — resolved from the live
   * schema, not from a list kept in parallel with it. A verification that
   * reads a narrower list than the migration writes is how a split graph
   * passes its own audit.
   */
  const targets = await resolveOwnershipTargets(sql);
  for (const { table, column } of targets) {
    if (!isSafeIdentifier(table) || !isSafeIdentifier(column)) continue;
    const label = column === "user_id" ? table : `${table}.${column}`;
    try {
      const rows = await sql.query<{ n: number }>(
        `select count(*)::int as n from "${table}"
          where "${column}" = any(string_to_array($1, E'\\n'))`,
        [joined],
      );
      counts[label] = Number(rows[0]?.n ?? 0);
    } catch {
      counts[label] = -1; // table unreadable — reported, never hidden
    }
  }
  return counts;
}

type LicenseRow = { id: string; user_id: string | null; status: string; metadata: unknown };

async function collectFailures(
  sql: Sql,
  binding: OwnerBinding | null,
  orphans: readonly string[],
  directory: IdentityDirectory | null,
  orphanCounts: Record<string, number>,
): Promise<IntegrityCheck[]> {
  const checks: IntegrityCheck[] = [];

  // ── identity store ─────────────────────────────────────────────────────
  const identityReady = Boolean(directory?.ready);
  checks.push(
    check(
      "identity_store",
      "fail",
      identityReady,
      identityReady ? 1 : 0,
      identityReady
        ? "Identity store answered; orphan/live verdicts are trustworthy."
        : "Identity store did not answer. Orphan/live cannot be told apart — every verdict here must be treated as unread, not as clean.",
    ),
  );

  // ── owner binding ──────────────────────────────────────────────────────
  checks.push(
    check(
      "owner_binding",
      "fail",
      Boolean(binding),
      binding ? 1 : 0,
      binding
        ? `Durable owner binding present (${binding.source}, role ${binding.role}).`
        : "No durable owner binding. The owner must sign in once so the recovery flow writes it, or the deployment's owner configuration must be repaired first.",
    ),
  );

  if (binding) {
    const adminRows = await sql<{ n: number }>`
      select count(*)::int as n from admin_users where user_id = ${binding.userId}
    `;
    const has = Number(adminRows[0]?.n ?? 0) > 0;
    checks.push(
      check(
        "binding_admin_row",
        "fail",
        has,
        Number(adminRows[0]?.n ?? 0),
        has
          ? "The bound account holds its admin_users row — authority and records name the same id."
          : "The binding names an account with no admin_users row. Authority and the durable binding have drifted apart.",
      ),
    );
  }

  if (!identityReady) return checks;

  // ── orphan rows (counts precomputed by the caller — one source) ────────
  const orphanTotal = Object.values(orphanCounts).reduce((sum, n) => sum + Math.max(0, n), 0);
  const orphanUnreadable = Object.values(orphanCounts).some((n) => n < 0);
  if (binding) {
    checks.push(
      check(
        "orphan_rows",
        "fail",
        orphanTotal === 0 && !orphanUnreadable,
        orphanTotal,
        orphanTotal === 0 && !orphanUnreadable
          ? "No owned-record table still keys a row to a proven pre-migration id."
          : orphanUnreadable
            ? "At least one owned table could not be read — the state cannot be certified."
            : `${orphanTotal} row(s) still belong to the owner's orphaned pre-migration id(s). Run the reconciliation (npm run migrate:owner).`,
      ),
    );
  }

  // ── structural integrity ───────────────────────────────────────────────
  const [dupSubs, dupKeys, planMismatch] = await Promise.all([
    sql<{ n: number }>`
      select count(*)::int as n from (
        select user_id from subscriptions
        where status in ('ACTIVE', 'SUSPENDED')
        group by user_id having count(*) > 1
      ) d
    `,
    sql<{ n: number }>`
      select count(*)::int as n from (
        select key_hash from licenses group by key_hash having count(*) > 1
      ) d
    `,
    sql<{ n: number }>`
      select count(*)::int as n from subscriptions s
      where not exists (select 1 from plans p where p.id = s.plan_id)
    `,
  ]);
  const dupSubCount = Number(dupSubs[0]?.n ?? 0);
  const dupKeyCount = Number(dupKeys[0]?.n ?? 0);
  const planMismatchCount = Number(planMismatch[0]?.n ?? 0);
  checks.push(
    check(
      "duplicate_live_subscriptions",
      "fail",
      dupSubCount === 0,
      dupSubCount,
      dupSubCount === 0
        ? "At most one live subscription row per account."
        : `${dupSubCount} account(s) hold more than one ACTIVE/SUSPENDED subscription — the entitlement read is ambiguous.`,
    ),
    check(
      "duplicate_license_keys",
      "fail",
      dupKeyCount === 0,
      dupKeyCount,
      dupKeyCount === 0
        ? "Every licence key hash exists exactly once."
        : `${dupKeyCount} key hash(es) exist in more than one row — a validation could bind the wrong copy.`,
    ),
    check(
      "subscription_plan",
      "fail",
      planMismatchCount === 0,
      planMismatchCount,
      planMismatchCount === 0
        ? "Every subscription references an existing plan."
        : `${planMismatchCount} subscription(s) name a plan that does not exist.`,
    ),
  );

  // ── licence scope and ownership ────────────────────────────────────────
  const licenses = await sql.query<LicenseRow>(
    `select id, user_id, status, metadata from licenses`,
  );
  let ownerScopeMismatch = 0;
  let scopeMismatchOther = 0;
  let reboundLive = 0;
  let unresolvedOwnerActive = 0;
  let unownedActive = 0;
  const orphanSet = new Set(orphans);
  const canonicalId = binding?.userId ?? null;
  for (const row of licenses) {
    const metadata =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    for (const marker of reboundFromIds(metadata)) {
      if (canonicalId && marker === canonicalId) continue;
      if (await directory?.lookup(marker)) reboundLive += 1;
    }
    if (!row.user_id) {
      if (row.status === "ACTIVE") unownedActive += 1;
      continue;
    }
    const source = (metadata as Record<string, string>).source;
    if (source === "keygen" && !keygenScopeSatisfied(metadata, row.user_id)) {
      if (canonicalId && row.user_id === canonicalId) ownerScopeMismatch += 1;
      else scopeMismatchOther += 1;
      continue;
    }
    if (row.status !== "ACTIVE") continue;
    if (orphanSet.has(row.user_id)) continue; // already counted by orphan_rows
    if (canonicalId && row.user_id === canonicalId) continue;
    // Informational only: a pre-migration customer's row whose account has
    // not signed in since is expected state, never auto-reassigned.
    if (!(await directory?.lookup(row.user_id))) unresolvedOwnerActive += 1;
  }
  checks.push(
    check(
      "owner_license_scope",
      "fail",
      ownerScopeMismatch === 0,
      ownerScopeMismatch,
      ownerScopeMismatch === 0
        ? "Every Keygen licence the canonical owner holds is scoped to the owner's id (directly or via the server-written rebound trail)."
        : `${ownerScopeMismatch} of the canonical owner's Keygen licence(s) scope to an id other than the owner — the editor and the console would disagree.`,
    ),
    check(
      "rebound_marker_live",
      "fail",
      reboundLive === 0,
      reboundLive,
      reboundLive === 0
        ? "No rebound marker names a live account."
        : `${reboundLive} rebound marker(s) resolve to a LIVE account — a marker must only ever name orphaned ids. Do not run the app until this is investigated.`,
    ),
    check(
      "license_scope_mismatch_other",
      "warn",
      true,
      scopeMismatchOther,
      scopeMismatchOther === 0
        ? "No other account's licence carries a scope marker that names someone else."
        : `${scopeMismatchOther} licence(s) held by other accounts carry a scope marker naming a different id. The app already refuses these rows; reported for operator review, never auto-fixed.`,
    ),
    check(
      "license_orphan_owner",
      "warn",
      true,
      unresolvedOwnerActive,
      unresolvedOwnerActive === 0
        ? "No ACTIVE licence is owned by an id that resolves to nothing and is not a proven owner orphan."
        : `${unresolvedOwnerActive} ACTIVE licence(s) belong to unresolvable, non-orphan ids — expected for pre-migration customers who have not returned; their rows wait untouched.`,
    ),
    check(
      "unowned_active_license",
      "warn",
      true,
      unownedActive,
      unownedActive === 0
        ? "Every ACTIVE licence names an owner."
        : `${unownedActive} ACTIVE licence(s) have no owner — legitimate when they are unissued inventory; review otherwise.`,
    ),
  );

  // ── retired legacy authority ───────────────────────────────────────────
  const adminRows = await sql<{ user_id: string }>`select user_id from admin_users`;
  let orphanAdmins = 0;
  for (const row of adminRows) {
    if (canonicalId && row.user_id === canonicalId) continue;
    if (!(await directory?.lookup(row.user_id))) orphanAdmins += 1;
  }
  checks.push(
    check(
      "orphan_admin_rows",
      "info",
      true,
      orphanAdmins,
      orphanAdmins === 0
        ? "No admin_users row names an unresolvable id."
        : `${orphanAdmins} admin_users row(s) name id(s) that no longer resolve — retired legacy authority. Kept for audit; never granted while the id cannot sign in.`,
    ),
  );

  /*
   * ── the legacy identity holds NO authority ───────────────────────────────
   *
   * The check above is a census of every unresolvable admin row, including
   * strangers' (historical, expected). THIS one is the migration's own
   * assertion and therefore fails the report: after the move, not one
   * `admin_users` row may name an id the binding proved is this owner's past
   * self. Two administrator identities for one human is the split-brain the
   * migration exists to end.
   */
  if (binding) {
    const legacyAdmin = await adminRowsFor(sql, orphans);
    checks.push(
      check(
        "legacy_owner_authority",
        "fail",
        legacyAdmin === 0,
        legacyAdmin,
        legacyAdmin === 0
          ? "The owner's pre-migration id(s) hold no admin_users row — authority is single and canonical."
          : `${legacyAdmin} admin_users row(s) still name the owner's pre-migration id(s). Authority is split; run the migration.`,
      ),
    );
  }

  return checks;
}

/**
 * Full migration-integrity report. Read-only and secret-free.
 *
 * `directory` defaults to the production AuthStore-backed directory; the
 * regression suite passes a stubbed one. Any directory failure degrades the
 * report to "cannot certify" (fail) rather than "clean" — STEP 11 of the
 * migration contract: never claim a verified state that was not verified.
 */
export async function collectOwnerMigrationReport(
  sql: Sql,
  options: { directory?: IdentityDirectory } = {},
): Promise<OwnerMigrationReport> {
  const directory = options.directory ?? (await authIdentityDirectory());
  let binding: OwnerBinding | null = null;
  try {
    binding = await readOwnerBinding(sql);
  } catch {
    binding = null;
  }
  let orphans: string[] = [];
  if (binding && directory.ready) {
    try {
      orphans = await provenOwnerOrphanIds(sql, binding, directory);
    } catch {
      orphans = [];
    }
  }

  const canonicalRows = binding ? await ownershipRowsByTable(sql, [binding.userId]) : {};
  const orphanRows = orphans.length ? await ownershipRowsByTable(sql, orphans) : {};
  const checks = await collectFailures(sql, binding, orphans, directory, orphanRows);

  const warnings = checks.filter((c) => c.severity === "warn" && c.count > 0).length;
  const ok = checks.every((c) => c.severity !== "fail" || c.ok);
  return {
    at: new Date().toISOString(),
    identityStoreReady: directory.ready,
    binding: {
      present: Boolean(binding),
      role: binding?.role ?? null,
      source: binding?.source ?? null,
      ownerFingerprint: binding ? fingerprint(binding.userId) : null,
    },
    orphans: orphans.map(fingerprint),
    canonicalRows,
    orphanRows,
    checks,
    ok,
    warnings,
  };
}
