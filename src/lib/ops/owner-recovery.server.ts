/**
 * The temporary, production-only owner recovery operation — the core.
 *
 * ## Why this exists
 *
 * The production recovery has to run where the production configuration lives:
 * the deployment's own `process.env`. The operator CLI (`npm run migrate:owner`
 * and the verification scripts) needs the same `DATABASE_URL`, R2 trio and
 * Keygen token handed to it from outside — which is exactly what a runner
 * without the deployment's configuration cannot do. This module lets the
 * DEPLOYMENT run the identical guarded operations in-process and answer with
 * the sanitized report, so no secret ever leaves the runtime.
 *
 * ## What it is not
 *
 *   · it is NOT a new authorization path — the HTTP layer above it requires a
 *     real session that passes the SAME super-admin/owner resolver the admin
 *     console uses, plus the durable owner binding for the mutating stages;
 *   · it is NOT a second implementation — every stage calls the one module the
 *     equivalent `npm run …` command calls;
 *   · it is NOT open to ordinary users — the route refuses anyone who is not
 *     the canonical owner, and the response carries fingerprints/counts only.
 *
 * ## Fail-closed rules (see `ownerOpsRuntimeVerdict`)
 *
 *   1. `VERCEL_ENV` must be exactly `production` — a Preview deployment, a
 *      local dev server or a bare runner refuses before doing anything;
 *   2. `DATABASE_URL` must be present — the operation refuses to run against
 *      anything but the deployment's managed Postgres;
 *   3. the identity store must answer — orphans and live accounts cannot be
 *      told apart otherwise, and the reconciliation refuses to guess.
 *
 * ## One-shot (the "disable after success" requirement)
 *
 * `migrate` records `OWNER_OPS_COMPLETED_KEY` in `site_settings` once the move
 * AND the post-migration verification both pass. From that moment every
 * mutating stage is refused permanently with `already_completed` — the
 * operation disables itself; no environment change and no redeploy is needed
 * to make it inert. Verification (read-only) stages stay available so the
 * evidence can be re-read at any time.
 */
import type { Sql } from "../db.ts";

/** Every stage the operation understands. */
export const OWNER_OPS_STAGES = [
  /**
   * Bootstrap: re-bind administrator authority to the CALLER.
   *
   * Without this the operation could not be started by the person it exists
   * for. Every other stage requires the caller to already pass the
   * super-admin resolver — which is exactly what the identity migration
   * broke — so the recovery was reachable only by an account that did not
   * need it. The stage itself grants nothing: it delegates to
   * `recoverOwnerAuthority`, which refuses while ANY live administrator
   * exists, requires either an orphaned admin row carrying the caller's own
   * address or the deployment naming that address as the owner, and writes
   * once.
   */
  "recover",
  /** `npm run migrate:owner -- --dry-run` — what WOULD move; writes nothing. */
  "plan",
  /** `npm run migrate:owner` — the guarded move + stability re-check. */
  "migrate",
  /**
   * Move the owner's objects onto the canonical prefix, in bounded resumable
   * batches (copy → verify → re-point the row → delete the source).
   */
  "storage-rekey",
  /** The sanitized final assertion: canonical owner vs legacy identity. */
  "report",
  /** `npm run verify:owner` + `npm run verify:owner-live` (read-only). */
  "identity",
  /** `npm run verify:provider` — Keygen, read-only at the provider. */
  "provider",
  /** `npm run storage:verify` — object + metadata round trip, self-cleaning. */
  "storage",
  /** `npm run probe:admin-mutations` — synthetic rows, cleaned up. */
  "admin-probe",
  /** identity + provider + storage in one request (read-only). */
  "battery",
] as const;

export type OwnerOpsStage = (typeof OWNER_OPS_STAGES)[number];

/** Stages that write anything at all (synthetic rows included). */
export const OWNER_OPS_MUTATING_STAGES: readonly OwnerOpsStage[] = [
  "migrate",
  "admin-probe",
  "storage-rekey",
];

/**
 * Stages that do NOT require the caller to already hold owner authority.
 *
 * Exactly one: the bootstrap. It is still production-only, still
 * same-origin, still authenticated, still rate-limited and still audited —
 * and the module it calls applies the full recovery guard. Everything else
 * continues to demand the canonical bound owner.
 */
export const OWNER_OPS_BOOTSTRAP_STAGES: readonly OwnerOpsStage[] = ["recover"];

