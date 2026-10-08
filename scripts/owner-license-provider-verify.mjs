#!/usr/bin/env node
/**
 * Live Keygen verification for the canonical owner's licences (STEP 12).
 *
 * `npm run verify:provider` — the operator CLI. The verification itself lives
 * in `src/lib/license/owner-provider-verify.server.ts`, because the deployment
 * runtime runs the SAME check in-process (the `provider` stage of
 * `/api/ops/owner-recovery`); this file only resolves the environment, prints
 * the sanitized table and maps the verdict to an exit code.
 *
 * READ-ONLY. It never creates, invalidates, extends, suspends or reassigns a
 * licence, at the provider or locally.
 *
 * REDACTION: prints licence fingerprints (sha256 of the provider id), statuses
 * and counts only — never a key, a key hash, a user id or an address.
 *
 * Exit: 0 every check passed · 1 a mismatch was found · 2 cannot certify
 *       (provider unconfigured/unreachable, no binding, identity store down).
 */
const [{ getSql, dbSource }, providerVerify] = await Promise.all([
  import("../src/lib/db.ts"),
  import("../src/lib/license/owner-provider-verify.server.ts"),
]);

const fail = (code, message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
};

if (dbSource !== "postgres") {
  fail(2, "DATABASE_URL is not set — this verifies the DEPLOYMENT's database, never a local fallback.");
}

const sql = await getSql();
const outcome = await providerVerify.ownerProviderVerify(sql);
if (outcome.status === "uncertified") {
  fail(2, outcome.error);
}

const report = outcome.report;
const width = Math.max(...report.results.map((r) => r.name.length), 12);
console.log(
  `\nKeygen live verification — owner ${report.ownerFingerprint} — ${report.ownerLicenses} owner licence(s)\n`,
);
for (const r of report.results) {
  console.log(`  [${r.ok ? " ok " : "FAIL"}] ${r.name.padEnd(width)}  ${r.detail}`);
}
console.log("");
if (!report.ok) {
  console.log(`RESULT: FAILED — ${report.failures} provider-side check(s) red.\n`);
  process.exit(1);
}
console.log("RESULT: OK — every owner licence exists at Keygen with its key, status, activations and owner scope preserved.\n");
process.exit(0);
