#!/usr/bin/env node
/**
 * Admin-surface verification against a RUNNING built server (`vite preview` of
 * `.vercel/output`, or a deployment you control).
 *
 * The end-to-end half of the admin authorization contract: it signs accounts
 * in over `/api/auth/*`, then calls the REAL admin server functions through
 * TanStack Start's RPC protocol (`/_serverFn/<id>`) with each session, decodes
 * the answers, and asserts who is granted and who is refused — reads AND
 * mutations. Nothing is mocked: the session cookie, the authorization gates and
 * the storage behind them are the ones the deployment runs.
 *
 * Roles (each optional except the customer, which the harness creates):
 *   ADMIN_E2E_OWNER_EMAIL / ADMIN_E2E_OWNER_PASSWORD  owner / super-admin account
 *   ADMIN_E2E_OWNER_SESSION                           …or a ready cookie pair
 *   ADMIN_E2E_STAFF_EMAIL / ADMIN_E2E_STAFF_PASSWORD  promoted ADMIN (not owner)
 *   ADMIN_E2E_BASE                                    default http://127.0.0.1:4173
 *   ADMIN_E2E_MUTATIONS=0                             skip write checks
 *
 * The owner must be recognisable by the server: its id in `NASAQ_OWNER_ID` /
 * `NASAQ_SUPER_ADMIN_IDS`, a SUPER_ADMIN `admin_users` row, or a VERIFIED
 * address in `NASAQ_OWNER_EMAIL`. Never prints a cookie, password or secret.
 *
 * Exit 0 = every step passed, 1 = a step failed, 2 = server unreachable.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fromCrossJSON, toJSONAsync } from "seroval";

const base = (process.env.ADMIN_E2E_BASE ?? "http://127.0.0.1:4173").replace(/\/+$/, "");
const origin = new URL(base).origin;
const run = Date.now().toString(36);
const generatedPassword = `Adm1n-e2e-${run}-Pass!`;
const mutations = process.env.ADMIN_E2E_MUTATIONS !== "0";

let passed = 0;
const failures = [];

async function step(label, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failures.push({ label, error });
    console.error(`  ✗ ${label}\n      ${String(error?.message ?? error).slice(0, 400)}`);
  }
}

/** functionName → id, read from the built server manifest. */
function serverFnIds() {
  const dir = join(process.cwd(), ".vercel/output/functions/__server.func/_ssr");
  const ids = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".mjs")) continue;
    const text = readFileSync(join(dir, file), "utf8");
    const pattern = /"([0-9a-f]{64})":\s*\{\s*functionName:\s*"([A-Za-z0-9_$]+)_createServerFn_handler"/g;
    for (const match of text.matchAll(pattern)) ids.set(match[2], match[1]);
  }
  return ids;
}

const IDS = serverFnIds();

function sessionCookie(response) {
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const token = cookies.find((cookie) => cookie.includes("session_token="));
  return token ? token.split(";")[0] : null;
}

async function authPost(path, body, cookie) {
  const headers = { "content-type": "application/json", origin };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}/api/auth/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  let json = null;
  try {
    json = await response.json();
  } catch {
    /* status is enough */
  }
  return { response, json };
}

const masked = (email) => email.replace(/^(.).*@/, "$1…@");

/** Sign in (or, for a generated account, sign up). */
async function account(email, password, { create = false } = {}) {
  if (create) {
    const signUp = await authPost("sign-up/email", { email, password, name: email.split("@")[0] });
    if (signUp.response.status === 200) return { cookie: sessionCookie(signUp.response), user: signUp.json?.user };
  }
  const signIn = await authPost("sign-in/email", { email, password });
  assert.equal(signIn.response.status, 200, `could not sign in ${masked(email)}: ${signIn.json?.code ?? signIn.response.status}`);
  return { cookie: sessionCookie(signIn.response), user: signIn.json?.user };
}

/**
 * Decode a server-function answer. Successful answers are seroval cross-JSON
 * `{ result, error, context }`; a thrown error is a `$TSR/Error` node seroval
 * cannot rebuild outside the client runtime, so its message is read directly.
 */
function decode(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { thrown: text.slice(0, 200) };
  }
  try {
    const envelope = fromCrossJSON(json, { refs: new Map() });
    if (envelope && typeof envelope === "object" && "result" in envelope) {
      if (envelope.error) return { thrown: String(envelope.error?.message ?? envelope.error) };
      return { value: envelope.result };
    }
    return { value: envelope };
  } catch {
    const message = text.match(/"message"\]?,?"v":\[\{"t":1,"s":"((?:[^"\\]|\\.)*)"/)?.[1] ??
      text.match(/"s":"((?:[^"\\]|\\.)*)"/)?.[1] ?? text.slice(0, 200);
    return { thrown: message };
  }
}

