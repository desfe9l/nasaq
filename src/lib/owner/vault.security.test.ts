import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./vault-functions.ts", import.meta.url), "utf8");

test("owner vault has a server auth boundary", () => {
  assert.match(source, /middleware\(\[authMiddleware\]\)/);
  assert.match(source, /getAuthorizationContext/);
  assert.match(source, /authorization\.isAdmin/);
});

test("platform runtime credentials are explicitly excluded from values", () => {
  assert.match(source, /GROK_CONNECTOR_ACCESS_TOKEN/);
  assert.match(source, /ownerReadable: false/);
  assert.doesNotMatch(source, /V4_RUN_TOKEN/);
  assert.doesNotMatch(source, /BROWSER_USE_API_KEY/);
});
