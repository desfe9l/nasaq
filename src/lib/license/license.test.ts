import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateLicenseKey,
  hashLicenseKey,
  keyPrefix,
  isGeneratedKeyFormat,
  isKeygenKeyFormat,
  isValidKeyFormat,
  normalizeLicenseKey,
} from "./key.ts";
import { entitlementsForPlan, entitlementsFromKeygenCodes, LICENSE_ENTITLEMENTS } from "./types.ts";

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

describe("License Key Normalization", () => {
  it("uppercases, trims, and strips pasted whitespace", () => {
    assert.equal(normalizeLicenseKey("  8bb5c5-56f186-781d92-3c5259-da12b3-v3 \n"), "8BB5C5-56F186-781D92-3C5259-DA12B3-V3");
    assert.equal(normalizeLicenseKey("8BB5C5-56F186- 781D92-3C5259-DA12B3-V3"), "8BB5C5-56F186-781D92-3C5259-DA12B3-V3");
  });

  it("keeps hashing stable across typed variants", () => {
    const a = hashLicenseKey("8BB5C5-56F186-781D92-3C5259-DA12B3-V3");
    const b = hashLicenseKey(" 8bb5c5 - 56f186-781d92-3c5259-da12b3-v3 ");
    assert.equal(a, b);
  });

  it("preserves case for signed provider keys", () => {
    const signed = "key/eyJhcHAiOiJuYXNhcSJ9.AbCdSignature";
    assert.equal(normalizeLicenseKey(`  ${signed}  `), signed);
    assert.notEqual(hashLicenseKey(signed), hashLicenseKey(signed.toUpperCase()));
    assert.ok(isKeygenKeyFormat(signed));
    assert.ok(!isKeygenKeyFormat("key/eyJhcH AiOiJuYXNhcSJ9.AbCdSignature"));
  });
});

describe("Generator (Keygen HEX + version) Key Format", () => {
  it("accepts a key exactly as the generator issues it", () => {
    assert.ok(isGeneratedKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B3-V3"));
  });

  it("accepts lowercase / whitespace variants (normalizes)", () => {
    assert.ok(isGeneratedKeyFormat("8bb5c5-56f186-781d92-3c5259-da12b3-v3"));
    assert.ok(isGeneratedKeyFormat(" 8BB5C5-56F186-781D92-3C5259-DA12B3-V3 "));
  });

  it("accepts other version suffixes the generator can issue", () => {
    assert.ok(isGeneratedKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B3-V2"));
    assert.ok(isGeneratedKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B3-V10"));
  });

  it("rejects tampered / random keys with wrong shape", () => {
    // non-hex character
    assert.ok(!isGeneratedKeyFormat("GBB5C5-56F186-781D92-3C5259-DA12B3-V3"));
    // wrong group length
    assert.ok(!isGeneratedKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B-V3"));
    // missing version suffix
    assert.ok(!isGeneratedKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B3"));
    // extra segment
    assert.ok(!isGeneratedKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B3-A1B2C3-V3"));
    // swapped suffix without V
    assert.ok(!isGeneratedKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B3-X3"));
  });

  it("generated keys remain keygen-format keys (single pipeline)", () => {
    assert.ok(isKeygenKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B3-V3"));
    // …and never parse as legacy manual keys
    assert.ok(!isValidKeyFormat("8BB5C5-56F186-781D92-3C5259-DA12B3-V3"));
  });
});

describe("Keygen Key Format Validation", () => {
  it("accepts a provider-defined Keygen key", () => {
    assert.ok(isKeygenKeyFormat("key/eyJhcHAiOiJuYXNhcSJ9.signature"));
  });

  it("rejects empty / whitespace-only values", () => {
    assert.ok(!isKeygenKeyFormat(""));
    assert.ok(!isKeygenKeyFormat("   "));
  });

  it("never treats pasted prose as a recognized key format", () => {
    // Normalization makes verification space/case-insensitive, but garbage
    // still matches no known format and can only fail real verification.
    assert.ok(!isGeneratedKeyFormat("not a license key"));
    assert.ok(!isValidKeyFormat("not a license key"));
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
  it("cannot use a stale plan to promote a FREE or TRIAL license", () => {
    assert.equal(entitlementsForPlan("individual-monthly", "FREE").premium_templates, false);
    assert.equal(entitlementsForPlan("team-monthly", "TRIAL").team_features, false);
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
