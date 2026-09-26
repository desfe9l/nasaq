/*
 * Generator → activation → account → Keygen → entitlements regression check.
 * Run: node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/license-compat-check.mjs
 *
 * The Keygen JSON:API is simulated here (no production token or user session in
 * the test sandbox). This tests the real issuance, binding, verification and SQL
 * paths, NOT whether a real key exists on the live Keygen account.
 */
import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
register(new URL("./ts-alias-loader.mjs", import.meta.url));

globalThis.__nasaqMigrations = () => {
  const dir = new URL("../migrations/", import.meta.url);
  return Object.fromEntries(readdirSync(dir).filter((name) => name.endsWith(".sql"))
    .map((name) => [`/migrations/${name}`, readFileSync(new URL(name, dir), "utf8")]));
};
process.env.KEYGEN_API_TOKEN = "offline-compat-test-token";
const PRODUCT = "c109271b-9c97-4827-bc9d-48e7982744fe";
process.env.KEYGEN_PRODUCT_ID = PRODUCT;
// Use a synthetic fixture in the public repository. A real key can be passed
// via the environment for a LOCAL offline simulation; never commit it.
const FULL_SAMPLE = process.env.NASAQ_COMPAT_KEY || "A1B2C3-D4E5F6-1A2B3C-4D5E6F-ABCDEF-V3";
const SHORT_SAMPLE = FULL_SAMPLE.replace(/-[0-9A-F]{6}(?=-V\d+$)/, "");
const INDIVIDUAL_POLICY = "e9bea931-5416-4a91-95f8-8a90b26a2cd6";
const TRIAL_POLICY = "ab6e0fdd-7e5e-4329-afe1-6c9e6b92acb7";
const LIFETIME_POLICY = "3704e4a4-5645-4be7-b6c9-2067c722341d";

const records = new Map();
const users = new Map();
let nextKey = 1;
let userCreations = 0;
let attachments = 0;
const json = (body, status = 200) => Response.json(body, { status });
const error = (status, message) => json({ errors: [{ detail: message }] }, status);
const authorized = (init) => new Headers(init.headers).get("authorization") === `Bearer ${process.env.KEYGEN_API_TOKEN}`;
const userResource = (user) => ({ id: user.id, type: "users", attributes: { email: user.email, metadata: user.metadata } });
const licenseResource = (record) => ({
  id: record.id, type: "licenses",
  attributes: { key: record.key, expiry: record.expiry, status: record.status, suspended: record.status === "SUSPENDED", uses: 0,
    maxUsers: record.maxUsers ?? null, metadata: record.metadata },
  relationships: {
    owner: { data: record.ownerId ? { type: "users", id: record.ownerId } : null },
    users: { meta: { count: record.users.size } },
    policy: { data: { type: "policies", id: record.policyId } },
    product: { data: { type: "products", id: record.productId } },
  },
});
const recordById = (id) => [...records.values()].find((r) => r.id === id);
const allFeatures = ["nasaq.editor", "nasaq.templates", "nasaq.projects", "nasaq.library", "nasaq.export",
  "nasaq.advanced-export", "nasaq.brand-kit", "nasaq.advanced-tools"];

