/**
 * Live production authority/entitlement/security verification — the shared core.
 *
 * This module is the ONE implementation of the live identity verification. It
 * is called from two places and nowhere else:
 *
 *   · `scripts/owner-live-verify.mjs` — `npm run verify:owner-live`, the
 *     operator CLI (prints the table, maps the verdict to an exit code);
 *   · the deployment runtime (`/api/ops/owner-recovery`, stage `identity`),
 *     which has the same configuration in `process.env` and returns the
 *     sanitized report as JSON.
 *
 * It runs the SAME server resolvers the deployed app runs, against the REAL
 * production state, and proves the identity chain agrees everywhere:
 *
 *   AUTH ID = binding owner = database owner = licence/subscription owner
 *           = admin owner = editor entitlement owner
 *
 * Probes:
 *   · identity store answers · durable binding present
 *   · the canonical id RESOLVES in the identity store (it is really the
 *     sign-in account)
 *   · admin_users row for the canonical id (SUPER_ADMIN)
 *   · isAdminCaller / isSuperAdminIdentity accept the canonical identity
 *   · getAuthorizationContext(canonical) → isOwner + isAdmin + LIFETIME
 *     entitlements — the exact object the editor consumes
 *   · the account view (getAccount) reports admin
 *   · every proven orphan id resolves to NOTHING (cannot authenticate);
 *     reconciliation refuses them as callers; they hold no licence claims
 *   · a synthetic stranger: not admin, not owner, reconciliation refuses,
 *     no proven-legacy prefixes (storage rebound acceptance list is empty)
 *   · an existing live ADMIN (staff) row, when one resolves: is admin, is
 *     NOT super-admin-by-binding unless its role says so — role separation
 *     survives
 *
 * Never returns a raw id, address, key or hash — fingerprints and verdicts.
 */
import type { Sql } from "../db.ts";

export type LiveVerifyCheck = { ok: boolean; name: string; detail: string };

export type LiveVerifyReport = {
  ok: boolean;
  failures: number;
  ownerFingerprint: string;
  orphans: string[];
  checks: LiveVerifyCheck[];
};

export type LiveVerifyResult =
  | { status: "uncertified"; reason: "store_unavailable" | "no_binding"; error: string }
  | { status: "verified" | "failed"; report: LiveVerifyReport };

