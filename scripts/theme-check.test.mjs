import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The theme guard is the contract: every documented role pair must clear WCAG
 * AA in both palettes, and no chrome element may paint a fixed colour. Running
 * it here means a palette edit cannot ship unreadable text in either theme.
 */
test("theme guard reports no contrast or raw-colour findings", () => {
  const run = spawnSync(process.execPath, [join(root, "scripts", "theme-check.mjs")], {
    encoding: "utf8",
    cwd: root,
  });
  assert.equal(run.status, 0, `theme-check reported findings:\n${run.stdout}${run.stderr}`);
});