globalThis.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const path = parsed.pathname.replace(/^\/v1\/accounts\/[^/]+/, "");
  const method = init.method || "GET";
  const body = init.body ? JSON.parse(String(init.body)) : {};
  if (path === "/licenses" && method === "POST") {
    if (!authorized(init)) return error(403, "missing token");
    const attrs = body?.data?.attributes || {};
    const policyId = body?.data?.relationships?.policy?.data?.id;
    const ownerId = body?.data?.relationships?.owner?.data?.id ?? null;
    const key = nextKey === 1 ? FULL_SAMPLE : `${nextKey.toString(16).padStart(6, "0")}-ABCDEF-123456-0A0B0C-A1B2C3-V3`.toUpperCase();
    const record = { id: `kg-${nextKey++}`, key, policyId, productId: PRODUCT, ownerId, users: new Set(),
      status: "ACTIVE", maxUsers: attrs.maxUsers ?? null, expiry: attrs.expiry ?? null, metadata: attrs.metadata ?? {} };
    records.set(key, record);
    return json({ data: licenseResource(record) }, 201);
  }
  if (path === "/licenses" && method === "GET") {
    if (!authorized(init)) return error(403, "missing token");
    const metadataFilters = [...parsed.searchParams.entries()].filter(([name]) => name.startsWith("metadata["));
    const match = [...records.values()].find((record) => metadataFilters.every(([name, value]) =>
      record.metadata?.[name.slice("metadata[".length, -1)] === value));
    return json({ data: match ? [licenseResource(match)] : [] });
  }
  if (path === "/licenses/actions/validate-key" && method === "POST") {
    const key = body?.meta?.key || "";
    const record = records.get(key);
    const scope = body?.meta?.scope || {};
    const owner = [...users.values()].find((u) => u.id === record?.ownerId);
    const licensedUsers = [...users.values()].filter((u) => record?.users.has(u.id));
    const allowed = [owner, ...licensedUsers].some((u) => u?.email === scope.user);
    const code = !record ? "NOT_FOUND"
      : scope.product !== record.productId ? "PRODUCT_SCOPE_MISMATCH"
      : !scope.user ? "USER_SCOPE_REQUIRED"
      : record.status === "SUSPENDED" ? "SUSPENDED"
      : record.expiry && Date.parse(record.expiry) <= Date.now() ? "EXPIRED"
      : !allowed ? "USER_SCOPE_MISMATCH" : "VALID";
    return json({ meta: { valid: code === "VALID", code }, data: record ? licenseResource(record) : null });
  }
  if (path === "/users" && method === "POST") {
    if (!authorized(init)) return error(403, "missing token");
    const email = body?.data?.attributes?.email;
    if (users.has(email)) return error(409, "user already exists");
    const user = { id: `keygen-user-${users.size + 1}`, email, metadata: body?.data?.attributes?.metadata || {} };
    users.set(email, user);
    userCreations++;
    return json({ data: userResource(user) }, 201);
  }
  const userPath = path.match(/^\/users\/([^/]+)$/);
  if (userPath && method === "GET") {
    if (!authorized(init)) return error(403, "missing token");
    const user = users.get(decodeURIComponent(userPath[1]));
    return user ? json({ data: userResource(user) }) : error(404, "user not found");
  }
  const licensePath = path.match(/^\/licenses\/([^/]+)$/);
  if (licensePath && method === "GET") {
    if (!authorized(init)) return error(403, "missing token");
    const record = recordById(licensePath[1]);
    return record ? json({ data: licenseResource(record) }) : error(404, "license not found");
  }
  const licenseUsers = path.match(/^\/licenses\/([^/]+)\/users$/);
  if (licenseUsers && method === "POST") {
    if (!authorized(init)) return error(403, "missing token");
    const record = recordById(licenseUsers[1]);
    const id = body?.data?.[0]?.id;
    if (!record || ![...users.values()].some((u) => u.id === id)) return error(404, "license/user not found");
    if (record.ownerId || record.users.size || (record.maxUsers != null && record.maxUsers < 1)) return error(409, "already assigned");
    record.users.add(id);
    attachments++;
    return json({ data: [{ type: "license-users", id: `rel-${record.id}` }] }, 201);
  }
  const entitlements = path.match(/^\/licenses\/([^/]+)\/entitlements$/);
  if (entitlements && method === "GET") {
    if (!authorized(init)) return error(403, "missing token");
    const record = recordById(entitlements[1]);
    if (!record) return error(404, "license not found");
    const codes = record.policyId === LIFETIME_POLICY ? [...allFeatures, "nasaq.team"] : allFeatures;
    return json({ data: codes.map((code, i) => ({ type: "license-entitlements", id: `rel-${i}`,
      relationships: { entitlement: { data: { id: `ent-${i}`, type: "entitlements" } } } })),
      included: codes.map((code, i) => ({ type: "entitlements", id: `ent-${i}`, attributes: { code } })) });
  }
  return error(404, `unhandled ${method} ${path}`);
};

process.chdir(new URL("..", import.meta.url).pathname);
const { getSql } = await import("../src/lib/db.ts");
const sql = await getSql();
const keys = await import("../src/lib/license/key.ts");
const keygen = await import("../src/lib/license/keygen.ts");
const db = await import("../src/lib/license/server.ts");
const activation = await import("../src/lib/license/activation.server.ts");
const { entitlementsFromKeygenCodes } = await import("../src/lib/license/types.ts");
const { getAuthorizationContext } = await import("../src/lib/auth/authorization.server.ts");
const USER = { userId: "auth-user-1", userEmail: "member@nasaq.example" };
const OTHER = { userId: "auth-user-2", userEmail: "stranger@nasaq.example" };

