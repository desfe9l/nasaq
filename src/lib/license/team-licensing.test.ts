/**
 * Team licensing — the full chain from a stored licence to editor permissions.
 *
 * What this pins down is the PATH, not the pieces: a row in `licenses` goes
 * through `getAuthorizationContext` (the same function every server function
 * and the editor's `getLicenseStatusFn` call) and comes out as the entitlement
 * map the editor stores. Pure unit checks on `entitlementsForPlan` would pass
 * even if nothing were wired together, so these drive the real modules against
 * a real database with the real migrations applied.
 *
 * Run with the resolver hook that supplies the `@/…` alias and the test
 * database: see `scripts/test-alias-loader.mjs`.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Sql } from "@/lib/db";
import { createTestSql, createUser } from "../commercial/test-db.ts";
import { setTestSql } from "./test-db-stub.ts";
import { getAuthorizationContext, requireFeature } from "../auth/authorization.server.ts";
import { entitlementsForPlan, entitlementsFromKeygenCodes, KEYGEN_ENTITLEMENT_FEATURES } from "./types.ts";
import { editorFeaturesForCodes, missingTeamEnvVars, TEAM_ENTITLEMENT_CODES } from "./team-setup.server.ts";
import { licenseRecordFromEntitlements } from "../product/product.ts";
import { keygenPolicyId, planForKeygenPolicy } from "./keygen.ts";

let sql: Sql;
let close: () => Promise<void>;

const TEAM_USER = "user-team";
const SOLO_USER = "user-solo";
const NO_LICENCE_USER = "user-none";

/** The entitlement codes a Keygen team policy is expected to carry. */
const TEAM_CODES = [
  "nasaq.editor",
  "nasaq.templates",
  "nasaq.projects",
  "nasaq.library",
  "nasaq.export",
  "nasaq.advanced-export",
  "nasaq.brand-kit",
  "nasaq.advanced-tools",
  "nasaq.team",
];

async function giveLicense(input: {
  userId: string;
  plan: string;
  type?: "PRO" | "LIFETIME";
  status?: "ACTIVE" | "EXPIRED" | "REVOKED";
  expiresAt?: string | null;
  codes?: string[];
  source?: "keygen" | "manual";
  /** Simulates a Keygen policy with no entitlements attached. */
  noCodes?: boolean;
}): Promise<string> {
  const id = `lic-${input.userId}-${Math.random().toString(36).slice(2)}`;
  const source = input.source ?? "keygen";
  const metadata: Record<string, string> = {
    source,
    plan: input.plan,
    billing: input.plan.endsWith("quarterly") ? "quarterly" : "monthly",
  };
  if (source === "keygen") {
    metadata.userScopeVerified = input.userId;
    metadata.nasaqUserId = input.userId;
    metadata.entitlements = input.noCodes ? "" : (input.codes ?? TEAM_CODES).join(",");
  }
  await sql`
    insert into licenses
      (id, key_hash, key_prefix, type, status, user_id, activated_at, expires_at, metadata)
    values (
      ${id}, ${`hash-${id}`}, ${"NASAQ-"}, ${input.type ?? "PRO"}, ${input.status ?? "ACTIVE"},
      ${input.userId}, now(),
      ${input.expiresAt === undefined ? new Date(Date.now() + 30 * 86_400_000).toISOString() : input.expiresAt},
      ${JSON.stringify(metadata)}
    )
  `;
  return id;
}

before(async () => {
  ({ sql, close } = await createTestSql());
  setTestSql(sql);
  await createUser(sql, { id: TEAM_USER, email: "team@example.com" });
  await createUser(sql, { id: SOLO_USER, email: "solo@example.com" });
  await createUser(sql, { id: NO_LICENCE_USER, email: "none@example.com" });
});

after(async () => {
  setTestSql(undefined);
  await close();
});

describe("Keygen policy → plan mapping", () => {
  it("resolves the configured team policies back to their plans", () => {
    for (const plan of ["team-monthly", "team-quarterly"] as const) {
      const policyId = keygenPolicyId(plan);
      assert.ok(policyId, `${plan} has no policy id configured`);
      // The reverse mapping is what the Paylink webhook uses to name the plan
      // on a freshly issued licence; a mismatch here silently mislabels it.
      assert.equal(planForKeygenPolicy(policyId), plan);
    }
  });

  it("does not misread a lifetime policy as a plan", () => {
    // LIFETIME is a licence TYPE, not a team/individual plan: it must not
    // resolve to one of the six purchasable plans.
    assert.equal(planForKeygenPolicy(keygenPolicyId("lifetime")), undefined);
  });
});

