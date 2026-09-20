import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateLicenseKey,
  hashLicenseKey,
  keyPrefix,
  isLemonSqueezyKeyFormat,
  isValidKeyFormat,
} from "./key.ts";
import { LICENSE_ENTITLEMENTS } from "./types.ts";

describe("License Key Generation", () => {
  it("generates keys matching the expected format", () => {
    for (let i = 0; i < 100; i++) {
      const key = generateLicenseKey();
      assert.match(key, /^NASAQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });

  it("generates unique keys", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      keys.add(generateLicenseKey());
    }
    assert.equal(keys.size, 1000);
  });

  it("does not contain ambiguous characters (0, O, 1, I)", () => {
    const ambiguous = /[0OI1]/;
    for (let i = 0; i < 100; i++) {
      const key = generateLicenseKey();
      assert.ok(!ambiguous.test(key), `Key contains ambiguous character: ${key}`);
    }
  });
});

describe("License Key Hashing", () => {
  it("produces consistent SHA-256 hashes", () => {
    const key = "NASAQ-ABCD-EFGH-IJKL-MNOP";
    const hash1 = hashLicenseKey(key);
    const hash2 = hashLicenseKey(key);
    assert.equal(hash1, hash2);
  });

  it("produces 64-character hex strings", () => {
    const key = generateLicenseKey();
    const hash = hashLicenseKey(key);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  it("is case-insensitive", () => {
    const hash1 = hashLicenseKey("NASAQ-ABCD-EFGH-IJKL-MNOP");
    const hash2 = hashLicenseKey("nasaq-abcd-efgh-ijkl-mnop");
    assert.equal(hash1, hash2);
  });

  it("is irreversible (cannot recover key from hash)", () => {
    const key = generateLicenseKey();
    const hash = hashLicenseKey(key);
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

describe("Lemon Squeezy Key Format Validation", () => {
  it("accepts a Lemon Squeezy UUID license key", () => {
    assert.ok(isLemonSqueezyKeyFormat("38b1460a-5104-4067-a91d-77b872934d51"));
  });

  it("rejects malformed external license keys", () => {
    assert.ok(!isLemonSqueezyKeyFormat("not-a-license-key"));
  });
});

describe("License Entitlements", () => {
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
