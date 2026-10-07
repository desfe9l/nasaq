#!/usr/bin/env node
/**
 * Live admin-mutation probe — reversible, synthetic-entity writes (STEP 6).
 *
 * Proves that the canonical owner's identity performs REAL server-side
 * mutations, by driving the SAME service functions the admin console calls
 * and checking the RESULTING database state after each one:
 *
 *   customer:    activate → suspend → restore → extend → change plan
 *                (each step re-read from `subscriptions`)
 *   payments:    approve a synthetic request → entitlement row actually
 *                granted; reject another → refused exactly once, no grant
 *   licences:    create → assign → extend → revoke → reactivate (manual
 *                licence path — never touches Keygen or a real key)
 *   staff:       grant admin to a synthetic account → row present
 *   gates:       template-manager gate and settings resolver accept the
 *                canonical identity (the gates the console mutations call)
 *
 * SAFETY CONTRACT
 *   · Synthetic subjects only: user ids prefixed `owner-probe-<run>-`. No real
 *     customer, licence, template, project or setting is created, altered or
 *     deleted by this probe.
 *   · Full cleanup in `finally`: every synthetic row this probe created is
 *     deleted by its id/prefix. Audit-log entries are append-only product
 *     history — they stay, as the honest record of the probe.
 *   · The probe REFUSES to write at all unless the canonical identity passes
 *     the super-admin resolver first — the same gate the console enforces.
 *
 * Exit: 0 every mutation landed · 1 a mutation or its resulting state failed ·
 *       2 cannot run (no binding / store down / not production DB).
 */
const [{ getSql, dbSource }, bindingModule, adminServer, payments, adminIdentity, superAdmin, licenseServer, entitlement, ownerGate] =
  await Promise.all([
    import("../src/lib/db.ts"),
    import("../src/lib/auth/owner-binding.server.ts"),
    import("../src/lib/commercial/admin.server.ts"),
    import("../src/lib/commercial/payments.server.ts"),
    import("../src/lib/auth/admin-identity.server.ts"),
    import("../src/lib/auth/super-admin.server.ts"),
    import("../src/lib/license/server.ts"),
    import("../src/lib/commercial/entitlement.server.ts"),
    import("../src/lib/admin/owner-gate.server.ts"),
  ]);

const fail = (code, message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
};

if (dbSource !== "neon") fail(2, "DATABASE_URL is not set — the mutation probe runs against the DEPLOYMENT's database only.");
const sql = await getSql();
const directory = await bindingModule.authIdentityDirectory();
if (!directory.ready) fail(2, "The identity store did not answer (fail closed).");
const binding = await bindingModule.readOwnerBinding(sql);
if (!binding) fail(2, "No durable owner binding — cannot act as the owner without forging identity. Nothing was written.");
const canonical = binding.userId;
const canonicalAccount = await directory.lookup(canonical);
const canonicalIdentity = {
  id: canonical,
  email: binding.email ?? canonicalAccount?.email ?? null,
  emailVerified: canonicalAccount?.emailVerified === true,
};
if (!(await superAdmin.isSuperAdminIdentity(sql, canonicalIdentity))) {
  fail(2, "The canonical identity does not pass the super-admin resolver — the probe refuses to write. Nothing was written.");
}

const actor = { adminUserId: canonical };
const RUN = `owner-probe-${Date.now().toString(36)}`;
const syn = (label) => `${RUN}-${label}`;
const created = { users: [], requests: [], licenses: [], admins: [] };

const checks = [];
const probe = async (name, fn) => {
  try {
    const detail = await fn();
    checks.push({ ok: true, name, detail: detail ?? "resulting state verified" });
  } catch (error) {
    checks.push({ ok: false, name, detail: error?.message ?? String(error) });
  }
};
const expect = (cond, message) => {
  if (!cond) throw new Error(message);
};

