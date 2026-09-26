#!/usr/bin/env node
/**
 * CLI front-end for the Team licensing verifier/repairer.
 *
 * The logic lives in `src/lib/license/team-setup.server.ts` so the CLI, the
 * Owner Vault button and the tests all exercise one implementation.
 *
 *   npm run verify:team            # read-only check
 *   npm run verify:team -- --repair  # also create/attach missing entitlements
 *
 * Never prints a token, an Authorization header or a licence key.
 */
const repair = process.argv.includes("--repair");

const { verifyAndRepairTeam } = await import("../src/lib/license/team-setup.server.ts");
const report = await verifyAndRepairTeam(repair);

const rows = [...report.steps];
for (const plan of report.plans) {
  rows.push({ step: `Policy ${plan.plan}`, state: plan.state, detail: plan.policyId ?? "—" });
  rows.push({ step: `Entitlements ${plan.plan}`, state: plan.state, detail: plan.detail });
  for (const note of plan.repaired) rows.push({ step: `إصلاح ${plan.plan}`, state: "ready", detail: note });
}
rows.push(report.lifetime);
if (report.missingEnvVars.length > 0) {
  rows.push({ step: "متغيرات ناقصة", state: "missing", detail: report.missingEnvVars.join(", ") });
}

const width = Math.max(...rows.map((row) => row.step.length), 20);
const LABEL = { ready: "READY  ", missing: "MISSING", failed: "FAILED " };
console.log("");
console.log(`${"الخطوة".padEnd(width)} | الحالة  | التفاصيل`);
console.log(`${"-".repeat(width)}-+---------+---------`);
for (const row of rows) {
  console.log(`${row.step.padEnd(width)} | ${LABEL[row.state] ?? row.state} | ${row.detail}`);
}
console.log("");

process.exit(rows.some((row) => row.state === "failed") || !report.connected ? 1 : 0);
