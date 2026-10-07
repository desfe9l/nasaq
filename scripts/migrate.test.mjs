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

test("a Neon quota failure fails a Vercel migration deploy", () => {
  const fixture = mkdtempSync(join(tmpdir(), "nasaq-migrate-quota-"));
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
    writeFileSync(
      join(fixture, "migrations", "0001_fixture.sql"),
      "select 1;\n",
    );
    writeFileSync(
      join(fixture, "node_modules", "pg", "package.json"),
      JSON.stringify({ type: "module" }),
    );
    writeFileSync(
      join(fixture, "node_modules", "pg", "index.js"),
      "export default { Pool: class { async connect() { const error = new Error('exceeded the quota'); error.code = '53000'; throw error; } } };\n",
    );

    const result = spawnSync(
      process.execPath,
      [join(fixture, "scripts", "migrate.mjs")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: "postgres://user:password@db.example.test/nasaq",
          VERCEL: "1",
          VERCEL_ENV: "production",
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /53000/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