console.log("NASAQ user-scoped license: offline provider + real generator/SQL flow");
const issued = await keygen.createKeygenLicense({ plan: "lifetime", name: "NASAQ LIFETIME" });
assert.equal(issued.key, FULL_SAMPLE); // mock issued, not live Keygen
assert.equal(issued.userScopeVerified, false); // creation alone cannot prove user scope
assert.ok(keys.isGeneratedKeyFormat(issued.key));
assert.ok(!keys.isGeneratedKeyFormat(SHORT_SAMPLE)); // a missing group is invalid
assert.ok(keys.isValidKeyFormat("NASAQ-ABCD-EFGH-IJKL-MNOP"));
const unclaimedRow = await activation.persistKeygenLicense(issued, null);
assert.equal(unclaimedRow.userId, null);
await assert.rejects(db.assignLicense(unclaimedRow.id, USER.userId), { name: "LicenseOwnershipError" });

// Reproduce the original backend error: user-locked policy, no user in scope.
const unscoped = await fetch(`https://api.keygen.sh/v1/accounts/${keygen.keygenAccount()}/licenses/actions/validate-key`, {
  method: "POST", body: JSON.stringify({ meta: { key: issued.key, scope: { product: PRODUCT } } }),
});
assert.equal((await unscoped.json()).meta.code, "USER_SCOPE_REQUIRED");
const before = await keygen.validateKeygenLicense(FULL_SAMPLE, USER.userEmail);
assert.equal(before.code, "USER_SCOPE_MISMATCH");
assert.equal(before.valid, false);
const missingEmail = await activation.activateKeygenForSession(FULL_SAMPLE, { ...USER, userEmail: null });
assert.equal(missingEmail.success, false);
assert.equal(userCreations, 0);

const variant = `  ${FULL_SAMPLE.toLowerCase().replace("-v", "- v")} `;
const active = await activation.activateKeygenForSession(variant, USER);
assert.equal(active.success, true, active.message);
assert.equal(active.license.userId, USER.userId);
assert.equal(active.license.status, "ACTIVE");
assert.equal(active.license.type, "LIFETIME");
assert.equal(active.license.metadata?.userScopeVerified, USER.userId);
assert.equal(active.verification.userScopeVerified, true);
assert.equal(active.verification.entitlementCodes.includes("nasaq.team"), true);
assert.equal(userCreations, 1);
assert.equal(attachments, 1);
const entitlements = entitlementsFromKeygenCodes(active.verification.entitlementCodes);
assert.equal(entitlements.advanced_export, true);
assert.equal(entitlements.collaboration, true);
assert.equal((await getAuthorizationContext({ id: USER.userId, email: USER.userEmail })).entitlements.advanced_export, true);
assert.equal((await getAuthorizationContext({ id: OTHER.userId, email: OTHER.userEmail })).entitlements.advanced_export, false);
console.log("  ok  user session → provider binding → LIFETIME/ACTIVE + feature gates + account persistence");

const afterReload = await activation.revalidateKeygenForSession(variant, USER);
assert.equal(afterReload.valid, true);
assert.equal(afterReload.license?.id, active.license.id);
assert.equal((await keygen.validateKeygenLicenseById(active.verification.licenseId, USER.userEmail)).valid, true);
const linked = await activation.revalidateLinkedKeygenLicense(
  await db.findLicenseByKeyHash(keys.hashLicenseKey(FULL_SAMPLE)), USER);
assert.equal(linked?.status, "ACTIVE");
assert.equal(linked?.userId, USER.userId);
assert.equal(await activation.revalidateLinkedKeygenLicense(linked, OTHER), null);
assert.equal((await db.findLicenseByKeyHash(keys.hashLicenseKey(FULL_SAMPLE)))?.userId, USER.userId);
assert.equal((await activation.revalidateKeygenForSession(FULL_SAMPLE, OTHER)).valid, false);
const stolen = await activation.activateKeygenForSession(FULL_SAMPLE, OTHER);
assert.equal(stolen.success, false);
assert.equal(attachments, 1);
console.log("  ok  reload preserves account, another session cannot validate or steal it");

