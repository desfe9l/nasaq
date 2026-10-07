import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Run scripts/migrate.mjs in a throwaway fixture whose fake `pg` fails with
 * `code` the way the real driver would.
 */
function runMigrateWithFailure({ code, message }) {
  const fixture = mkdtempSync(join(tmpdir(), "nasaq-migrate-"));
  try {
    mkdirSync(join(fixture, "scripts"), { recursive: true });
    mkdirSync(join(fixture, "migrations"), { recursive: true });
    mkdirSync(join(fixture, "node_modules", "pg"), { recursive: true });
    writeFileSync(
      join(fixture, "scripts", "migrate.mjs"),
      readFileSync(join(root, "scripts", "migrate.mjs"), "utf8"),
    );
    writeFileSync(
      join(fixture, "scripts", "migration-plan.mjs"),
      readFileSync(join(root, "scripts", "migration-plan.mjs"), "utf8"),
    );
    writeFileSync(join(fixture, "migrations", "0001_fixture.sql"), "select 1;\n");
    writeFileSync(
      join(fixture, "node_modules", "pg", "package.json"),
      JSON.stringify({ type: "module" }),
    );
    writeFileSync(
      join(fixture, "node_modules", "pg", "index.js"),
      "export default { Pool: class { async connect() { const error = new Error(" +
        JSON.stringify(message) +
        "); error.code = " +
        JSON.stringify(code) +
        "; throw error; } } };\n",
    );

    return spawnSync(process.execPath, [join(fixture, "scripts", "migrate.mjs")], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://user:password@db.example.test/nasaq",
        VERCEL: "1",
        VERCEL_ENV: "production",
      },
    });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("an unreachable or over-quota database does not fail the deploy", () => {
  // A Neon quota failure is a condition the deploy cannot fix. Every migration
  // file is applied in its own transaction, so nothing is half-applied — but a
  // build that dies here means NO deployment ships at all, even though the app
  // runs fine without the unapplied schema. The deploy continues, loudly.
  const result = runMigrateWithFailure({ code: "53000", message: "exceeded the quota" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /53000/);
  assert.match(result.stderr, /WITHOUT applying migrations/);
  assert.match(result.stderr, /db:migrate/);
});

test("a too-many-connections failure also continues the deploy", () => {
  const result = runMigrateWithFailure({
    code: "53300",
    message: "sorry, too many clients already",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /53300/);
});

test("a broken migration still fails the deploy", () => {
  // A syntax/semantic error in a migration file is OUR bug. Shipping a bundle
  // that assumes a schema which was never created turns a build failure into a
  // runtime failure, which is strictly worse.
  const result = runMigrateWithFailure({
    code: "42601",
    message: 'syntax error at or near "creat"',
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /42601|syntax error/);
  assert.doesNotMatch(result.stderr, /WITHOUT applying migrations/);
});