/**
 * The stages that must never run twice.
 *
 * `migrate` MOVES ownership records, so it is one-shot: once it has completed
 * and its post-migration verification passed, it is refused permanently.
 *
 * `admin-probe` is deliberately NOT here. It touches only synthetic
 * `owner-probe-<run>-…` rows that it deletes in the same run, and it is part
 * of the verification battery the migration is judged by — blocking it after
 * the move would make "verify the migration" impossible to complete. It keeps
 * every other guard: the canonical bound owner, the super-admin resolver, its
 * confirmation phrase, the rate budget and the audit trail.
 */
export const OWNER_OPS_ONE_SHOT_STAGES: readonly OwnerOpsStage[] = ["migrate"];

/**
 * Confirmation phrase a mutating stage must carry in the request body. It is
 * not a secret and grants nothing — it exists so a stray replay of an old
 * request (or an over-eager button) cannot move ownership records.
 */
export const OWNER_OPS_CONFIRMATIONS: Partial<Record<OwnerOpsStage, string>> = {
  migrate: "MIGRATE-OWNER",
  "admin-probe": "ADMIN-PROBE",
  "storage-rekey": "REKEY-STORAGE",
};

export function isOwnerOpsBootstrapStage(stage: OwnerOpsStage): boolean {
  return OWNER_OPS_BOOTSTRAP_STAGES.includes(stage);
}

/** `site_settings` key: the one-shot marker, written only on full success. */
export const OWNER_OPS_COMPLETED_KEY = "nasaq.owner_ops.completed.v1";
/** `site_settings` key prefix: the last sanitized report of each stage. */
export const OWNER_OPS_REPORT_PREFIX = "nasaq.owner_ops.report.v1.";

/** Upper bound on a persisted report (the ledger is a record, not storage). */
const MAX_STORED_REPORT_BYTES = 32_000;

export type OwnerOpsRuntimeVerdict =
  | { allowed: true }
  | { allowed: false; status: number; reason: string; error: string };

/**
 * Is this the real Vercel Production runtime, with its configuration present?
 * Pure so the refusal paths are unit-testable without a deployment.
 */
export function ownerOpsRuntimeVerdict(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): OwnerOpsRuntimeVerdict {
  if ((env.VERCEL_ENV ?? "").trim() !== "production") {
    return {
      allowed: false,
      status: 403,
      reason: "not_production",
      error: "This operation runs on the Vercel Production deployment only. Nothing was read or written.",
    };
  }
  if (!(env.DATABASE_URL ?? "").trim()) {
    return {
      allowed: false,
      status: 503,
      reason: "configuration_unavailable",
      error: "The production database configuration is not available in this runtime. Nothing was read or written.",
    };
  }
  return { allowed: true };
}

export function isOwnerOpsStage(value: unknown): value is OwnerOpsStage {
  return typeof value === "string" && (OWNER_OPS_STAGES as readonly string[]).includes(value);
}

export function isOwnerOpsMutatingStage(stage: OwnerOpsStage): boolean {
  return OWNER_OPS_MUTATING_STAGES.includes(stage);
}

export type OwnerOpsStagePolicy =
  | { allowed: true }
  | { allowed: false; status: number; reason: string; error: string };

/**
 * Stage policy: mutating stages need their confirmation phrase and are refused
 * forever once the completion marker exists. Pure — the HTTP layer and the
 * tests share this exact decision.
 */
export function ownerOpsStagePolicy(
  stage: OwnerOpsStage,
  input: { completed: boolean; confirm?: unknown },
): OwnerOpsStagePolicy {
  if (OWNER_OPS_ONE_SHOT_STAGES.includes(stage) && input.completed) {
    return {
      allowed: false,
      status: 409,
      reason: "already_completed",
      error:
        "The migration already completed and disabled itself. Read the durable report instead of re-running the move.",
    };
  }
  const required = OWNER_OPS_CONFIRMATIONS[stage];
  if (required && input.confirm !== required) {
    return {
      allowed: false,
      status: 428,
      reason: "confirmation_required",
      error: `This stage moves data; the request must carry the confirmation phrase.`,
    };
  }
  return { allowed: true };
}

/** `site_settings` key: the single-flight claim for a mutating run. */
export const OWNER_OPS_CLAIM_KEY = "nasaq.owner_ops.claim.v1";
/**
 * How long a claim stays valid without being released. A serverless instance
 * can be killed mid-run (a platform timeout, a redeploy), which would leave
 * the claim behind and lock the operation out forever — so a stale claim is
 * taken over, never honoured.
 */