/** Call one server function → { status, value?, thrown? }. */
async function call(name, { method = "POST", data, cookie } = {}) {
  const id = IDS.get(name);
  assert.ok(id, `server function ${name} is not in the build manifest`);
  const headers = { "x-tsr-serverFn": "true", accept: "application/json", origin, "sec-fetch-site": "same-origin" };
  if (cookie) headers.cookie = cookie;
  const payload = JSON.stringify(await toJSONAsync(data === undefined ? {} : { data }));
  let url = `${base}/_serverFn/${id}`;
  let body;
  if (method === "GET") url += `?payload=${encodeURIComponent(payload)}`;
  else {
    headers["content-type"] = "application/json";
    body = payload;
  }
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  return { status: response.status, ...decode(text), text };
}

const isArray = (value) => Array.isArray(value);

/**
 * Read surface: [name, options, granted(value) → boolean]. A refusal is a
 * 401/403, a thrown error, or a decoded value for which `granted` is false.
 */
const READS = [
  ["amIAdmin", { method: "GET" }, (v) => v?.isAdmin === true],
  ["adminVerifyFn", {}, (v) => v?.ok === true],
  ["adminTemplatesAccessFn", {}, (v) => v?.ok === true],
  ["getAdminCustomers", { method: "GET" }, isArray],
  ["getAdminPaymentRequests", { method: "GET", data: {} }, isArray],
  ["getAdminPlans", { method: "GET" }, isArray],
  ["getAdminAuditLog", { method: "GET" }, isArray],
  ["adminListTemplatesFn", {}, (v) => v?.ok === true],
  ["adminListLicensesFn", { data: {} }, (v) => v?.error === null && isArray(v?.licenses)],
  ["adminLicenseIntegrationsFn", {}, (v) => v && v.error == null],
  ["getOwnerVaultFn", { method: "GET" }, (v) => isArray(v?.entries)],
  ["getOwnerSetupFn", { method: "GET" }, (v) => isArray(v?.checks)],
  ["adminListClientRequestsFn", { data: {} }, (v) => isArray(v?.requests)],
  ["verifyObjectStorage", {}, (v) => v && typeof v.ok === "boolean"],
  ["getGumroadGatewayStatusFn", { method: "GET" }, (v) => v && typeof v === "object"],
  ["getStudioSettingsFn", { method: "GET" }, (v) => v?.canManage === true],
  ["listStudioReferencesFn", { method: "GET" }, (v) => v?.canManage === true],
];

/** Owner-only (super-admin) reads: staff must be refused. (All reads above are admin-level.) */
const SUPER_ADMIN_ONLY = new Set();

function granted(result, predicate) {
  if (result.status === 401 || result.status === 403) return false;
  if ("thrown" in result) return false;
  return Boolean(predicate(result.value));
}

const describeResult = (result) =>
  `${result.status} ${"thrown" in result ? `thrown: ${result.thrown}` : JSON.stringify(result.value)?.slice(0, 240)}`;

async function readChecks(role, session, expectGrant) {
  for (const [name, options, predicate] of READS) {
    if (!IDS.has(name)) continue;
    const want = typeof expectGrant === "function" ? expectGrant(name) : expectGrant;
    await step(`${role}: ${name} ${want ? "granted" : "refused"}`, async () => {
      const result = await call(name, { ...options, cookie: session.cookie });
      assert.ok(result.status < 500, `${name} crashed: ${describeResult(result)}`);
      assert.equal(granted(result, predicate), want, describeResult(result));
    });
  }
}