const badKey = `${FULL_SAMPLE[0] === "A" ? "B" : "A"}${FULL_SAMPLE.slice(1)}`;
assert.ok(keys.isGeneratedKeyFormat(badKey));
const usersBeforeInvalid = userCreations;
const bad = await activation.activateKeygenForSession(badKey, USER);
assert.equal(bad.success, false);
assert.equal((await keygen.validateKeygenLicense(badKey, USER.userEmail)).code, "NOT_FOUND");
assert.equal((await activation.activateKeygenForSession(SHORT_SAMPLE, USER)).success, false);
assert.equal(userCreations, usersBeforeInvalid);
assert.equal((await db.findLicenseByKeyHash(keys.hashLicenseKey(badKey))), null);
console.log("  ok  invalid same-format key and shortened sample rejected (no registration / entitlements)");

const paid = await keygen.createKeygenLicense({ plan: "individual-monthly", metadata: { nasaqUserId: USER.userId } });
assert.equal(paid.policyId, INDIVIDUAL_POLICY);
const preIssued = await activation.persistKeygenLicense(paid, USER.userId);
assert.equal(preIssued.metadata.userScopeVerified, undefined); // previously paid rows remain usable
assert.equal((await activation.activateKeygenForSession(paid.key, OTHER)).success, false);
const paidAct = await activation.activateKeygenForSession(paid.key, USER);
assert.equal(paidAct.success, true);
const individual = entitlementsFromKeygenCodes(paidAct.verification.entitlementCodes);
assert.equal(individual.advanced_export, true);
assert.equal(individual.team_features, false);
console.log("  ok  pre-assigned NASAQ account enforced; individual features do not include team features");

// Admin issuance to a named account links its Keygen user before publishing it.
const TARGET = { userId: "auth-target", userEmail: "target@nasaq.example" };
const targetKeygenId = await keygen.ensureKeygenUser(TARGET);
const assigned = await keygen.createKeygenLicense({ plan: "lifetime", ownerId: targetKeygenId,
  metadata: { nasaqUserId: TARGET.userId } });
assert.equal(assigned.userScopeVerified, false); // generator response isn't validation
const assignedVerified = await keygen.validateKeygenLicense(assigned.key, TARGET.userEmail);
assert.equal(assignedVerified.valid, true);
const assignedRow = await activation.persistKeygenLicense(assignedVerified, TARGET.userId);
assert.equal(assignedRow.metadata.userScopeVerified, TARGET.userId);
assert.equal((await getAuthorizationContext({ id: TARGET.userId, email: TARGET.userEmail })).entitlements.advanced_export, true);
assert.equal((await activation.activateKeygenForSession(assigned.key, OTHER)).success, false);
console.log("  ok  admin-issued key is owned and verified for its target before feature access");

// Two signed-in accounts racing on a first-come key must not both claim it.
const raceKey = (await keygen.createKeygenLicense({ plan: "lifetime" })).key;
const concurrent = await Promise.all([
  activation.activateKeygenForSession(raceKey, USER),
  activation.activateKeygenForSession(raceKey, OTHER),
]);
assert.equal(concurrent.filter((result) => result.success).length, 1);
const winner = concurrent.find((result) => result.success);
assert.equal((await db.findLicenseByKeyHash(keys.hashLicenseKey(raceKey)))?.userId,
  winner === concurrent[0] ? USER.userId : OTHER.userId);
console.log("  ok  concurrent first claims permit exactly one account");

// Even a stale local reassignment cannot bypass the provider user binding.
const reassignedKey = (await keygen.createKeygenLicense({ plan: "lifetime" })).key;
const reassigned = await activation.activateKeygenForSession(reassignedKey, USER);
assert.equal(reassigned.success, true);
const THIRD = { userId: "auth-user-3", userEmail: "other@nasaq.example" };
await assert.rejects(db.assignLicense(reassigned.license.id, THIRD.userId), { name: "LicenseOwnershipError" });
await sql.query(`UPDATE licenses SET user_id = $2 WHERE id = $1`, [reassigned.license.id, THIRD.userId]);
assert.equal((await getAuthorizationContext({ id: THIRD.userId, email: THIRD.userEmail })).entitlements.advanced_export, false);
assert.equal(await activation.revalidateLinkedKeygenLicense(
  await db.findLicenseByKeyHash(keys.hashLicenseKey(reassignedKey)), THIRD), null);