describe("a user with a valid team licence", () => {
  it("unlocks team features through the real authorization path", async () => {
    // Source `manual` = a licence NASAQ itself issued (admin grant / fulfilled
    // subscription). Its entitlements come from the stored plan, so this is the
    // path that runs without a live provider call.
    await giveLicense({ userId: TEAM_USER, plan: "team-monthly", source: "manual" });
    const access = await getAuthorizationContext({ id: TEAM_USER, email: "team@example.com" });

    assert.ok(access.license, "the team licence was not resolved for its owner");
    assert.equal(access.license?.userId, TEAM_USER);
    assert.equal(access.entitlements.team_features, true);
    assert.equal(access.entitlements.collaboration, true);
    assert.equal(access.entitlements.multi_user_activation, true);
    // And the paid editor features the team plan also carries.
    assert.equal(access.entitlements.advanced_export, true);
    assert.equal(access.entitlements.premium_templates, true);
    assert.equal(access.entitlements.ai_report, true);
    // The server-side gate every protected server function calls.
    assert.doesNotThrow(() => requireFeature(access, "team_features"));
    assert.doesNotThrow(() => requireFeature(access, "ai_report"));
  });
});

describe("a team licence is never downgraded to individual", () => {
  it("keeps team flags for every team plan", () => {
    for (const plan of ["team-monthly", "team-quarterly", "team-annual"] as const) {
      const entitlements = entitlementsForPlan(plan, "PRO");
      assert.equal(entitlements.team_features, true, plan);
      assert.equal(entitlements.collaboration, true, plan);
      assert.equal(entitlements.multi_user_activation, true, plan);
    }
  });

  it("strips team flags from every individual plan", () => {
    for (const plan of ["individual-monthly", "individual-quarterly", "individual-annual"] as const) {
      const entitlements = entitlementsForPlan(plan, "PRO");
      assert.equal(entitlements.team_features, false, plan);
      assert.equal(entitlements.collaboration, false, plan);
      assert.equal(entitlements.multi_user_activation, false, plan);
      // …while the individual paid features stay on.
      assert.equal(entitlements.advanced_export, true, plan);
    }
  });

  it("grants team features on a LIFETIME licence", () => {
    const lifetime = entitlementsForPlan(undefined, "LIFETIME");
    assert.equal(lifetime.team_features, true);
    assert.equal(lifetime.multi_user_activation, true);
  });
});

