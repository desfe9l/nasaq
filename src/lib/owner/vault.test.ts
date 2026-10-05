import assert from "node:assert/strict";
import test from "node:test";
import { inventoryToCsv, maskVaultValue, type OwnerVaultInventory } from "./vault.ts";
import { buildOwnerVaultInventory } from "./vault-functions.ts";

test("vault values are masked without destroying the original value", () => {
  assert.equal(maskVaultValue(null), "غير مهيأ");
  assert.equal(maskVaultValue("abcdefghijk"), "abcd••••••••hijk");
  assert.equal(maskVaultValue("abcd"), "ab••••cd");
});

test("CSV export includes owner-readable values and protects hidden platform values", () => {
  const inventory: OwnerVaultInventory = {
    generatedAt: "2026-09-23T00:00:00.000Z",
    environment: "test",
    ownerConfigured: true,
    routes: [],
    findings: [],
    entries: [
      {
        id: "env.GEMINI_API_KEY",
        section: "ai",
        service: "Google Gemini",
        account: "test",
        label: "Gemini",
        variable: "GEMINI_API_KEY",
        value: "gemini-secret",
        ownerReadable: true,
        configured: true,
        origin: "runtime",
        sensitivity: "secret",
        loginUrl: null,
        dashboardUrl: null,
        apiUrl: null,
        purpose: "test",
        configurationLocation: "test",
        exposedInSource: false,
        changeGuide: { providerAction: "test", providerUrl: null, nasaqLocation: "test", environments: "test", redeploy: "test", webhook: "test", revoke: "test" },
      },
      {
        id: "env.GROK_CONNECTOR_ACCESS_TOKEN",
        section: "services",
        service: "Grok",
        account: "platform",
        label: "platform token",
        variable: "GROK_CONNECTOR_ACCESS_TOKEN",
        value: null,
        ownerReadable: false,
        configured: true,
        origin: "runtime",
        sensitivity: "secret",
        loginUrl: null,
        dashboardUrl: null,
        apiUrl: null,
        purpose: "test",
        configurationLocation: "test",
        exposedInSource: false,
        changeGuide: { providerAction: "test", providerUrl: null, nasaqLocation: "test", environments: "test", redeploy: "test", webhook: "test", revoke: "test" },
      },
    ],
  };
  const csv = inventoryToCsv(inventory);
  assert.match(csv, /gemini-secret/);
  assert.doesNotMatch(csv, /GROK_CONNECTOR_ACCESS_TOKEN,.*secret/);
});

test("Owner Vault lists policies only for supported catalog plans", async () => {
  const inventory = await buildOwnerVaultInventory();
  const policyVariables = inventory.entries
    .map((entry) => entry.variable)
    .filter((variable): variable is string => variable?.startsWith("KEYGEN_POLICY_") ?? false)
    .sort();

  assert.deepEqual(policyVariables, [
    "KEYGEN_POLICY_INDIVIDUAL_MONTHLY_ID",
    "KEYGEN_POLICY_INDIVIDUAL_QUARTERLY_ID",
    "KEYGEN_POLICY_LIFETIME_ID",
    "KEYGEN_POLICY_TEAM_MONTHLY_ID",
    "KEYGEN_POLICY_TEAM_QUARTERLY_ID",
    "KEYGEN_POLICY_TRIAL_ID",
  ]);
  assert.equal(
    inventory.findings.some((finding) => finding.title === "سياسات Keygen ناقصة لبعض الباقات المدعومة"),
    false,
  );
});

test("Owner Vault detects equal auth secrets without revealing either value", async () => {
  const previousBetterAuth = process.env.BETTER_AUTH_SECRET;
  const previousGoogle = process.env.GOOGLE_CLIENT_SECRET;
  const fakeSecret = "owner-vault-test-only-value";
  try {
    process.env.BETTER_AUTH_SECRET = fakeSecret;
    process.env.GOOGLE_CLIENT_SECRET = fakeSecret;
    let inventory = await buildOwnerVaultInventory();
    const duplicateFinding = inventory.findings.find((finding) =>
      finding.title.includes("BETTER_AUTH_SECRET") && finding.title.includes("GOOGLE_CLIENT_SECRET"),
    );
    assert.ok(duplicateFinding);
    assert.doesNotMatch(
      `${duplicateFinding.title} ${duplicateFinding.detail} ${duplicateFinding.action}`,
      new RegExp(fakeSecret),
    );

    process.env.GOOGLE_CLIENT_SECRET = "a-different-test-only-value";
    inventory = await buildOwnerVaultInventory();
    assert.equal(
      inventory.findings.some((finding) =>
        finding.title.includes("BETTER_AUTH_SECRET") && finding.title.includes("GOOGLE_CLIENT_SECRET"),
      ),
      false,
    );
  } finally {
    if (previousBetterAuth === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = previousBetterAuth;
    if (previousGoogle === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
    else process.env.GOOGLE_CLIENT_SECRET = previousGoogle;
  }
});