console.log("  ok  stale local reassignment cannot grant provider-locked features");

// Existing provider-owned licenses stay attached to their original email.
users.set("existing@nasaq.example", { id: "already-keygen", email: "existing@nasaq.example", metadata: {} });
const alreadyAssigned = await keygen.createKeygenLicense({ plan: "lifetime", ownerId: "already-keygen" });
assert.equal((await activation.activateKeygenForSession(alreadyAssigned.key, USER)).success, false);
assert.equal((await activation.activateKeygenForSession(alreadyAssigned.key, { userId: "existing", userEmail: "existing@nasaq.example" })).success, true);

const past = new Date(Date.now() - 86400000).toISOString();
const expired = await keygen.createKeygenLicense({ plan: "trial", expiresAt: past });
assert.equal(expired.policyId, TRIAL_POLICY);
assert.equal((await activation.activateKeygenForSession(expired.key, USER)).success, false);
const trial = await keygen.createKeygenLicense({ plan: "trial" });
const trialActive = await activation.activateKeygenForSession(trial.key, USER);
assert.equal(trialActive.success, true);
assert.equal(trialActive.license.type, "TRIAL");
records.get(trial.key).expiry = past;
assert.equal(await activation.revalidateLinkedKeygenLicense(trialActive.license, USER), null);
assert.equal((await activation.revalidateKeygenForSession(trial.key, USER)).valid, false);
assert.equal((await db.findLicenseByKeyHash(keys.hashLicenseKey(trial.key)))?.status, "EXPIRED");
const revoked = await keygen.createKeygenLicense({ plan: "lifetime" });
const revokedActive = await activation.activateKeygenForSession(revoked.key, USER);
assert.equal(revokedActive.success, true);
records.get(revoked.key).status = "SUSPENDED";
assert.equal(await activation.revalidateLinkedKeygenLicense(revokedActive.license, USER), null);
assert.equal((await activation.revalidateKeygenForSession(revoked.key, USER)).valid, false);
assert.equal((await db.findLicenseByKeyHash(keys.hashLicenseKey(revoked.key)))?.status, "REVOKED");
console.log("  ok  TRIAL, EXPIRED and REVOKED revoke gated access on revalidation");

// Gumroad fulfilment must bind the payer at Keygen before it can report PAID.
// Retries reuse the same provider key; the licence can never move to another account.
const { issueGumroadKeygenLicense } = await import("../src/lib/license/gumroad-fulfillment.server.ts");
const PAID = { userId: "auth-paid", userEmail: "paid@nasaq.example" };
await sql.query(`insert into "user" (id, name, email, "emailVerified") values ($1, $2, $3, true)`,
  [PAID.userId, "Paid customer", PAID.userEmail]);
const paidExpiry = new Date(Date.now() + 30 * 86400000).toISOString();
const subscriptionId = "gum-sub-compat-1";
const paidInput = { saleId: "gum-sale-compat-1", subscriptionId, userId: PAID.userId,
  userEmail: PAID.userEmail, plan: "individual-monthly", planName: "Individual Monthly",
  expiresAt: paidExpiry, recurringCharge: false };
const countBeforePaid = records.size;
const boundPaid = await issueGumroadKeygenLicense(paidInput);
assert.equal(records.size, countBeforePaid + 1);
assert.equal(boundPaid.userId, PAID.userId);
assert.equal(boundPaid.metadata?.userScopeVerified, PAID.userId);
assert.equal((await getAuthorizationContext({ id: PAID.userId, email: PAID.userEmail })).entitlements.advanced_export, true);
assert.equal((await issueGumroadKeygenLicense(paidInput)).id, boundPaid.id);
assert.equal(records.size, countBeforePaid + 1, "a ping retry must never mint again");
await assert.rejects(() => issueGumroadKeygenLicense({ ...paidInput, userId: OTHER.userId, userEmail: OTHER.userEmail }));
assert.equal((await db.listAllLicenses(0, 10, PAID.userEmail)).licenses[0]?.userEmail, PAID.userEmail);
assert.equal("keyHash" in (await db.listAllLicenses(0, 10, PAID.userEmail)).licenses[0], false);
console.log("  ok  verified Gumroad charge → Keygen user scope → account, idempotency and admin search");

