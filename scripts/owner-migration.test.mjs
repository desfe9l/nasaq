/**
 * The operator-facing migration tooling contract:
 *
 *   1. the production alias hook resolves `@/…` to the real modules and —
 *      unlike the test hook — NEVER substitutes the database with a stub
 *      (a verifier that reads a stand-in database would certify nothing);
 *   2. both CLIs fail closed without `DATABASE_URL` and name the missing
 *      configuration, instead of "verifying" the local fallback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "./app-alias-loader.mjs";

test("the production alias hook never substitutes @/lib/db", async () => {
  const seen = [];
  const next = async (specifier) => {
    seen.push(specifier);
    return { url: specifier, shortCircuit: true };
  };
  await resolve("@/lib/db", {}, next);
  assert.ok(seen[0], "the hook produced a candidate");
  assert.ok(
    seen[0].endsWith("/src/lib/db") || seen[0].endsWith("/src/lib/db.ts"),
    `resolves into src/ — got ${seen[0]}`,
  );
  assert.ok(!seen[0].includes("test-db-stub"), "never the test stub");
});

test("the production alias hook still maps plain aliases into src/", async () => {
  const seen = [];
  const next = async (specifier) => {
    seen.push(specifier);
    if (specifier.endsWith(".ts")) return { url: specifier, shortCircuit: true };
    throw new Error("try the next candidate");
  };
  await resolve("@/lib/auth/owner-binding.server", {}, next);
  assert.ok(
    seen.some((specifier) => specifier.endsWith("/src/lib/auth/owner-binding.server.ts")),
    `the .ts candidate is offered — got ${seen.join(", ")}`,
  );
});

for (const script of ["owner-migration-verify.mjs", "owner-migration-run.mjs"]) {
  test(`scripts/${script} refuses to run without DATABASE_URL`, () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const run = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        "./scripts/app-alias-register.mjs",
        `scripts/${script}`,
        ...(script.includes("run") ? ["--dry-run"] : []),
      ],
      { env, encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(run.status, 2, `expected fail-closed exit 2 — got ${run.status}: ${run.stderr}`);
    assert.match(run.stderr, /DATABASE_URL/);
  });
}