export const OWNER_OPS_CLAIM_TTL_MS = 5 * 60_000;
/** Durable per-session budget, matching the in-memory limiter's intent. */
export const OWNER_OPS_RUNS_PER_MINUTE = 10;

/**
 * Single-flight claim for a mutating stage.
 *
 * The in-memory rate limiter cannot see other serverless instances, so two
 * simultaneous `migrate` calls on two instances would both find "not
 * completed" and both run. This claim is the durable answer: one atomic
 * conditional upsert wins, everyone else is refused while it is live. A stale
 * claim (TTL) is taken over — a killed instance must not brick the operation.
 */
export async function claimOwnerOpsRun(
  sql: Sql,
  input: { stage: string; by: string },
): Promise<{ token: string } | null> {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const value = JSON.stringify({ stage: input.stage, by: input.by, token });
  try {
    const claimed = await sql<{ key: string }>`
      insert into site_settings (key, value, updated_at)
      values (${OWNER_OPS_CLAIM_KEY}, ${value}::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = now()
      where site_settings.updated_at < now() - ${`${Math.round(OWNER_OPS_CLAIM_TTL_MS / 1000)} seconds`}::interval
      returning key
    `;
    return claimed.length === 1 ? { token } : null;
  } catch {
    // A failing claim must not open the gate: fail closed.
    return null;
  }
}

/** Release our own claim (never someone else's). */
export async function releaseOwnerOpsRun(sql: Sql, token: string): Promise<void> {
  try {
    await sql`
      delete from site_settings
       where key = ${OWNER_OPS_CLAIM_KEY} and value->>'token' = ${token}
    `;
  } catch {
    /* a claim that outlives its run expires by TTL */
  }
}

/** Durable count of recent runs by this session, across every instance. */
export async function countOwnerOpsRuns(
  sql: Sql,
  adminUserId: string,
  windowSeconds = 60,
): Promise<number> {
  try {
    const rows = await sql<{ n: number }>`
      select count(*)::int as n from admin_audit_log
       where admin_user_id = ${adminUserId}
         and action = 'owner.ops_run'
         and created_at > now() - ${`${Math.round(windowSeconds)} seconds`}::interval
    `;
    return Number(rows[0]?.n ?? 0);
  } catch {
    /* an unreadable counter is not a licence to run: report as over budget */
    return Number.MAX_SAFE_INTEGER;
  }
}

/** The durable ledger: the one-shot marker and the last report of each stage. */
export type OwnerOpsLedger = {
  completedAt: string | null;
  reports: Array<{ stage: string; at: string; ok: boolean }>;
};

export async function readOwnerOpsLedger(sql: Sql): Promise<OwnerOpsLedger> {
  const rows = await sql<{ key: string; value: unknown; updated_at: string | Date }>`
    select key, value, updated_at from site_settings
     where key = ${OWNER_OPS_COMPLETED_KEY} or key like ${OWNER_OPS_REPORT_PREFIX + "%"}
     order by key
  `;
  let completedAt: string | null = null;
  const reports: OwnerOpsLedger["reports"] = [];
  for (const row of rows) {
    const at = new Date(row.updated_at).toISOString();
    if (row.key === OWNER_OPS_COMPLETED_KEY) {
      const value = row.value as { at?: string } | null;
      completedAt = value?.at ?? at;
      continue;
    }
    const stage = row.key.slice(OWNER_OPS_REPORT_PREFIX.length);
    const value = row.value as { ok?: boolean } | null;
    reports.push({ stage, at, ok: value?.ok === true });
  }
  return { completedAt, reports };
}