// Provider outages must not leave stale paid features usable via server gates.
const fetchOnline = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/licenses/actions/validate-key")) throw new Error("provider offline");
  return fetchOnline(url, init);
};
assert.equal((await getAuthorizationContext({ id: PAID.userId, email: PAID.userEmail })).entitlements.advanced_export, false);
assert.equal((await db.findLicenseById(boundPaid.id))?.status, "ACTIVE", "outage must not revoke");
globalThis.fetch = fetchOnline;
console.log("  ok  paid features fail closed while Keygen is unreachable without revocation");

// Existing administrator-approved subscriptions are an independent activation
// path. They work without a browser key, take their plan from the catalog,
// expire on the server, and explicit account suspension overrides all keys.
const admin = await import("../src/lib/commercial/admin.server.ts");
const ACTOR = { adminUserId: "offline-admin" };
const MANUAL = { id: "manual-user", email: "manual@nasaq.example" };
await admin.activateCustomer(sql, ACTOR, MANUAL.id, "team-monthly");
const manual = await getAuthorizationContext(MANUAL);
assert.equal(manual.license?.metadata?.source, "manual");
assert.equal(manual.entitlements.advanced_export, true);
assert.equal(manual.entitlements.team_features, true);
await admin.suspendCustomer(sql, ACTOR, MANUAL.id);
const suspended = await getAuthorizationContext(MANUAL);
assert.equal(suspended.isSuspended, true);
assert.equal(suspended.license, null);
assert.equal(suspended.entitlements.advanced_export, false);
await admin.restoreCustomer(sql, ACTOR, MANUAL.id);
assert.equal((await getAuthorizationContext(MANUAL)).entitlements.advanced_export, true);
await admin.setExpiration(sql, ACTOR, MANUAL.id, new Date(Date.now() - 86400000));
assert.equal((await getAuthorizationContext(MANUAL)).entitlements.advanced_export, false);
console.log("  ok  manual activation → plan features → suspension → restore → expiry");

await admin.grantEntitlement(sql, { userId: PAID.userId,
  plan: { id: "individual-monthly", durationDays: 30 }, sourceTransactionId: "gumroad:sale-compat-manual" });
await admin.suspendCustomer(sql, ACTOR, PAID.userId);
assert.equal((await getAuthorizationContext({ id: PAID.userId, email: PAID.userEmail })).entitlements.advanced_export, false,
  "a suspended customer cannot use an otherwise valid Keygen license");
await admin.restoreCustomer(sql, ACTOR, PAID.userId);
assert.equal((await getAuthorizationContext({ id: PAID.userId, email: PAID.userEmail })).entitlements.advanced_export, true);
// A deliberate manual reactivation supersedes the prior paid source. Only
// then is it safe to allow features while Keygen is down.
await admin.activateCustomer(sql, ACTOR, PAID.userId, "individual-monthly");
const { getSubscription } = await import("../src/lib/commercial/entitlement.server.ts");
assert.equal((await getSubscription(sql, PAID.userId))?.source_transaction_id, null);
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith("/licenses/actions/validate-key")) throw new Error("provider offline");
  return fetchOnline(url, init);
};
assert.equal((await getAuthorizationContext({ id: PAID.userId, email: PAID.userEmail })).license?.metadata?.source, "manual");
assert.equal((await getAuthorizationContext({ id: PAID.userId, email: PAID.userEmail })).entitlements.advanced_export, true);
globalThis.fetch = fetchOnline;
console.log("  ok  suspension overrides Keygen; explicit manual activation supersedes the paid source");

const legacy = await db.createLicense({ type: "PRO" });
const legacyHash = keys.hashLicenseKey(legacy.plainKey);
assert.equal((await db.activateLicense(legacyHash, USER.userId)).success, true);
assert.equal((await db.activateLicense(legacyHash, USER.userId)).license?.activationCount, 1);
assert.equal((await db.activateLicense(legacyHash, OTHER.userId)).error, "USER_SCOPE_MISMATCH");
assert.equal((await db.validateLicense(legacyHash)).valid, true);
assert.equal((await db.findLicenseByKeyHash(legacyHash))?.userId, USER.userId);
console.log("  ok  legacy NASAQ- key still works, is idempotent and cannot move accounts");
console.log("\nAll offline license integration checks passed.");
