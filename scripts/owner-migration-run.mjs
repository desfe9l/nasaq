#!/usr/bin/env node
/**
 * Owner identity migration — the one-shot, guarded, transactional runner.
 *
 * The application already reconciles the owner's records automatically on the
 * owner's next privileged call (the licence-status call every editor open
 * makes). This script exists for the operator who wants the move to happen
 * NOW, with a printed before/after proof, against the live deployment
 * configuration — no UI, no manual SQL, no new account, no new licence.
 *
 * What it does, in order:
 *   1. verifies the pre-migration state   (read-only report);
 *   2. resolves the proven orphan ids from the DURABLE OWNER BINDING and the
 *      identity store — never from arguments, never from environment guesses;
 *   3. moves the orphaned rows onto the canonical account through the SAME
 *      server function the runtime uses (`reconcileBoundOwner`), so the
 *      guards are identical: only the bound owner, only proven orphans, live
 *      accounts untouchable, nothing created, nothing deleted;
 *   4. re-verifies and prints the before/after counts (fingerprints only);
 *   5. runs a second reconciliation pass to prove the state is stable for any
 *      future session (it must report "nothing to do").
 *
 * Flags:
 *   --dry-run   print what WOULD move; touch nothing.
 *   --json      machine-readable output (same redaction rules as verify).
 *
 * Exit codes: 0 migrated/already clean · 1 verification failed after the move
 *             2 cannot certify (no binding, or the identity store is down)
 *
 * Redaction contract: identical to owner-migration-verify.mjs — no raw ids,
 * no addresses, no keys, no environment values, ever.
 */
const dryRun = process.argv.includes("--dry-run");
const asJson = process.argv.includes("--json");

const [{ getSql, dbSource }, bindingModule, reconciliation, verify] = await Promise.all([
  import("../src/lib/db.ts"),
  import("../src/lib/auth/owner-binding.server.ts"),
  import("../src/lib/auth/owner-reconciliation.server.ts"),
  import("../src/lib/auth/owner-migration-verify.server.ts"),
]);

if (dbSource !== "postgres") {
  console.error(
    "✗ NASAQ_PRIMARY_DATABASE_URL is not set — the migration runs against the DEPLOYMENT's database, never the local fallback. Set the same NASAQ_PRIMARY_DATABASE_URL the production deployment holds. Nothing was touched.",
  );
  process.exit(2);
}

const sql = await getSql();
const directory = await bindingModule.authIdentityDirectory();
const reportOpts = { directory };

const fail = (code, message, extra = {}) => {
  if (asJson) console.log(JSON.stringify({ backend: dbSource, ok: false, error: message, ...extra }));
  else console.error(`\n✗ ${message}\n`);
  process.exit(code);
};

if (!directory.ready) {
  fail(
    2,
    "The identity store did not answer — orphan and live accounts cannot be told apart. Refusing to touch anything (fail closed).",
  );
}

const binding = await bindingModule.readOwnerBinding(sql);
if (!binding) {
  fail(
    2,
    "No durable owner binding exists. The owner must sign in once (the recovery flow writes the binding), or the deployment's owner configuration must be repaired first. Nothing was touched.",
  );
}

const before = await verify.collectOwnerMigrationReport(sql, reportOpts);
const orphans = await reconciliation.provenOwnerOrphanIds(sql, binding, directory);
const orphanRowsBefore = before.orphanRows;
const movable = Object.values(orphanRowsBefore).reduce((sum, n) => sum + Math.max(0, n), 0);

if (dryRun) {
  const out = {
    backend: dbSource,
    dryRun: true,
    owner: verify.fingerprint(binding.userId),
    orphans: orphans.map(verify.fingerprint),
    wouldMove: orphanRowsBefore,
    wouldMoveTotal: movable,
  };
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else {
    console.log("\nDry run — nothing was changed.\n");
    console.log(`  canonical owner: ${out.owner}`);
    console.log(`  proven orphans:  ${out.orphans.length ? out.orphans.join(", ") : "none"}`);
    for (const [table, n] of Object.entries(orphanRowsBefore)) {
      if (n > 0) console.log(`  ${table.padEnd(22)} ${n} row(s) would move`);
    }
    console.log(`\n  total: ${movable} row(s) would move\n`);
  }
  process.exit(0);
}