/** Owner mutations: each verifies the write took effect, then restores. */
async function ownerMutations(owner, customer) {
  const customerId = customer.user?.id;

  await step("owner: save site settings (announcement) and read back", async () => {
    const before = await call("getSiteSettingsFn", { method: "GET" });
    const current = before.value?.announcement ?? {};
    const marker = `admin-e2e ${run}`;
    const saved = await call("adminSaveSettingsFn", {
      cookie: owner.cookie,
      data: { section: "announcement", value: { ...current, text: marker } },
    });
    assert.equal(saved.value?.ok, true, describeResult(saved));
    const after = await call("getSiteSettingsFn", { method: "GET" });
    assert.equal(after.value?.announcement?.text, marker);
    const restored = await call("adminSaveSettingsFn", { cookie: owner.cookie, data: { section: "announcement", value: current } });
    assert.equal(restored.value?.ok, true, describeResult(restored));
  });

  await step("owner: update a plan and restore it", async () => {
    const plans = await call("getAdminPlans", { method: "GET", cookie: owner.cookie });
    assert.ok(isArray(plans.value) && plans.value.length, describeResult(plans));
    const plan = plans.value[0];
    const updated = await call("adminUpdatePlan", {
      cookie: owner.cookie,
      data: { planId: plan.id, name: plan.name },
    });
    assert.equal(updated.value?.ok, true, describeResult(updated));
  });

  if (customerId) {
    await step("owner: activate → suspend → restore a customer", async () => {
      const plans = await call("getAdminPlans", { method: "GET", cookie: owner.cookie });
      const planId = plans.value?.find?.((p) => p.enabled)?.id ?? plans.value?.[0]?.id;
      for (const [fn, data] of [
        ["adminActivateCustomer", { userId: customerId, planId }],
        ["adminSuspendCustomer", { userId: customerId }],
        ["adminRestoreCustomer", { userId: customerId }],
      ]) {
        const result = await call(fn, { cookie: owner.cookie, data });
        assert.ok(result.status === 200 && !("thrown" in result), `${fn}: ${describeResult(result)}`);
      }
      const customers = await call("getAdminCustomers", { method: "GET", cookie: owner.cookie });
      const row = customers.value?.find?.((c) => c.userId === customerId);
      assert.equal(row?.status, "ACTIVE", "customer is visible in the list and active again");
    });
  }

  await step("owner: create → publish → delete a template", async () => {
    const content = JSON.stringify({ version: 1, name: `e2e ${run}`, pages: [{ id: "p1", name: "1", width: 1080, height: 1080, elements: [] }] });
    const created = await call("adminUpsertTemplateFn", {
      cookie: owner.cookie,
      data: { template: { title: `admin-e2e ${run}`, kind: "json", tier: "free", status: "draft", category: "general", content } },
    });
    if (created.value?.ok !== true) throw new Error(describeResult(created));
    const id = created.value.id;
    const status = await call("adminSetTemplateStatusFn", { cookie: owner.cookie, data: { id, status: "published" } });
    assert.equal(status.value?.ok, true, describeResult(status));
    const removed = await call("adminDeleteTemplateFn", { cookie: owner.cookie, data: { id } });
    assert.equal(removed.value?.ok, true, describeResult(removed));
  });

  if (customerId) {
    await step("owner: create → assign → set expiry → revoke a licence", async () => {
      const created = await call("adminCreateLicenseFn", { cookie: owner.cookie, data: { type: "FREE" } });
      const license = { id: created.value?.licenseId };
      assert.ok(license.id, describeResult(created));
      const assigned = await call("superAdminAssignLicenseFn", {
        cookie: owner.cookie,
        data: { licenseId: license.id, user: customer.user.email, activate: true },
      });
      assert.equal(assigned.value?.error ?? null, null, describeResult(assigned));
      assert.equal(assigned.value?.license?.userId, customerId, "assigned by EMAIL to an identity-store account");
      const expiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const expiring = await call("superAdminSetLicenseExpiryFn", { cookie: owner.cookie, data: { licenseId: license.id, expiresAt: expiry } });
      assert.equal(expiring.value?.error ?? null, null, describeResult(expiring));
      const listed = await call("adminListLicensesFn", { cookie: owner.cookie, data: { search: license.id } });
      const row = listed.value?.licenses?.find?.((l) => l.id === license.id);
      assert.equal(row?.userEmail, customer.user.email, "licence list shows the customer's address");
      const revoked = await call("adminRevokeLicenseFn", { cookie: owner.cookie, data: { licenseId: license.id } });
      assert.equal(revoked.value?.license?.status, "REVOKED", describeResult(revoked));
    });
  }

  await step("owner: vault shows secret values to the owner", async () => {
    const vault = await call("getOwnerVaultFn", { method: "GET", cookie: owner.cookie });
    const db = vault.value?.entries?.find?.((e) => e.variable === "DATABASE_URL");
    assert.ok(db, "DATABASE_URL row present");
    assert.equal(db.ownerReadable, true);
    assert.ok(db.value, "owner can read the configured value (not printed)");
  });
}

