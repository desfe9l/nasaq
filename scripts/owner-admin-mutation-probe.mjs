#!/usr/bin/env node
/**
 * Live admin-mutation probe — reversible, synthetic-entity writes.
 *
 * `npm run probe:admin-mutations` — the operator CLI. The probe itself lives in
 * `src/lib/admin/owner-mutation-probe.server.ts`, because the deployment
 * runtime runs the SAME probe in-process (the `admin-probe` stage of
 * `/api/ops/owner-recovery`); this file only resolves the environment, prints
 * the sanitized table and maps the verdict to an exit code.
 *
 * SAFETY: synthetic subjects only (`owner-probe-<run>-…`), full cleanup in the
 * probe's `finally`, and a refusal to write at all unless the canonical owner
 * passes the super-admin resolver. Audit entries stay — they are the record.
 *
 * Exit: 0 every mutation landed · 1 a mutation or its resulting state failed ·
 *       2 cannot run (no binding / store down / not production DB).
 */
const [{ getSql, dbSource }, probe] = await Promise.all([
  import("../src/lib/db.ts"),
  import("../src/lib/admin/owner-mutation-probe.server.ts"),
]);

const fail = (code, message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
};

if (dbSource !== "postgres") {
  fail(2, "DATABASE_URL is not set — the mutation probe runs against the DEPLOYMENT's database only.");
}

const sql = await getSql();
const outcome = await probe.runOwnerMutationProbe(sql);
if (outcome.status === "uncertified") {
  fail(2, outcome.error);
}

const report = outcome.report;
const width = Math.max(...report.checks.map((c) => c.name.length), 12);
console.log(`\nAdmin mutation probe — reversible, synthetic rows only (run ${report.run})\n`);
for (const c of report.checks) {
  console.log(`  [${c.ok ? " ok " : "FAIL"}] ${c.name.padEnd(width)}  ${c.detail}`);
}
console.log("\n  cleanup: synthetic subscription/payment/licence/admin rows removed; audit entries kept as the honest record.");
console.log("");
if (!report.ok) {
  console.log(`RESULT: FAILED — ${report.failures} mutation(s) did not land.\n`);
  process.exit(1);
}
console.log("RESULT: OK — the canonical owner's identity performs real server-side mutations; resulting state verified after each.\n");
process.exit(0);
