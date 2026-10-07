import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The Node range the deployment platform accepts.
 *
 * Vercel resolves `engines.node` against the Node majors its build image ships
 * and refuses a range that matches none of them — an unbounded/odd range is
 * rejected before the build starts ("Found invalid or discontinued Node.js
 * Version"), which is a failed deployment that no amount of application code
 * can fix. A single supported major (`22.x`) is the form Vercel's own error
 * message recommends, so that is the contract.
 */
const nodeEngine = "22.x";

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

test("toolchain pins a Node major the deploy platform supports", () => {
  const manifest = readJson("package.json");
  const lockfile = readJson("package-lock.json");

  assert.equal(manifest.engines?.node, nodeEngine);
  assert.equal(lockfile.packages?.[""]?.engines?.node, nodeEngine);
});

test("typecheck resolves the ignored raster asset module without emitting it", () => {
  const manifest = readJson("package.json");
  const declaration = readFileSync(
    join(root, "src/lib/og/share-raster-assets.generated.d.ts"),
    "utf8",
  );

  assert.equal(manifest.scripts?.typecheck, "tsc --noEmit");
  assert.match(declaration, /export declare const wasm: Uint8Array;/);
  assert.match(declaration, /export declare const fonts: Uint8Array\[\];/);
});