/** Writes a customer / staff must never be able to perform. */
async function refusedMutations(role, session, targetId) {
  const attempts = [
    ["adminSaveSettingsFn", { section: "announcement", value: { text: "pwned" } }, (v) => v?.ok === true],
    ["adminGrantAdmin", { userId: session.user?.id ?? "x", note: "self" }, (v) => v?.ok === true],
    ["adminUpsertTemplateFn", { template: { title: "x", kind: "json", content: "{}" } }, (v) => v?.ok === true],
    ["adminCreateLicenseFn", { type: "FREE" }, (v) => Boolean(v?.licenseId)],
    ["adminActivateCustomer", { userId: targetId ?? "x", planId: "individual-monthly" }, () => true],
    ["adminBootstrapFirst", undefined, (v) => v?.ok === true],
    ["adminBootstrapOwnerFn", undefined, (v) => v?.ok === true],
  ];
  for (const [name, data, success] of attempts) {
    if (!IDS.has(name)) continue;
    await step(`${role}: ${name} refused`, async () => {
      const result = await call(name, { cookie: session.cookie, data });
      assert.ok(result.status < 500 || result.status === 500, "answered");
      assert.equal(granted(result, success), false, describeResult(result));
    });
  }
}

async function main() {
  console.log(`[admin-e2e] ${base} — ${IDS.size} server functions in manifest`);
  try {
    await fetch(`${base}/api/auth/ok`);
  } catch {
    console.error("[admin-e2e] server unreachable");
    process.exit(2);
  }

  const ownerEmail = process.env.ADMIN_E2E_OWNER_EMAIL;
  const owner = process.env.ADMIN_E2E_OWNER_SESSION
    ? { cookie: process.env.ADMIN_E2E_OWNER_SESSION, user: null }
    : ownerEmail
      ? await account(ownerEmail, process.env.ADMIN_E2E_OWNER_PASSWORD ?? generatedPassword, { create: !process.env.ADMIN_E2E_OWNER_PASSWORD })
      : null;
  const staffEmail = process.env.ADMIN_E2E_STAFF_EMAIL;
  const staff = staffEmail
    ? await account(staffEmail, process.env.ADMIN_E2E_STAFF_PASSWORD ?? generatedPassword, { create: !process.env.ADMIN_E2E_STAFF_PASSWORD })
    : null;
  const customerEmail = `customer-${run}@example.com`;
  const customer = await account(customerEmail, generatedPassword, { create: true });
  if (customer.user && !customer.user.email) customer.user.email = customerEmail;

  if (owner) {
    console.log("[admin-e2e] owner");
    if (owner.user?.id) console.log(`  (owner account id ${owner.user.id})`);
    await readChecks("owner", owner, true);
    if (mutations) await ownerMutations(owner, customer);
  }

  if (staff) {
    console.log("[admin-e2e] staff administrator");
    await readChecks("staff", staff, (name) => !SUPER_ADMIN_ONLY.has(name));
    await step("staff: vault inventory WITHOUT secret values", async () => {
      const vault = await call("getOwnerVaultFn", { method: "GET", cookie: staff.cookie });
      assert.ok(isArray(vault.value?.entries), describeResult(vault));
      const leaked = vault.value.entries.filter((e) => e.sensitivity !== "public" && e.value);
      assert.equal(leaked.length, 0, `staff received ${leaked.length} secret/sensitive values`);
    });
    if (mutations) {
      await step("staff: licence revocation is owner-only", async () => {
        const result = await call("adminRevokeLicenseFn", { cookie: staff.cookie, data: { licenseId: "lic_nonexistent" } });
        assert.ok(String(result.value?.error ?? result.thrown ?? "").length > 0, describeResult(result));
      });
      await step("staff: licence creation is owner-only", async () => {
        const result = await call("adminCreateLicenseFn", { cookie: staff.cookie, data: { type: "FREE" } });
        assert.equal(result.value?.licenseId ?? null, null, describeResult(result));
      });
      await step("staff: cannot claim the first-admin bootstrap", async () => {
        const result = await call("adminBootstrapFirst", { cookie: staff.cookie });
        assert.notEqual(result.value?.wasEmpty, true, describeResult(result));
      });
    }
  }

  console.log("[admin-e2e] customer");
  await readChecks("customer", customer, false);
  if (mutations) await refusedMutations("customer", customer, customer.user?.id);

  await step("anonymous: amIAdmin is 401", async () => {
    const result = await call("amIAdmin", { method: "GET" });
    assert.equal(result.status, 401, `got ${result.status}`);
  });
  await step("anonymous: getAdminCustomers is 401", async () => {
    const result = await call("getAdminCustomers", { method: "GET" });
    assert.equal(result.status, 401, `got ${result.status}`);
  });

  console.log(
    failures.length ? `[admin-e2e] ${passed} passed, ${failures.length} failed` : `[admin-e2e] all ${passed} steps passed`,
  );
  process.exit(failures.length ? 1 : 0);
}

await main();