describe("licence status is enforced", () => {
  it("gives an expired team licence no entitlements", async () => {
    await giveLicense({
      userId: SOLO_USER,
      plan: "team-monthly",
      source: "manual",
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const access = await getAuthorizationContext({ id: SOLO_USER, email: "solo@example.com" });
    assert.equal(access.license, null);
    assert.equal(access.entitlements.team_features, false);
    assert.equal(access.entitlements.advanced_export, false);
    assert.throws(() => requireFeature(access, "team_features"));
  });

  it("gives a revoked team licence no entitlements", async () => {
    await sql`delete from licenses where user_id = ${SOLO_USER}`;
    await giveLicense({ userId: SOLO_USER, plan: "team-quarterly", source: "manual", status: "REVOKED" });
    const access = await getAuthorizationContext({ id: SOLO_USER, email: "solo@example.com" });
    assert.equal(access.license, null);
    assert.equal(access.entitlements.team_features, false);
    assert.throws(() => requireFeature(access, "advanced_export"));
  });
});

describe("no licence, no team features", () => {
  it("leaves an unlicensed account on FREE", async () => {
    const access = await getAuthorizationContext({
      id: NO_LICENCE_USER,
      email: "none@example.com",
    });
    assert.equal(access.license, null);
    assert.equal(access.isAdmin, false);
    assert.equal(access.entitlements.team_features, false);
    assert.equal(access.entitlements.collaboration, false);
    assert.equal(access.entitlements.core_editor, true, "the free editor must stay usable");
    assert.throws(() => requireFeature(access, "team_features"));
    assert.throws(() => requireFeature(access, "ai_report"));
  });
});

describe("team entitlements do not leak between accounts", () => {
  it("does not hand one account another account's team licence", async () => {
    await sql`delete from licenses where user_id = ${SOLO_USER}`;
    // TEAM_USER already holds a valid team licence from the case above.
    const other = await getAuthorizationContext({ id: SOLO_USER, email: "solo@example.com" });
    assert.equal(other.license, null);
    assert.equal(other.entitlements.team_features, false);
  });

  it("ignores a team licence re-pointed at an account Keygen never verified", async () => {
    // A local row reassigned to SOLO_USER while Keygen still binds it to
    // TEAM_USER must not unlock anything: `findLicensesByUserId` filters on the
    // provider-verified identity, not on the local `user_id` alone.
    const id = await giveLicense({ userId: TEAM_USER, plan: "team-monthly" });
    await sql`update licenses set user_id = ${SOLO_USER} where id = ${id}`;
    const access = await getAuthorizationContext({ id: SOLO_USER, email: "solo@example.com" });
    assert.equal(access.entitlements.team_features, false);
    await sql`delete from licenses where id = ${id}`;
  });
});

describe("Keygen entitlement codes decide a Keygen licence", () => {
  it("unlocks team features from the nasaq.team code", () => {
    const team = entitlementsFromKeygenCodes(TEAM_CODES);
    assert.equal(team.team_features, true);
    assert.equal(team.collaboration, true);
  });

  it("grants nothing for a team policy whose entitlements are empty", () => {
    // The real dependency, stated plainly: a Keygen TEAM policy without the
    // `nasaq.team` entitlement attached produces a paid licence with no team
    // features. That is Keygen configuration, not a bug in this chain.
    const codes = entitlementsFromKeygenCodes([]);
    assert.equal(codes.team_features, false);
    assert.equal(codes.advanced_export, false);
    assert.equal(codes.core_editor, true, "the free editor still works");
  });

  it("never trusts a cached Keygen row without provider verification", async () => {
    // Fail-closed: with KEYGEN_API_TOKEN absent (or the provider unreachable)
    // a keygen-sourced row grants NOTHING, even while the local row says
    // ACTIVE. Only a user-scoped provider validation unlocks it.
    await sql`delete from licenses where user_id = ${SOLO_USER}`;
    await giveLicense({ userId: SOLO_USER, plan: "team-monthly", source: "keygen" });
    const access = await getAuthorizationContext({ id: SOLO_USER, email: "solo@example.com" });
    assert.equal(access.license, null);
    assert.equal(access.entitlements.team_features, false);
    await sql`delete from licenses where user_id = ${SOLO_USER}`;
  });
});

describe("the Keygen Team entitlement set maps onto the editor", () => {
  it("every required Team code is known to NASAQ's feature map", () => {
    // If a code the Keygen policy carries is absent from this map, a perfectly
    // configured policy would still unlock nothing in the editor.
    for (const code of TEAM_ENTITLEMENT_CODES) {
      assert.ok(code in KEYGEN_ENTITLEMENT_FEATURES, `${code} is unmapped`);
    }
  });

  it("the full Team code set unlocks the paid editor surface", () => {
    const features = editorFeaturesForCodes([...TEAM_ENTITLEMENT_CODES]);
    for (const feature of [
      "core_editor",
      "premium_templates",
      "unlimited_projects",
      "unlimited_pages",
      "data_import",
      "basic_export",
      "advanced_export",
      "brand_kit",
      "ai_report",
      "collaboration",
      "team_features",
      "multi_user_activation",
    ] as const) {
      assert.ok(features.includes(feature), `${feature} missing from Team entitlements`);
    }
  });

  it("dropping nasaq.team keeps PRO features but removes team flags", () => {
    const codes = TEAM_ENTITLEMENT_CODES.filter((code) => code !== "nasaq.team");
    const features = editorFeaturesForCodes([...codes]);
    assert.ok(features.includes("advanced_export"));
    assert.ok(!features.includes("team_features"));
    assert.ok(!features.includes("collaboration"));
  });

  it("collaboration reaches the product capability bridge", () => {
    // The real consumer of `collaboration` — without this hop the flag would
    // be inert no matter what Keygen returns.
    const team = licenseRecordFromEntitlements("PRO", undefined, "team-monthly");
    assert.equal(team.entitlements.collaboration, true);
    assert.equal(team.entitlements.organizationWorkspace, true);
    assert.equal(team.scope, "team");
    const solo = licenseRecordFromEntitlements("PRO", undefined, "individual-monthly");
    assert.equal(solo.entitlements.collaboration, false);
    assert.equal(solo.scope, "individual");
  });

  it("reports missing env vars by name only, never values", () => {
    const missing = missingTeamEnvVars();
    for (const name of missing) assert.match(name, /^KEYGEN_[A-Z_]+$/);
  });
});
