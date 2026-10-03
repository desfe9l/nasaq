/**
 * NASAQ License — lifecycle verification for all four license types.
 *
 * Exercises the real database operations (PGLite, in-memory) through
 * `src/lib/license/server.ts` for FREE / TRIAL / PRO / LIFETIME:
 * create → activate → validate → entitlements → expiry semantics.
 *
 * Run: node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/license-lifecycle-check.mjs
 */
import { register } from "node:module";

register(new URL("./ts-alias-loader.mjs", import.meta.url));

// Stand-in for Vite's `import.meta.glob` inside src/lib/db.ts (loader hook
// routes it here): read the real migration files from disk.
import { readFileSync, readdirSync } from "node:fs";
globalThis.__nasaqMigrations = () => {
  const dir = new URL("../migrations/", import.meta.url);
  const out = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".sql")) out[`/migrations/${name}`] = readFileSync(new URL(name, dir), "utf8");
  }
  return out;
};

const { getSql } = await import("../src/lib/db.ts");
const db = await import("../src/lib/license/server.ts");
const { LICENSE_ENTITLEMENTS } = await import("../src/lib/license/types.ts");

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label} ${extra}`);
  }
}

const sql = await getSql();
// Fresh, isolated database for the check.
await sql.query(`DROP TABLE IF EXISTS licenses`);
await sql.query(`
  create table if not exists licenses (
    id              text primary key,
    key_hash        text not null unique,
    key_prefix      text not null,
    type            text not null check (type in ('FREE','TRIAL','PRO','LIFETIME')),
    status          text not null default 'ACTIVE' check (status in ('ACTIVE','EXPIRED','REVOKED')),
    user_id         text,
    activated_at    timestamptz,
    expires_at      timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    revoked_at      timestamptz,
    activation_count integer not null default 0,
    max_activations integer,
    metadata        jsonb
  )
`);

const in30d = () => new Date(Date.now() + 30 * 86400000).toISOString();
const yearAgo = () => new Date(Date.now() - 365 * 86400000).toISOString();

const TYPES = ["FREE", "TRIAL", "PRO", "LIFETIME"];

console.log("NASAQ license lifecycle — all types");
const created = {};
for (const type of TYPES) {
  const expiresAt = type === "TRIAL" ? in30d() : type === "PRO" ? undefined : undefined;
  const { license, plainKey } = await db.createLicense({ type, expiresAt });
  created[type] = { license, plainKey };
  check(`create ${type} → row type=${license.type}`, license.type === type);
  check(`create ${type} → status ACTIVE`, license.status === "ACTIVE");
  check(`create ${type} → key format`, /^NASAQ-([A-Z0-9]{4}-){3}[A-Z0-9]{4}$/.test(plainKey), plainKey);
  check(`create ${type} → expiry ${license.expiresAt ? "set" : "none"}`, type === "TRIAL" ? Boolean(license.expiresAt) : license.expiresAt === null);
}

// Schema guard: an unknown type must be rejected by the check constraint.
let rejected = false;
try {
  await db.createLicense({ type: "ENTERPRISE" });
} catch {
  rejected = true;
}
check("unknown type rejected by schema", rejected);

// Activation + validation per type.
for (const type of TYPES) {
  const { plainKey } = created[type];
  const { createHash } = await import("node:crypto");
  const keyHash = createHash("sha256").update(plainKey.trim().toUpperCase()).digest("hex");

  const activated = await db.activateLicense(keyHash, "user-1");
  check(`activate ${type} → success`, activated.success && activated.license?.status === "ACTIVE");
  check(`activate ${type} → count 1`, activated.license?.activationCount === 1);

  const validated = await db.validateLicense(keyHash);
  check(`validate ${type} → valid`, validated.valid);

  const ents = LICENSE_ENTITLEMENTS[type];
  check(`entitlements ${type} → core_editor`, ents.core_editor === true);
  check(
    `entitlements ${type} → tier boundary`,
    type === "FREE" ? ents.premium_templates === false : ents.premium_templates === true,
  );
  check(
    `entitlements ${type} → collaboration`,
    type === "FREE" || type === "TRIAL" ? ents.collaboration === false : ents.collaboration === true,
  );
}

// Expired TRIAL cannot activate.
const expired = await db.createLicense({ type: "TRIAL", expiresAt: yearAgo() });
const { createHash } = await import("node:crypto");
const expiredHash = createHash("sha256").update(expired.plainKey.trim().toUpperCase()).digest("hex");
const expiredAttempt = await db.activateLicense(expiredHash, "user-2");
check("expired TRIAL → EXPIRED", expiredAttempt.success === false && expiredAttempt.error === "EXPIRED");

// LIFETIME semantics: no expiry, unlimited validity.
const lifetime = created.LIFETIME.license;
check("LIFETIME has no expiresAt", lifetime.expiresAt === null);
const lifetimeValid = await db.validateLicense(
  createHash("sha256").update(created.LIFETIME.plainKey.trim().toUpperCase()).digest("hex"),
);
check("LIFETIME validates indefinitely", lifetimeValid.valid);

// Activation limit.
const limited = await db.createLicense({ type: "PRO", maxActivations: 1 });
const lHash = createHash("sha256").update(limited.plainKey.trim().toUpperCase()).digest("hex");
await db.activateLicense(lHash, "u1");
const second = await db.activateLicense(lHash, "u2");
check("PRO maxActivations=1 → second activation blocked", second.success === false && second.error === "ACTIVATION_LIMIT");

// Revocation + reactivation round-trip on every type.
for (const type of TYPES) {
  const revoked = await db.revokeLicense(created[type].license.id);
  check(`revoke ${type}`, revoked?.status === "REVOKED");
  const back = await db.reactivateLicense(created[type].license.id);
  check(`reactivate ${type}`, back?.status === "ACTIVE");
}

const list = await db.listAllLicenses(0, 50);
check(`list all → ${list.total} rows`, list.total === 6); // 4 types + expired TRIAL + limited PRO

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll license lifecycle checks passed.");
