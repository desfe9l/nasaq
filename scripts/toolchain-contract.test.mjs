import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nodeEngine = "^22.22.2 || ^24.15.0 || >=26.0.0";

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

test("toolchain pins the Node versions supported by its locked dependencies", () => {
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