const customer = syn("customer");
try {
  // ── gates (read-only assertions for the surfaces without a service fn) ──
  await probe("gate:template_manager", async () => {
    const result = await ownerGate.verifyTemplateManager(
      { userId: canonical, userEmail: canonicalIdentity.email, userEmailVerified: canonicalIdentity.emailVerified },
      Promise.resolve(sql),
    );
    expect(result.ok === true, "the template-manager gate refused the canonical owner");
    return "template publish/unpublish/delete gate accepts the canonical owner";
  });
  await probe("gate:settings_admin", async () => {
    expect(await adminIdentity.isAdminCaller(sql, canonicalIdentity), "the settings resolver refused the canonical owner");
    return "system/Gumroad/AI settings resolver accepts the canonical owner";
  });

  // ── customer lifecycle ──────────────────────────────────────────────────
  created.users.push(customer);
  const planId = "individual-monthly";
  const altPlanId = "individual-quarterly";
  await probe("customer:activate", async () => {
    await adminServer.activateCustomer(sql, actor, customer, planId);
    const sub = await entitlement.getSubscription(sql, customer);
    expect(sub?.status === "ACTIVE", `expected ACTIVE, got ${sub?.status}`);
    return `subscription row ACTIVE on plan ${sub.plan_id}`;
  });
  await probe("customer:suspend", async () => {
    await adminServer.suspendCustomer(sql, actor, customer);
    const sub = await entitlement.getSubscription(sql, customer);
    expect(sub?.status === "SUSPENDED", `expected SUSPENDED, got ${sub?.status}`);
    return "row SUSPENDED, suspension timestamp written";
  });
  await probe("customer:restore", async () => {
    await adminServer.restoreCustomer(sql, actor, customer);
    const sub = await entitlement.getSubscription(sql, customer);
    expect(sub?.status === "ACTIVE", `expected ACTIVE, got ${sub?.status}`);
    return "row ACTIVE again, suspension cleared";
  });
  let beforeExtend;
  await probe("customer:extend", async () => {
    beforeExtend = (await entitlement.getSubscription(sql, customer)).expires_at;
    const { expiresAt } = await adminServer.extendSubscription(sql, actor, customer, 7);
    const gained = (new Date(expiresAt).getTime() - new Date(beforeExtend).getTime()) / 86_400_000;
    expect(gained >= 6 && gained <= 8, `expected ~7 days gained, got ${gained.toFixed(2)}`);
    return `expiry moved from ${new Date(beforeExtend).toISOString().slice(0, 10)} to ${expiresAt.slice(0, 10)} (+7d)`;
  });
  await probe("customer:change_plan", async () => {
    await adminServer.changePlan(sql, actor, customer, altPlanId);
    const sub = await entitlement.getSubscription(sql, customer);
    expect(sub?.plan_id === altPlanId, `expected plan ${altPlanId}, got ${sub?.plan_id}`);
    expect(
      Math.abs(new Date(sub.expires_at).getTime() - (new Date(beforeExtend).getTime() + 7 * 86_400_000)) < 2_000,
      "expiry must not move on a plan change",
    );
    return `plan switched to ${sub.plan_id}, expiry preserved`;
  });
  await probe("customer:set_expiration", async () => {
    const target = new Date(Date.now() + 30 * 86_400_000);
    await adminServer.setExpiration(sql, actor, customer, target);
    const sub = await entitlement.getSubscription(sql, customer);
    expect(Math.abs(new Date(sub.expires_at).getTime() - target.getTime()) < 1_000, "explicit expiry not written");
    return `explicit expiry ${target.toISOString().slice(0, 10)} written`;
  });

  // ── payments ─────────────────────────────────────────────────────────────
  const approveUser = syn("approve");
  const rejectUser = syn("reject");
  created.users.push(approveUser, rejectUser);
  const approveReq = syn("req-a");
  const rejectReq = syn("req-r");
  await sql`
    insert into payment_requests (id, user_id, plan_id, amount, currency, payment_reference)
    values (${approveReq}, ${approveUser}, ${planId}, 79, 'SAR', ${syn("ref-a")}),
           (${rejectReq}, ${rejectUser}, ${planId}, 79, 'SAR', ${syn("ref-r")})
  `;
  created.requests.push(approveReq, rejectReq);
  await probe("payment:approve_grants", async () => {
    await adminServer.approvePayment(sql, actor, approveReq, "owner production probe");
    const req = await payments.getPaymentRequestForAdmin(sql, approveReq);
    expect(req?.status === "APPROVED", `request ${req?.status}`);
    const sub = await entitlement.getSubscription(sql, approveUser);
    expect(sub?.status === "ACTIVE", "approval did not grant the entitlement row");
    return "request APPROVED and the subscription row actually exists for the customer";
  });
  await probe("payment:approve_once", async () => {
    let twice = false;
    try {
      await adminServer.approvePayment(sql, actor, approveReq, null);
      twice = true;
    } catch {
      twice = false;
    }
    expect(!twice, "a second approval of the same request was accepted");
    const subs = await sql`select count(*)::int as n from subscriptions where user_id = ${approveUser} and status = 'ACTIVE'`;
    expect(Number(subs[0]?.n) === 1, "duplicate grant detected");
    return "re-approval refused; exactly one live entitlement on the customer";
  });
  await probe("payment:reject_grants_nothing", async () => {
    await adminServer.rejectPayment(sql, actor, rejectReq, "owner production probe");
    const req = await payments.getPaymentRequestForAdmin(sql, rejectReq);
    expect(req?.status === "REJECTED", `request ${req?.status}`);
    const sub = await entitlement.getSubscription(sql, rejectUser);
    expect(sub === null, "a rejected request granted access");
    return "request REJECTED; no entitlement row exists for the customer";
  });

  // ── licence lifecycle (manual path — no provider calls, no real keys) ────
  await probe("license:create_assign_extend_revoke_reactivate", async () => {
    const { license, plainKey } = await licenseServer.createLicense({
      type: "TRIAL",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(Boolean(plainKey), "no plaintext key returned at creation (shown-once contract)");
    created.licenses.push(license.id);

    const licenceOwner = syn("holder");
    created.users.push(licenceOwner);
    const assigned = await licenseServer.assignLicense(license.id, licenceOwner, true);
    expect(assigned?.userId === licenceOwner, "assignment did not land on the row");

    const extended = await licenseServer.extendLicense(license.id, 10);
    expect(
      new Date(extended.expiresAt).getTime() > new Date(assigned.expiresAt).getTime() + 9 * 86_400_000,
      "extension did not move the expiry",
    );

    const revoked = await licenseServer.revokeLicense(license.id);
    expect(revoked?.status === "REVOKED" && revoked.revokedAt, "revocation state not written");

    const reactivated = await licenseServer.reactivateLicense(license.id);
    expect(reactivated?.status === "ACTIVE" && !reactivated.revokedAt, "reactivation state not written");
    return "create → assign → extend → revoke → reactivate each landed on the row and re-read correctly";
  });

  // ── staff management ─────────────────────────────────────────────────────
  await probe("staff:grant_admin", async () => {
    const staffCandidate = syn("staff");
    created.admins.push(staffCandidate);
    await adminServer.grantAdmin(sql, actor, staffCandidate, "owner production probe");
    const rows = await sql`select role from admin_users where user_id = ${staffCandidate} limit 1`;
    expect(rows.length === 1, "admin_users row not written");
    return `admin_users row written (role ${rows[0].role})`;
  });
} finally {
  // Reversible by contract: remove every synthetic row this probe created.
  await sql`delete from subscriptions where user_id like ${RUN + "-%"}`;
  await sql`delete from payment_requests where user_id like ${RUN + "-%"}`;
  await sql`delete from licenses where user_id like ${RUN + "-%"}`;
  for (const id of created.licenses) {
    await sql`delete from licenses where id = ${id}`;
  }
  await sql`delete from admin_users where user_id like ${RUN + "-%"}`;
}

const failures = checks.filter((c) => !c.ok).length;
const width = Math.max(...checks.map((c) => c.name.length), 12);
console.log(`\nAdmin mutation probe — reversible, synthetic rows only (run ${RUN.slice(-6)})\n`);
for (const c of checks) console.log(`  [${c.ok ? " ok " : "FAIL"}] ${c.name.padEnd(width)}  ${c.detail}`);
console.log(`\n  cleanup: synthetic subscription/payment/licence/admin rows removed; audit entries kept as the honest record.`);
console.log("");
if (failures) {
  console.log(`RESULT: FAILED — ${failures} mutation(s) did not land.\n`);
  process.exit(1);
}
console.log("RESULT: OK — the canonical owner's identity performs real server-side mutations; resulting state verified after each.\n");
process.exit(0);