/** Everything that must hold before a single probe is attempted. */
export async function runOwnerLiveVerify(sql: Sql): Promise<LiveVerifyResult> {
  const [bindingModule, reconciliation, adminIdentity, superAdmin, authorization, entitlement, verify] =
    await Promise.all([
      import("./owner-binding.server.ts"),
      import("./owner-reconciliation.server.ts"),
      import("./admin-identity.server.ts"),
      import("./super-admin.server.ts"),
      import("./authorization.server.ts"),
      import("../commercial/entitlement.server.ts"),
      import("./owner-migration-verify.server.ts"),
    ]);
  const { LICENSE_ENTITLEMENTS } = await import("../license/types.ts");

  const directory = await bindingModule.authIdentityDirectory();
  if (!directory.ready) {
    return { status: "uncertified", reason: "store_unavailable", error: "The identity store did not answer (fail closed)." };
  }
  const binding = await bindingModule.readOwnerBinding(sql);
  if (!binding) {
    return {
      status: "uncertified",
      reason: "no_binding",
      error:
        "No durable owner binding — the owner must sign in once (recovery writes it); nothing can be certified.",
    };
  }

  const canonical = binding.userId;
  const canonicalAccount = await directory.lookup(canonical);
  /** Extra account fields the directory may carry at runtime (verified flag). */
  const canonicalVerified =
    (canonicalAccount as { emailVerified?: boolean } | null)?.emailVerified === true;
  const canonicalIdentity = {
    id: canonical,
    email: binding.email ?? canonicalAccount?.email ?? null,
    emailVerified: canonicalVerified,
  };
  const orphans = await reconciliation.provenOwnerOrphanIds(sql, binding, directory);
  const stranger = `verify-stranger-${Date.now().toString(36)}`;
  const strangerIdentity = { id: stranger, email: null, emailVerified: false };

  const checks: LiveVerifyCheck[] = [];
  const probe = async (name: string, fn: () => Promise<string>) => {
    try {
      const detail = await fn();
      checks.push({ ok: true, name, detail });
    } catch (error) {
      checks.push({
        ok: false,
        name,
        detail: (error as { message?: string })?.message ?? String(error),
      });
    }
  };

  await probe(
    "identity_store_answers",
    async () => "the AuthStore resolved and answered identity lookups",
  );
  await probe("canonical_account_is_live", async () => {
    if (!canonicalAccount)
      throw new Error(
        "the canonical id does NOT resolve in the identity store — the owner could not sign in",
      );
    return "the canonical id is a live account in the identity store";
  });
  await probe("canonical_admin_row", async () => {
    const rows = await sql<{ role: string }>`
      select role from admin_users where user_id = ${canonical} limit 1
    `;
    if (!rows.length) throw new Error("no admin_users row for the canonical id");
    if (rows[0].role !== "SUPER_ADMIN")
      throw new Error(`canonical admin row role is ${rows[0].role}, expected SUPER_ADMIN`);
    return `admin_users row present (SUPER_ADMIN)`;
  });
  await probe("admin_resolver_accepts", async () => {
    if (!(await adminIdentity.isAdminCaller(sql, canonicalIdentity)))
      throw new Error("isAdminCaller refused the canonical identity");
    return "isAdminCaller — the one admin resolver — accepts the canonical identity";
  });
  await probe("super_admin_resolver_accepts", async () => {
    if (!(await superAdmin.isSuperAdminIdentity(sql, canonicalIdentity)))
      throw new Error("isSuperAdminIdentity refused the canonical identity");
    return "the super-admin/owner resolver accepts via the durable binding";
  });
  await probe("editor_entitlement_object", async () => {
    const access = await authorization.getAuthorizationContext(canonicalIdentity);
    if (!access.isOwner)
      throw new Error("getAuthorizationContext does not see the canonical id as owner");
    if (!access.isAdmin)
      throw new Error("getAuthorizationContext does not see the canonical id as admin");
    if (
      access.entitlements.advanced_export !== true ||
      access.entitlements.premium_templates !== true
    ) {
      throw new Error("entitlement features are not the full set");
    }
    if (JSON.stringify(access.entitlements) !== JSON.stringify(LICENSE_ENTITLEMENTS.LIFETIME)) {
      throw new Error("entitlements disagree with the owner LIFETIME policy");
    }
    return "the exact object the editor consumes: isOwner + isAdmin + full LIFETIME entitlements";
  });
  await probe("account_view_admin", async () => {
    const account = await entitlement.getAccount(
      sql,
      canonical,
      new Date(),
      canonicalIdentity,
    );
    if (!account.isAdmin)
      throw new Error("the account view does not report the canonical id as admin");
    return `the account view reports admin=true (status ${account.status})`;
  });
  await probe("licence_scope_canonical", async () => {
    const rows = await sql.query<{ metadata: Record<string, unknown> | null }>(
      `select metadata from licenses where user_id = $1 and metadata->>'source' = 'keygen'`,
      [canonical],
    );
    const { keygenScopeSatisfied } = await import("../license/scope.ts");
    for (const row of rows) {
      if (!keygenScopeSatisfied(row.metadata, canonical)) {
        throw new Error("a Keygen row the owner holds is not scoped to the owner");
      }
    }
    return `every Keygen licence the owner holds (${rows.length}) is scoped to the canonical owner`;
  });

  for (const orphan of orphans) {
    const fp = verify.fingerprint(orphan);
    await probe(`orphan_cannot_authenticate:${fp}`, async () => {
      if (await directory.lookup(orphan)) throw new Error("an orphan id RESOLVES — it is not an orphan");
      return "resolves to nothing — no session can ever exist for it";
    });
    await probe(`orphan_reconciliation_refused:${fp}`, async () => {
      const result = await reconciliation.reconcileOwnerForSession(
        sql,
        { id: orphan, email: binding.email ?? null },
        directory,
      );
      if (result !== null) throw new Error("reconciliation accepted an orphan as a caller");
      return "reconciliation refuses the orphan as a caller";
    });
  }
  await probe("orphan_claims_none", async () => {
    if (!orphans.length) return "no proven orphans — nothing held";
    const rows = await sql.query<{ n: number }>(
      `select count(*)::int as n from license_claims where user_id = any(string_to_array($1, E'\\n'))`,
      [orphans.join("\n")],
    );
    const n = Number(rows[0]?.n ?? 0);
    if (n !== 0) throw new Error(`${n} licence claim(s) still belong to orphan ids`);
    return "no licence claim is held by an orphan id";
  });

  await probe("stranger_not_admin", async () => {
    const access = await authorization.getAuthorizationContext(strangerIdentity);
    if (access.isAdmin || access.isOwner)
      throw new Error("a stranger resolved as admin/owner");
    return "a random identity is neither admin nor owner";
  });
  await probe("stranger_reconciliation_refused", async () => {
    const result = await reconciliation.reconcileOwnerForSession(
      sql,
      { id: stranger, email: "stranger@example.invalid" },
      directory,
    );
    if (result !== null) throw new Error("reconciliation accepted a stranger");
    return "no records can follow a stranger";
  });
  await probe("stranger_no_storage_rebound", async () => {
    const prefixes = await bindingModule.provenLegacyUserIds(sql, stranger);
    if (prefixes.length !== 0)
      throw new Error("a stranger received proven pre-migration prefixes");
    return "the storage rebound acceptance list is empty for anyone but the bound owner";
  });

  // staff role separation: a live ADMIN row must not become the owner
  const staffRows = await sql<{ user_id: string }>`
    select user_id from admin_users where role = 'ADMIN'
  `;
  for (const row of staffRows) {
    const account = await directory.lookup(row.user_id);
    if (!account) continue; // retired staff rows are reported by verify:owner
    const fp = verify.fingerprint(row.user_id);
    await probe(`staff_role_separation:${fp}`, async () => {
      const identity = {
        id: row.user_id,
        email: account.email,
        emailVerified: (account as { emailVerified?: boolean }).emailVerified === true,
      };
      const bound = await bindingModule.readOwnerBinding(sql);
      if (bound?.userId === row.user_id)
        return "this staff id IS the bound owner (unexpected but explicit) — skipped";
      const superResult = await superAdmin.isSuperAdminIdentity(sql, identity);
      if (superResult)
        throw new Error("a staff ADMIN resolves as super-admin — reconciliation must never promote");
      return "staff keep their own level; the binding never promoted them";
    });
  }

  const failures = checks.filter((c) => !c.ok).length;
  return {
    status: failures ? "failed" : "verified",
    report: {
      ok: failures === 0,
      failures,
      ownerFingerprint: verify.fingerprint(canonical),
      orphans: orphans.map(verify.fingerprint),
      checks,
    },
  };
}
