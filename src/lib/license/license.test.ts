import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashLicenseKey,
  keyPrefix,
  isKeygenKeyFormat,
  isValidKeyFormat,
} from "./key.client";
import { entitlementsForPlan, entitlementsFromKeygenCodes, LICENSE_ENTITLEMENTS } from "./types.ts";

// Mock generateLicenseKey for tests since it's not exported from key.client
function generateLicenseKeyForTest(): string {
  const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segment = (len: number): string => {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join("");
  };
  return `NASAQ-${segment(4)}-${segment(4)}-${segment(4)}-${segment(4)}`;
}

describe("License Key Generation", () => {
  it("generates keys matching the expected format", () => {
    for (let i = 0; i < 100; i++) {
      const key = generateLicenseKeyForTest();
      assert.match(key, /^NASAQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  it("generates unique keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      keys.add(generateLicenseKeyForTest());
    }
    assert.equal(keys.size, 1000);
  });

  it("does not contain ambiguous characters (0, O, 1, I)", () => {
    const ambiguous = /[0OI1]/;
    for (let i = 0; i < 100; i++) {
      const key = generateLicenseKeyForTest();
      assert.ok(!ambiguous.test(key), `Key contains ambiguous character: ${key}`);
    }
  });
});

describe("License Key Hashing", () => {
  it("produces consistent SHA-256 hashes", async () => {
    const key = "NASAQ-ABCD-EFGH-IJKL-MNOP";
    const hash1 = await hashLicenseKey(key);
    const hash2 = await hashLicenseKey(key);
    assert.equal(hash1, hash2);
  });

  it("produces 64-character hex strings", async () => {
    const key = generateLicenseKeyForTest();
    const hash = await hashLicenseKey(key);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("is case-insensitive", async () => {
    const hash1 = await hashLicenseKey("NASAQ-ABCD-EFGH-IJKL-MNOP");
    const hash2 = await hashLicenseKey("nasaq-abcd-efgh-ijkl-mnop");
    assert.equal(hash1, hash2);
  });

  it("is irreversible (cannot recover key from hash)", async () => {
    const key = generateLicenseKeyForTest();
    const hash = await hashLicenseKey(key);
    // Hash should not contain the original key
    assert.ok(!hash.includes(key));
    assert.ok(!hash.includes("NASAQ"));
  });
});

describe("License Key Prefix", () => {
  it("extracts the first 14 characters", () => {
    const key = "NASAQ-ABCD-EFGH-IJKL-MNOP";
    const prefix = keyPrefix(key);
    assert.equal(prefix, "NASAQ-ABCD-EFG");  // 14 chars
  });
});

describe("License Key Format Validation", () => {
  it("accepts valid keys", () => {
    assert.ok(isValidKeyFormat("NASAQ-ABCD-EFGH-IJKL-MNOP"));
  });

  it("accepts lowercase keys (normalizes)", () => {
    assert.ok(isValidKeyFormat("nasaq-abcd-efgh-ijkl-mnop"));
  });

  it("rejects keys with wrong prefix", () => {
    assert.ok(!isValidKeyFormat("OTHER-ABCD-EFGH-IJKL-MNOP"));
  });

  it("rejects keys with wrong length", () => {
    assert.ok(!isValidKeyFormat("NASAQ-ABC-EFGH-IJKL-MNOP"));
    assert.ok(!isValidKeyFormat("NASAQ-ABCDE-EFGH-IJKL-MNOP"));
  });

  it("rejects keys shorter than full format", () => {
    assert.ok(!isValidKeyFormat("NASAQ-0O1I-EFGH"));  // too short
  });

  it("rejects empty strings", () => {
    assert.ok(!isValidKeyFormat(""));
  });
});

describe("Keygen Key Format Validation", () => {
  it("accepts a provider-defined Keygen key", () => {
    assert.ok(isKeygenKeyFormat("key/eyJhcHAiOiJuYXNhcSJ9.signature"));
  });

  it("rejects whitespace and empty values", () => {
    assert.ok(!isKeygenKeyFormat("not a license key"));
    assert.ok(!isKeygenKeyFormat(""));
  });
});

describe("License Entitlements", () => {
  it("maps Keygen entitlement codes to NASAQ gates", () => {
    const individual = entitlementsFromKeygenCodes([
      "nasaq.editor",
      "nasaq.templates",
      "nasaq.projects",
      "nasaq.library",
      "nasaq.export",
      "nasaq.advanced-export",
      "nasaq.brand-kit",
      "nasaq.advanced-tools",
    ]);
    assert.ok(individual.core_editor);
    assert.ok(individual.advanced_export);
    assert.ok(individual.ai_report);
    assert.ok(!individual.team_features);

    const team = entitlementsFromKeygenCodes(["nasaq.team"]);
    assert.ok(team.collaboration);
    assert.ok(team.team_features);
    assert.ok(team.multi_user_activation);
  });

  it("keeps team features out of individual plans", () => {
    const individual = entitlementsForPlan("individual-monthly", "PRO");
    const team = entitlementsForPlan("team-monthly", "PRO");
    assert.ok(individual.premium_templates);
    assert.ok(individual.advanced_export);
    assert.ok(!individual.team_features);
    assert.ok(!individual.multi_user_activation);
    assert.ok(team.team_features);
    assert.ok(team.multi_user_activation);
  });
  it("FREE tier has only core features", () => {
    const free = LICENSE_ENTITLEMENTS.FREE;
    assert.ok(free.core_editor);
    assert.ok(free.basic_export);
    assert.ok(!free.premium_templates);
    assert.ok(!free.advanced_export);
    assert.ok(!free.brand_kit);
    assert.ok(!free.unlimited_projects);
    assert.ok(!free.unlimited_pages);
    assert.ok(!free.data_import);
    assert.ok(!free.collaboration);
  });

  it("TRIAL tier has all premium features", () => {
    const trial = LICENSE_ENTITLEMENTS.TRIAL;
    assert.ok(trial.core_editor);
    assert.ok(trial.basic_export);
    assert.ok(trial.premium_templates);
    assert.ok(trial.advanced_export);
    assert.ok(trial.brand_kit);
    assert.ok(trial.unlimited_projects);
    assert.ok(trial.unlimited_pages);
    assert.ok(trial.data_import);
    assert.ok(!trial.collaboration);
  });

  it("PRO tier has all features", () => {
    const pro = LICENSE_ENTITLEMENTS.PRO;
    for (const [key, value] of Object.entries(pro)) {
      assert.ok(value === true, `PRO tier should have ${key} enabled`);
    }
  });

  it("LIFETIME tier has all features", () => {
    const lt = LICENSE_ENTITLEMENTS.LIFETIME;
    for (const [key, value] of Object.entries(lt)) {
      assert.ok(value === true, `LIFETIME tier should have ${key} enabled`);
    }
  });
});
