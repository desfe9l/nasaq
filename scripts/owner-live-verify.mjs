#!/usr/bin/env node
/**
 * Live production authority/entitlement/security verification (read-only).
 *
 * `npm run verify:owner-live` — the operator CLI. The verification itself lives
 * in `src/lib/auth/owner-live-verify.server.ts`, because the deployment runtime
 * runs the SAME probes in-process (the `identity` stage of
 * `/api/ops/owner-recovery`); this file only resolves the environment, prints
 * the sanitized table and maps the verdict to an exit code.
 *
 * Never prints a raw id, address, key or hash — fingerprints and verdicts.
 * Exit: 0 pass · 1 a probe failed · 2 cannot certify (store/db/binding).
 */
const [{ getSql, dbSource }, liveVerify] = await Promise.all([
  import("../src/lib/db.ts"),
  import("../src/lib/auth/owner-live-verify.server.ts"),
]);

const fail = (code, message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
};

if (dbSource !== "neon") {
  fail(2, "DATABASE_URL is not set — live verification runs against the DEPLOYMENT's database only.");
}

const sql = await getSql();
const outcome = await liveVerify.runOwnerLiveVerify(sql);
if (outcome.status === "uncertified") {
  fail(2, outcome.error);
}

const report = outcome.report;
const width = Math.max(...report.checks.map((c) => c.name.length), 12);
console.log(
  `\nLive identity verification — owner ${report.ownerFingerprint} — orphans: ${report.orphans.join(", ") || "none"}\n`,
);
for (const c of report.checks) {
  console.log(`  [${c.ok ? " ok " : "FAIL"}] ${c.name.padEnd(width)}  ${c.detail}`);
}
console.log("");
if (!report.ok) {
  console.log(`RESULT: FAILED — ${report.failures} probe(s) red. The identity chain does NOT yet agree everywhere.\n`);
  process.exit(1);
}
console.log("RESULT: OK — auth id = binding owner = database owner = licence owner = admin owner = editor entitlement owner.\n");
process.exit(0);