const result = await reconciliation.reconcileBoundOwner(sql, binding, directory, {
  userId: binding.userId,
  email: binding.email,
  audit: async () => {
    /* the site_settings marker the reconciliation writes is the durable record */
  },
});

// A second pass must find nothing: the state a fresh session lands on is stable.
const secondPass = await reconciliation.reconcileBoundOwner(sql, binding, directory, {
  userId: binding.userId,
  email: binding.email,
});

/*
 * Storage ownership: the ROWS now name the canonical account, so the objects
 * are moved onto its prefix too. Bounded per call and resumable, so this
 * loops until there is nothing left or a pass stops making progress — the
 * same contract the in-runtime `storage-rekey` stage follows.
 */
const ownerStorage = await import("../src/lib/storage/owner-storage.server.ts");
const rekeyPasses = [];
for (let pass = 0; pass < 50; pass += 1) {
  const outcome = await ownerStorage.rekeyOwnerStorageObjects(sql, {
    userId: binding.userId,
    orphanIds: orphans,
  });
  rekeyPasses.push(outcome);
  if (outcome.complete || outcome.moved === 0) break;
}
const rekey = rekeyPasses[rekeyPasses.length - 1] ?? null;
const storageUsage = await ownerStorage.ownerStorageUsage(sql, binding.userId);

const after = await verify.collectOwnerMigrationReport(sql, reportOpts);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        backend: dbSource,
        moved: result?.moved ?? {},
        movedTotal: result?.movedTotal ?? 0,
        adminAuthority: result?.adminAuthority ?? null,
        idempotent: secondPass === null,
        storage: { rekey, passes: rekeyPasses.length, usage: storageUsage },
        before,
        after,
      },
      null,
      2,
    ),
  );
  process.exit(after.ok ? 0 : 1);
}

console.log(`\nOwner migration — backend: ${dbSource}\n`);
if (!result) {
  console.log("Nothing to move: every owned record already belongs to the canonical owner.");
} else {
  for (const [table, n] of Object.entries(result.moved)) {
    console.log(`  moved ${String(n).padStart(4)} row(s) in ${table}`);
  }
  console.log(`  total: ${result.movedTotal} row(s) reconciled onto the canonical owner.`);
}
if (result?.adminAuthority) {
  console.log(
    `  authority:   role ${result.adminAuthority.role} on the canonical account; ${result.adminAuthority.retired} orphaned admin row(s) retired`,
  );
}
console.log(`  idempotency: ${secondPass === null ? "confirmed (a fresh session is a stable no-op)" : "FAILED — a second pass moved more rows"}`);
if (rekey) {
  console.log(
    rekey.reason === "no_orphans"
      ? "  storage:     no pre-migration prefix to re-key"
      : rekey.reason === "storage_unconfigured"
        ? "  storage:     object storage is not configured in this runtime — rows moved, objects untouched"
        : `  storage:     ${rekey.moved} object(s) re-keyed, ${rekey.remaining} remaining, ${rekey.failed} failed, ${rekey.skipped} skipped`,
  );
  console.log(
    `  usage:       ${storageUsage.assets} asset(s), ${storageUsage.bytes} byte(s) on the canonical account; ${storageUsage.foreignPrefixAssets} still on a pre-migration prefix`,
  );
}

const rows = (label, counts) => {
  const entries = Object.entries(counts).filter(([, n]) => n !== 0);
  console.log(`  ${label}: ${entries.length ? entries.map(([t, n]) => `${t}=${n}`).join(", ") : "0 everywhere"}`);
};
console.log("\nrows still on orphaned ids:");
rows("before", orphanRowsBefore);
rows("after ", after.orphanRows);

if (!after.ok) {
  console.error("\n✗ Post-migration verification FAILED — see npm run verify:owner for the full report.\n");
  process.exit(1);
}
console.log(
  after.warnings
    ? `\n✓ Migration verified — with ${after.warnings} warning(s) (run npm run verify:owner for details).\n`
    : "\n✓ Migration verified: the canonical owner is the authority everywhere this database reaches.\n",
);
process.exit(0);