async function writeSetting(sql: Sql, key: string, value: unknown): Promise<void> {
  await sql`
    insert into site_settings (key, value, updated_at)
    values (${key}, ${JSON.stringify(value)}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

/** Persist the sanitized report for a stage (bounded, never throws to callers). */
async function persistReport(sql: Sql, stage: OwnerOpsStage, at: string, ok: boolean, result: unknown): Promise<void> {
  try {
    const serialized = JSON.stringify({ at, ok, result });
    await writeSetting(sql, OWNER_OPS_REPORT_PREFIX + stage, {
      at,
      ok,
      result: serialized.length > MAX_STORED_REPORT_BYTES ? { truncated: true } : result,
    });
  } catch {
    /* the ledger is a record, not a guard — a failed write must not undo the work */
  }
}

export type OwnerOpsStageOutcome = {
  stage: OwnerOpsStage;
  ok: boolean;
  at: string;
  /** Sanitized result (fingerprints, counts, verdicts — never a secret). */
  result: unknown;
};

/**
 * Run one stage. The caller has already proven: production runtime, working
 * database, the canonical owner's session, the rate budget and the stage
 * policy. Every stage reuses the module its `npm run …` equivalent uses.
 */
export async function runOwnerOpsStage(
  sql: Sql,
  stage: OwnerOpsStage,
  options: {
    userId: string;
    /** The caller's verified address, when the session carried one. */
    identityEmail?: string | null;
    /** Whether the identity store marks that address verified. */
    identityEmailVerified?: boolean;
    /**
     * The audit sink handed to the reconciliation (`owner.reconciled`), the
     * same one `npm run migrate:owner` passes. The route records the run
     * itself separately (`owner.ops_run`).
     */
    audit?: (entry: {
      action: "owner.reconciled";
      detail: Record<string, string | number | boolean | null>;
    }) => Promise<void>;
  } = { userId: "" },
): Promise<OwnerOpsStageOutcome> {
  const at = new Date().toISOString();

  /** `plan` — the dry run. */
  const plan = async () => {
    const [bindingModule, reconciliation, verify] = await Promise.all([
      import("../auth/owner-binding.server.ts"),
      import("../auth/owner-reconciliation.server.ts"),
      import("../auth/owner-migration-verify.server.ts"),
    ]);
    const directory = await bindingModule.authIdentityDirectory();
    if (!directory.ready) {
      return { ok: false, reason: "store_unavailable", error: "The identity store did not answer — refusing to plan (fail closed)." };
    }
    const binding = await bindingModule.readOwnerBinding(sql);
    if (!binding) {
      return { ok: false, reason: "no_binding", error: "No durable owner binding exists. Nothing was touched." };
    }
    const report = await verify.collectOwnerMigrationReport(sql, { directory });
    const orphans = await reconciliation.provenOwnerOrphanIds(sql, binding, directory);
    const wouldMove = Object.fromEntries(
      Object.entries(report.orphanRows).filter(([, n]) => Number(n) > 0),
    );
    const total = Object.values(wouldMove).reduce((sum: number, n) => sum + Number(n), 0);
    return {
      ok: true,
      owner: verify.fingerprint(binding.userId),
      orphans: orphans.map(verify.fingerprint),
      wouldMove,
      wouldMoveTotal: total,
      canonicalRows: report.canonicalRows,
      orphanRows: report.orphanRows,
      checks: report.checks,
    };
  };

  const identity = async () => {
    const [verify, live] = await Promise.all([
      import("../auth/owner-migration-verify.server.ts"),
      import("../auth/owner-live-verify.server.ts"),
    ]);
    const migration = await verify.collectOwnerMigrationReport(sql);
    const liveOutcome = await live.runOwnerLiveVerify(sql);
    return {
      ok: migration.ok && liveOutcome.status === "verified",
      migration: {
        ok: migration.ok,
        binding: migration.binding,
        orphans: migration.orphans,
        warnings: migration.warnings,
        canonicalRows: migration.canonicalRows,
        orphanRows: migration.orphanRows,
        checks: migration.checks,
      },
      live: liveOutcome.status === "uncertified" ? { status: liveOutcome.status, reason: liveOutcome.reason, error: liveOutcome.error } : liveOutcome.report,
    };
  };

  const provider = async () => {
    const { ownerProviderVerify } = await import("../license/owner-provider-verify.server.ts");
    const outcome = await ownerProviderVerify(sql);
    if (outcome.status === "uncertified") {
      return { ok: false, status: outcome.status, reason: outcome.reason, error: outcome.error };
    }
    return { ok: outcome.report.ok, status: outcome.status, report: outcome.report };
  };

  const storage = async () => {
    const [{ runStorageRoundTrip, runMetadataRoundTrip }, { getObjectStorage }, { buildStorageObjectKey }] =
      await Promise.all([
        import("../storage/verify.server.ts"),
        import("../storage/r2.server.ts"),
        import("../storage/provider.ts"),
      ]);
    const objectRoundTrip = await runStorageRoundTrip();
    if (!objectRoundTrip.configured) {
      return {
        ok: false,
        configured: false,
        missingVariables: objectRoundTrip.missingVariables,
        steps: objectRoundTrip.steps,
      };
    }
    const suffix = Math.random().toString(16).slice(2, 12);
    const userId = options.userId || `ops${suffix}`;
    const objectKey = buildStorageObjectKey({ userId, projectId: null, assetId: `ops${suffix}` });
    const bytes = new TextEncoder().encode(`nasaq-ops-verify-${at}`);
    let written = false;
    let metadata: Awaited<ReturnType<typeof runMetadataRoundTrip>> | null = null;
    try {
      const scoped = getObjectStorage();
      if (scoped) {
        await scoped.put(objectKey, bytes, "text/plain");
        written = true;
        metadata = await runMetadataRoundTrip(sql, userId, objectKey, bytes.byteLength);
      }
    } finally {
      if (written) {
        try {
          await getObjectStorage()?.delete(objectKey);
        } catch {
          /* reported by the round trip above */
        }
      }
    }
    return {
      ok: objectRoundTrip.ok && metadata?.ok !== false,
      configured: true,
      provider: objectRoundTrip.provider,
      steps: [...objectRoundTrip.steps, ...(metadata?.steps ?? [])],
    };
  };

  /**
   * `recover` — the bootstrap. Re-bind authority to the CALLER.
   *
   * Delegates entirely to `recoverOwnerAuthority`: no live administrator may
   * exist, the caller must either hold an orphaned admin row carrying their
   * own address or be named as the owner by the deployment, and the write
   * happens once. The reconciliation that follows a successful bind is the
   * module's own (`reconcileQuietly`), so authority and records move together.
   */
  const recover = async () => {
    const [binding, verify] = await Promise.all([
      import("../auth/owner-binding.server.ts"),
      import("../auth/owner-migration-verify.server.ts"),
    ]);
    const directory = await binding.authIdentityDirectory();
    if (!directory.ready) {
      return {
        ok: false,
        reason: "store_unavailable",
        error: "The identity store did not answer — refusing to bind (fail closed).",
      };
    }
    const identity = {
      id: options.userId,
      email: options.identityEmail ?? null,
      emailVerified: options.identityEmailVerified === true,
    };
    const outcome = await binding.recoverOwnerAuthority(sql, identity, directory, {
      audit: async ({ action, detail }) => {
        await options.audit?.({
          action: action as "owner.reconciled",
          detail: detail as Record<string, string | number | boolean | null>,
        });
      },
    });
    const stored = await binding.readOwnerBinding(sql);
    return {
      ok: outcome.ok,
      reason: outcome.reason,
      error: outcome.ok ? undefined : outcome.error,
      role: outcome.ok ? outcome.role : null,
      bound: Boolean(stored && stored.userId === options.userId),
      owner: verify.fingerprint(options.userId),
    };
  };

  /**
   * `storage-rekey` — move the owner's objects onto the canonical prefix.
   *
   * Bounded and resumable: it reports `remaining`, and the caller runs it
   * again until `complete`. Never deletes a source object before its copy has
   * been read back at the destination.
   */
  const storageRekey = async () => {
    const [bindingModule, reconciliation, ownerStorage, verify] = await Promise.all([
      import("../auth/owner-binding.server.ts"),
      import("../auth/owner-reconciliation.server.ts"),
      import("../storage/owner-storage.server.ts"),
      import("../auth/owner-migration-verify.server.ts"),
    ]);
    const directory = await bindingModule.authIdentityDirectory();
    if (!directory.ready) {
      return { ok: false, reason: "store_unavailable", error: "The identity store did not answer." };
    }
    const binding = await bindingModule.readOwnerBinding(sql);
    if (!binding || binding.userId !== options.userId) {
      return { ok: false, reason: "not_bound_owner", error: "Only the canonical owner may re-key owner storage." };
    }
    const orphans = await reconciliation.provenOwnerOrphanIds(sql, binding, directory);
    const outcome = await ownerStorage.rekeyOwnerStorageObjects(sql, {
      userId: binding.userId,
      orphanIds: orphans,
    });
    const usage = await ownerStorage.ownerStorageUsage(sql, binding.userId);
    return {
      ok: outcome.complete && outcome.failed === 0,
      owner: verify.fingerprint(binding.userId),
      rekey: outcome,
      usage,
    };
  };

  /**
   * `report` — the final, sanitized production assertion.
   *
   * Read-only. Fingerprints, booleans and counts: never an id, address, key,
   * hash or secret.
   */
  const report = async () => {
    const [bindingModule, reconciliation, verify, ownerStorage, adminRebind, superAdmin] =
      await Promise.all([
        import("../auth/owner-binding.server.ts"),
        import("../auth/owner-reconciliation.server.ts"),
        import("../auth/owner-migration-verify.server.ts"),
        import("../storage/owner-storage.server.ts"),
        import("../auth/owner-admin-rebind.server.ts"),
        import("../auth/super-admin.server.ts"),
      ]);
    const directory = await bindingModule.authIdentityDirectory();
    const binding = await bindingModule.readOwnerBinding(sql);
    const canonicalId = binding?.userId ?? options.userId;
    const identity = {
      id: canonicalId,
      email: options.identityEmail ?? null,
      emailVerified: options.identityEmailVerified === true,
    };
    const orphans = binding
      ? await reconciliation.provenOwnerOrphanIds(sql, binding, directory)
      : [];

    const migration = await verify.collectOwnerMigrationReport(sql, { directory });
    const split = await ownerStorage.ownerStorageSplit(sql, canonicalId, orphans);
    const stranded = await ownerStorage.strandedBucketObjects(sql, orphans);
    const legacyAdminRows = await adminRebind.adminRowsFor(sql, orphans);
    const retired = await adminRebind.readRetiredAdminRows(sql);
    const isSuper = await superAdmin.isSuperAdminIdentity(sql, identity);
    const { isAdminCaller } = await import("../auth/admin-identity.server.ts");
    const isAdmin = await isAdminCaller(sql, identity);

    const counts = async (table: string, ids: readonly string[]): Promise<number> => {
      if (!ids.length) return 0;
      try {
        const rows = await sql.query<{ n: number }>(
          `select count(*)::int as n from "${table}"
            where user_id = any(string_to_array($1, E'\\n'))`,
          [ids.join("\n")],
        );
        return Number(rows[0]?.n ?? 0);
      } catch {
        return -1;
      }
    };
    const liveSubscriptions = async (ids: readonly string[]): Promise<number> => {
      if (!ids.length) return 0;
      try {
        const rows = await sql.query<{ n: number }>(
          `select count(*)::int as n from subscriptions
            where user_id = any(string_to_array($1, E'\\n'))
              and status in ('ACTIVE', 'SUSPENDED')`,
          [ids.join("\n")],
        );
        return Number(rows[0]?.n ?? 0);
      } catch {
        return -1;
      }
    };

    const canonical = {
      ownerFingerprint: verify.fingerprint(canonicalId),
      bound: Boolean(binding),
      bindingRole: binding?.role ?? null,
      admin: isAdmin,
      superAdmin: isSuper,
      licenses: await counts("licenses", [canonicalId]),
      subscriptions: await counts("subscriptions", [canonicalId]),
      liveSubscriptions: await liveSubscriptions([canonicalId]),
      projects: await counts("cloud_projects", [canonicalId]),
      templates: await counts("user_templates", [canonicalId]),
      storageAssets: split.canonical.assets,
      storageBytes: split.canonical.bytes,
      storageProjects: split.canonical.projects,
      inheritedPrefixAssets: split.canonical.foreignPrefixAssets,
    };
    const legacy = {
      fingerprints: orphans.map(verify.fingerprint),
      authority: legacyAdminRows > 0,
      adminRows: legacyAdminRows,
      retiredAdminRows: retired.length,
      licenses: await counts("licenses", orphans),
      subscriptions: await counts("subscriptions", orphans),
      liveSubscriptions: await liveSubscriptions(orphans),
      projects: await counts("cloud_projects", orphans),
      templates: await counts("user_templates", orphans),
      storageAssets: split.legacy.assets,
      storageBytes: split.legacy.bytes,
      storageProjects: split.legacy.projects,
      strandedBucketObjects: stranded.supported ? stranded.stranded : null,
    };

    const clean =
      migration.ok &&
      canonical.bound &&
      canonical.admin &&
      !legacy.authority &&
      legacy.licenses <= 0 &&
      legacy.liveSubscriptions <= 0 &&
      legacy.storageAssets <= 0 &&
      legacy.projects <= 0 &&
      legacy.templates <= 0 &&
      canonical.inheritedPrefixAssets === 0;

    return {
      ok: clean,
      canonical,
      legacy,
      checks: migration.checks,
      warnings: migration.warnings,
    };
  };

  const adminProbe = async () => {
    const { runOwnerMutationProbe } = await import("../admin/owner-mutation-probe.server.ts");
    const outcome = await runOwnerMutationProbe(sql);
    if (outcome.status === "uncertified") {
      return { ok: false, status: outcome.status, reason: outcome.reason, error: outcome.error };
    }
    return { ok: outcome.report.ok, status: outcome.status, report: outcome.report };
  };

  let result: unknown;
  let ok = false;

  if (stage === "recover") {
    const outcome = await recover();
    result = outcome;
    ok = outcome.ok;
  } else if (stage === "storage-rekey") {
    const outcome = await storageRekey();
    result = outcome;
    ok = outcome.ok;
  } else if (stage === "report") {
    const outcome = await report();
    result = outcome;
    ok = outcome.ok;
  } else if (stage === "plan") {
    const outcome = await plan();
    result = outcome;
    ok = outcome.ok;
  } else if (stage === "migrate") {
    const planned = await plan();
    if (!planned.ok) {
      result = { planned };
      ok = false;
    } else {
      const [bindingModule, reconciliation, verify] = await Promise.all([
        import("../auth/owner-binding.server.ts"),
        import("../auth/owner-reconciliation.server.ts"),
        import("../auth/owner-migration-verify.server.ts"),
      ]);
      const directory = await bindingModule.authIdentityDirectory();
      const binding = await bindingModule.readOwnerBinding(sql);
      if (!binding) {
        result = { planned, moved: null, error: "No durable owner binding exists. Nothing was touched." };
        ok = false;
      } else {
        const moved = await reconciliation.reconcileBoundOwner(sql, binding, directory, {
          userId: binding.userId,
          email: binding.email,
          audit: options.audit,
        });
        // A second pass must find nothing: the state a fresh session lands on
        // is stable. Identical contract to `npm run migrate:owner`.
        const secondPass = await reconciliation.reconcileBoundOwner(sql, binding, directory, {
          userId: binding.userId,
          email: binding.email,
        });
        /*
         * Storage last, and inside the same stage: the rows now name the
         * canonical account, so the objects can be moved onto its prefix
         * without a window in which the two disagree. Bounded — a library
         * larger than one invocation's budget reports `remaining`, and the
         * `storage-rekey` stage continues it.
         */
        const { rekeyOwnerStorageObjects, ownerStorageUsage } = await import(
          "../storage/owner-storage.server.ts"
        );
        const orphanIds = await reconciliation.provenOwnerOrphanIds(sql, binding, directory);
        const rekey = await rekeyOwnerStorageObjects(sql, {
          userId: binding.userId,
          orphanIds,
        });
        const usage = await ownerStorageUsage(sql, binding.userId);

        const after = await verify.collectOwnerMigrationReport(sql, { directory });
        ok = after.ok && secondPass === null;
        result = {
          planned,
          moved: moved?.moved ?? {},
          movedTotal: moved?.movedTotal ?? 0,
          adminAuthority: moved?.adminAuthority ?? null,
          idempotent: secondPass === null,
          storage: { rekey, usage },
          after: {
            ok: after.ok,
            warnings: after.warnings,
            orphanRows: after.orphanRows,
            canonicalRows: after.canonicalRows,
            checks: after.checks,
          },
        };
        if (ok) {
          try {
            await writeSetting(sql, OWNER_OPS_COMPLETED_KEY, { at, stage, movedTotal: moved?.movedTotal ?? 0 });
          } catch {
            /* the marker is a record; the move already happened */
          }
        }
      }
    }
  } else if (stage === "identity") {
    result = await identity();
    ok = (result as { ok: boolean }).ok;
  } else if (stage === "provider") {
    result = await provider();
    ok = (result as { ok: boolean }).ok;
  } else if (stage === "storage") {
    result = await storage();
    ok = (result as { ok: boolean }).ok;
  } else if (stage === "admin-probe") {
    result = await adminProbe();
    ok = (result as { ok: boolean }).ok;
  } else {
    // battery — the read-only trio, each reported separately
    const [identityResult, providerResult, storageResult] = [
      await identity(),
      await provider(),
      await storage(),
    ];
    result = { identity: identityResult, provider: providerResult, storage: storageResult };
    ok = identityResult.ok && providerResult.ok && storageResult.ok;
  }

  await persistReport(sql, stage, at, ok, result);
  return { stage, ok, at, result };
}
