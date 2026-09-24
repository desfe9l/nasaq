import assert from "node:assert/strict";
import test from "node:test";
import { inventoryToCsv, maskVaultValue, type OwnerVaultInventory } from "./vault.ts";

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
        id: "env.XAI_API_KEY",
        section: "ai",
        service: "xAI",
        account: "test",
        label: "xAI",
        variable: "XAI_API_KEY",
        value: "xai-secret",
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
  assert.match(csv, /xai-secret/);
  assert.doesNotMatch(csv, /GROK_CONNECTOR_ACCESS_TOKEN,.*secret/);
});
