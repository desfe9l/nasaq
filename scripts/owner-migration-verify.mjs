#!/usr/bin/env node
/**
 * Owner identity migration — production verification (read-only).
 *
 * Answers, against the LIVE database the deployment environment points at:
 *
 *   · does a durable owner binding exist, and does the bound account hold its
 *     admin row?                              (binding_admin_row)
 *   · are any owned-record rows still keyed to the owner's proven pre-migration
 *     ids? target: 0 in every table           (orphan_rows)
 *   · is the commercial schema structurally sound? (duplicate live
 *     subscriptions, duplicate licence keys, subscriptions without plans)
 *   · do the canonical owner's Keygen licences resolve to the owner's scope?
 *   · does any rebound marker name a LIVE account?  (must never happen)
 *
 * plus informational counts: rows the canonical owner now holds per table,
 * retired legacy admin rows, unowned ACTIVE licence inventory, and ACTIVE
 * licences whose owner id resolves to nothing (pre-migration customers who
 * have not returned — left untouched BY DESIGN).
 *
 * Usage:
 *   npm run verify:owner             human table, exit 1 on any failed check
 *   npm run verify:owner -- --json   machine report (same redaction rules)
 *
 * REDACTION CONTRACT: the report contains NO raw user ids (one-way
 * fingerprints only), NO email addresses, NO licence keys or key hashes, and
 * NO environment values. It is safe to paste into a ticket as-is.
 */
const asJson = process.argv.includes("--json");

const [{ getSql, dbSource }, { collectOwnerMigrationReport }] = await Promise.all([
  import("../src/lib/db.ts"),
  import("../src/lib/auth/owner-migration-verify.server.ts"),
]);

if (dbSource !== "postgres") {
  console.error(
    "✗ NASAQ_PRIMARY_DATABASE_URL is not set. This verifies the DEPLOYMENT's database: run it with the same NASAQ_PRIMARY_DATABASE_URL the production deployment holds. The local fallback is never certified as production state.",
  );
  process.exit(2);
}

const sql = await getSql();
const report = await collectOwnerMigrationReport(sql);

if (asJson) {
  console.log(JSON.stringify({ backend: dbSource, ...report }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

const LABEL = { fail: "FAIL", warn: "WARN", info: "INFO" };
console.log("");
console.log(`Owner migration verification — backend: ${dbSource} — ${report.at}`);
console.log(
  `binding: ${report.binding.present ? `present (${report.binding.source}, ${report.binding.role})` : "NOT FOUND"}` +
    (report.binding.ownerFingerprint ? ` — owner ${report.binding.ownerFingerprint}` : ""),
);
console.log(`orphan ids (fingerprints): ${report.orphans.length ? report.orphans.join(", ") : "none"}`);

const ownedTables = Object.keys({ ...report.canonicalRows, ...report.orphanRows }).sort();
if (ownedTables.length) {
  console.log("");
  console.log("table                 canonical  orphan");
  for (const table of ownedTables) {
    const canonical = report.canonicalRows[table];
    const orphan = report.orphanRows[table];
    console.log(
      `  ${table.padEnd(20)}${String(canonical ?? "—").padStart(9)}${String(orphan ?? "—").padStart(8)}`,
    );
  }
}

console.log("");
const width = Math.max(...report.checks.map((c) => c.name.length), 10);
for (const c of report.checks) {
  const state = c.severity === "fail" && !c.ok ? LABEL.fail : c.count > 0 && c.severity !== "info" ? LABEL.warn : " ok ";
  console.log(`  [${state}] ${c.name.padEnd(width)}  (${c.count}) ${c.detail}`);
}
console.log("");
if (!report.ok) {
  console.log("RESULT: FAILED — at least one failing-grade check above is red.");
  console.log("Run  npm run migrate:owner  to reconcile, then re-run this verification.");
  process.exit(1);
}
console.log(
  report.warnings
    ? `RESULT: OK — with ${report.warnings} warning(s) above (reported, not blocking).`
    : "RESULT: OK — the canonical owner is the authority everywhere this database reaches.",
);
process.exit(0);
