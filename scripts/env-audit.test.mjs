import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditEnvironment,
  auditProject,
  documentedNames,
  dynamicPrefixes,
  envNamesInSource,
  projectRootFrom,
} from "./env-audit.mjs";

test("envNamesInSource finds every read form", () => {
  const source = `
    const a = process.env.BETTER_AUTH_SECRET;
    const b = process.env["NASAQ_PRIMARY_DATABASE_URL"];
    const c = import.meta.env.VITE_AUTH_ENABLED;
    const d = import.meta.env?.VITE_STUN_URLS;
    const e = env("GEMINI_API_KEY");
    const f = readEnv(process.env, "NASAQ_OWNER_EMAIL");
    const g = env(family === "individual" ? "GUMROAD_TIER_INDIVIDUAL_NAME" : "GUMROAD_TIER_TEAM_NAME");
  `;
  const { names } = envNamesInSource(source);
  for (const expected of [
    "BETTER_AUTH_SECRET",
    "NASAQ_PRIMARY_DATABASE_URL",
    "VITE_AUTH_ENABLED",
    "VITE_STUN_URLS",
    "GEMINI_API_KEY",
    "NASAQ_OWNER_EMAIL",
    "GUMROAD_TIER_INDIVIDUAL_NAME",
    "GUMROAD_TIER_TEAM_NAME",
  ]) {
    assert.ok(names.includes(expected), `${expected} should be detected`);
  }
});

test("dynamicPrefixes captures names assembled at runtime", () => {
  const { prefixes } = {
    prefixes: dynamicPrefixes(
      'const envName = `KEYGEN_POLICY_${plan.toUpperCase()}_ID`;',
    ),
  };
  assert.deepEqual(prefixes, ["KEYGEN_POLICY_"]);
});

test("documentedNames reads active and commented declarations", () => {
  const names = documentedNames(
    ["VITE_AUTH_ENABLED=true", "# GEMINI_API_KEY=", "not a declaration", "# note"].join("\n"),
  );
  assert.deepEqual(names.sort(), ["GEMINI_API_KEY", "VITE_AUTH_ENABLED"]);
});

test("auditEnvironment reports an undocumented read", () => {
  const result = auditEnvironment({
    used: [{ name: "NEW_VAR", file: "src/x.ts" }],
    documented: [],
    allowed: [],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.undocumented, [{ name: "NEW_VAR", file: "src/x.ts" }]);
});

test("auditEnvironment treats platform and allowlisted names as documented", () => {
  const result = auditEnvironment({
    used: [{ name: "VERCEL", file: "src/x.ts" }],
    documented: [],
    allowed: ["VERCEL"],
  });
  assert.equal(result.ok, true);
});

test("auditEnvironment refuses a credential exposed as a public variable", () => {
  const result = auditEnvironment({
    used: [{ name: "VITE_GEMINI_API_KEY", file: "src/y.tsx" }],
    documented: ["VITE_GEMINI_API_KEY"],
    allowed: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.secretsInClient.length, 1);
});

test("auditEnvironment accepts a documented public flag", () => {
  const result = auditEnvironment({
    used: [{ name: "VITE_AUTH_ENABLED", file: "src/y.tsx" }],
    documented: ["VITE_AUTH_ENABLED"],
    allowed: [],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.secretsInClient, []);
});

test("auditEnvironment honours a dynamic prefix for documented variables", () => {
  const result = auditEnvironment({
    used: [{ name: "OTHER", file: "src/x.ts" }],
    documented: ["KEYGEN_POLICY_LIFETIME_ID"],
    allowed: [],
    prefixes: ["KEYGEN_POLICY_"],
  });
  assert.deepEqual(result.unused, []);
});

test("auditEnvironment reports a documented variable nothing reads", () => {
  const result = auditEnvironment({
    used: [{ name: "README_ONLY", file: "src/x.ts" }],
    documented: ["REMOVED_FEATURE_FLAG"],
    allowed: [],
  });
  assert.deepEqual(result.unused, ["REMOVED_FEATURE_FLAG"]);
});

test("the repository itself passes the audit", () => {
  const result = auditProject(projectRootFrom(new URL(import.meta.url).href));
  assert.deepEqual(result.undocumented, [], "every env var read by the code must be documented");
  assert.deepEqual(result.secretsInClient, [], "no VITE_ variable may hold a credential");
});
