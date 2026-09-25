/**
 * NASAQ License — generator ↔ activation compatibility check.
 *
 * Verifies, through the REAL shipping code paths, that a key issued by the
 * current license generator (Keygen HEX scheme: XXXXXX-XXXXXX-...-V3) is
 * accepted by the format gates, normalized, verified against the issuing
 * source, persisted, survives a "page reload", and that tampered/random keys
 * are rejected with PRECISE messages (never the old blanket
 * «تعذر التحقق من حالة الترخيص»).
 *
 * The Keygen API is emulated over fetch with the exact wire schema of
 * api.keygen.sh (validate-key / licenses / entitlements). Issuance goes
 * through the real `createKeygenLicense`, so generator and activation
 * provably agree on the same schema and key format.
 *
 * Run: node --experimental-strip-types --loader ./scripts/ts-alias-loader.mjs scripts/license-compat-check.mjs
 */
import { register } from "node:module";

register(new URL("./ts-alias-loader.mjs", import.meta.url));

import { readFileSync, readdirSync } from "node:fs";
globalThis.__nasaqMigrations = () => {
  const dir = new URL("../migrations/", import.meta.url);
  const out = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".sql")) out[`/migrations/${name}`] = readFileSync(new URL(name, dir), "utf8");
  }
  return out;
};

// Keygen configuration for the emulated provider.
const TOKEN = "compat-test-token";
process.env.KEYGEN_API_TOKEN = TOKEN;

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label} ${extra}`);
  }
}

// ── Emulated issuing source (Keygen-compatible) ──────────────────────────
// The registry lives behind the mocked API — exactly like the real account.
const registry = new Map(); // normalized key -> { id, policyId, status }
let licenseSeq = 0;

function issueGeneratorKey() {
  // Format issued by the current generator (Keygen HEX scheme + version suffix).
  const seg = () => Array.from({ length: 6 }, () => "0123456789ABCDEF"[Math.floor(Math.random() * 16)]).join("");
  return `${seg()}-${seg()}-${seg()}-${seg()}-${seg()}-V3`;
}

const ENTITLEMENT_CODES = [
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

const jsonShape = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/vnd.api+json" },
  });

let forcedCode = null; // test hook: force the next validation result code

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const path = u.pathname.replace(/^\/v1\/accounts\/[^/]+/, "");
  if (path === "/licenses/actions/validate-key" && init.method === "POST") {
    const body = JSON.parse(init.body);
    const key = String(body?.meta?.key ?? "");
    const scopeOk = Boolean(body?.meta?.scope?.product);
    const record = registry.get(key);
    let valid = Boolean(record) && record.status === "active" && scopeOk;
    let code = !scopeOk ? "PRODUCT_SCOPE_MISMATCH" : !record ? "NOT_FOUND" : record.status === "active" ? "VALID" : record.status;
    if (forcedCode) {
      code = forcedCode;
      valid = code === "VALID";
      forcedCode = null;
    }
    return jsonShape({
      meta: { valid, code },
      data: {
        id: record?.id || undefined,
        type: "licenses",
        attributes: {
          key,
          status: record?.status || "NOT_FOUND",
          expiry: null,
          uses: 0,
          maxUsers: null,
          metadata: {},
        },
        relationships: {
          policy: { data: record ? { id: record.policyId, type: "policies" } : null },
          product: { data: { id: "prod", type: "products" } },
        },
      },
    });
  }
  if (path === "/licenses" && init.method === "POST") {
    // The real generator path: `createKeygenLicense` POSTs here.
    const body = JSON.parse(init.body);
    const policyId = body?.data?.relationships?.policy?.data?.id || "";
    const key = issueGeneratorKey();
    const id = `lic_${++licenseSeq}`;
    registry.set(key, { id, policyId, status: "active" });
    return jsonShape({
      data: {
        id,
        type: "licenses",
        attributes: { key, status: "ACTIVE", expiry: null, uses: 0, maxUsers: null, metadata: {} },
        relationships: {
          policy: { data: { id: policyId, type: "policies" } },
          product: { data: { id: "prod", type: "products" } },
        },
      },
    });
  }
  const entitlementsMatch = path.match(/^\/licenses\/([^/]+)\/entitlements$/);
  if (entitlementsMatch) {
    return jsonShape({
      data: ENTITLEMENT_CODES.map((code, i) => ({
        id: `rel_${code}`,
        type: "license-entitlements",
        attributes: {},
        relationships: { entitlement: { data: { id: `ent_${i}`, type: "entitlements" } } },
      })),
      included: ENTITLEMENT_CODES.map((code, i) => ({
        id: `ent_${i}`,
        type: "entitlements",
        attributes: { code },
      })),
    });
  }
  return jsonShape({ errors: [{ detail: `unhandled ${init.method || "GET"} ${path}` }] }, 404);
};

// ── Real modules under test ───────────────────────────────────────────────
process.chdir(new URL("..", import.meta.url).pathname);
const { getSql } = await import("../src/lib/db.ts");
const sql = await getSql();
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

const keyMod = await import("../src/lib/license/key.ts");
const keygen = await import("../src/lib/license/keygen.ts");
const db = await import("../src/lib/license/server.ts");
const { entitlementsFromKeygenCodes } = await import("../src/lib/license/types.ts");

console.log("NASAQ license generator ↔ activation compatibility");

// ── 1) Generate a REAL key through the real generator path ───────────────
const issued = await keygen.createKeygenLicense({ plan: "lifetime", name: "NASAQ LIFETIME license" });
const plainKey = issued.key;
console.log(`      issued by generator: ${plainKey}`);
check("generator issues the current format", keyMod.isGeneratedKeyFormat(plainKey), plainKey);
check("generated key marked LIFETIME by issuer mapping", issued.type === "LIFETIME", issued.type);

// ── 2) Activation UI path: format accepted, then real verification ───────
// Replicates activateLicenseFn's branching with the exact typed variants.
const typedVariant = `  ${plainKey.toLowerCase().replace("-v", "- v")}  `; // lowercase + stray spaces
const normalized = keyMod.normalizeLicenseKey(typedVariant);
check("typed variant normalizes back to the issued key", normalized === plainKey);

const manualKey = keyMod.isValidKeyFormat(normalized);
const generatedKey = keyMod.isGeneratedKeyFormat(normalized);
const keygenKey = generatedKey || (!manualKey && keyMod.isKeygenKeyFormat(normalized));
check("activation gates accept the generator format (1)", !manualKey && keygenKey);
check("legacy NASAQ- format still accepted alongside", keyMod.isValidKeyFormat("NASAQ-ABCD-EFGH-IJKL-MNOP"));

const verified = await keygen.validateKeygenLicense(typedVariant); // typed as a user would paste it
check("verified against the issuing source (2)", verified.valid, verified.code);
check("verification echoes the normalized key", verified.key === plainKey);
check("type/state resolved correctly (3)", verified.type === "LIFETIME" && verified.status === "ACTIVE");

// ── 3) Persist like activateLicenseFn does ────────────────────────────────
const license = await db.upsertExternalLicense({
  keyHash: keyMod.hashLicenseKey(verified.key),
  keyPrefix: keyMod.keyPrefix(verified.key),
  type: verified.type,
  userId: "user-compat-1",
  expiresAt: verified.expiresAt,
  activationCount: verified.activationCount,
  maxActivations: verified.maxActivations,
  status: verified.status,
  metadata: verified.metadata,
});
check("activation state persisted (5)", license.status === "ACTIVE" && license.userId === "user-compat-1");

const entitlements = entitlementsFromKeygenCodes((license.metadata?.entitlements || "").split(",").filter(Boolean));
check("features activated from issuer entitlements (4)", entitlements.premium_templates && entitlements.advanced_export && entitlements.collaboration);

// ── 4) Page reload: cached key → lookup + re-verify ───────────────────────
const cachedKey = typedVariant; // what localStorage would hold
const lookedUp = await db.findLicenseByKeyHash(keyMod.hashLicenseKey(cachedKey));
check("persisted record found after reload (6a)", Boolean(lookedUp) && lookedUp.type === "LIFETIME");
const reVerified = await keygen.validateKeygenLicense(cachedKey);
check("re-verification still valid after reload (6b)", reVerified.valid);

// ── 5) Tampered / random keys are rejected with precise messages ─────────
// Same shape as the issued key, one hex character deterministically altered.
const firstChar = plainKey[0];
const flipped = firstChar === "A" ? "B" : "A";
const tampered = flipped + plainKey.slice(1);
check("tampered key keeps a valid shape", keyMod.isGeneratedKeyFormat(tampered) && tampered !== plainKey);
const tamperedResult = await keygen.validateKeygenLicense(tampered);
check("tampered key rejected by the source (7a)", !tamperedResult.valid);
const tamperedMsg = keygen.keygenMessage(tamperedResult);
check("tampered key message is precise (7b)", tamperedMsg === "مفتاح الترخيص غير صالح أو غير موجود.", tamperedMsg);

const randomKey = "HELLO-WORLD-NOT-A-REAL-LICENSE-KEY";
check("random text matches no key format", !keyMod.isGeneratedKeyFormat(randomKey) && !keyMod.isValidKeyFormat(randomKey));

// ── 6) No more blanket «تعذر التحقق» for provider codes ──────────────────
for (const code of ["NO_MACHINE", "OVERDUE", "MACHINE_SCOPE_MISMATCH", "TOO_MANY_USERS", "SOME_FUTURE_CODE"]) {
  forcedCode = code;
  const r = await keygen.validateKeygenLicense(plainKey);
  const msg = keygen.keygenMessage(r);
  const blanket = msg === "تعذر التحقق من حالة الترخيص." || msg.startsWith("تعذر التحقق من حالة الترخيص");
  check(`code ${code} yields a precise message`, !blanket, msg);
  if (code === "NO_MACHINE") check("NO_MACHINE names the machine requirement", msg.includes("جهاز"));
}

// ── 7) The example key from the report is NOT forced-valid ────────────────
const example = "8BB5C5-56F186-781D92-3C5259-DA12B3-V3";
check("example key format accepted by the gates (8a)", keyMod.isGeneratedKeyFormat(example));
const exampleResult = await keygen.validateKeygenLicense(example);
check("example key verdict comes from the source (8b)", !exampleResult.valid && exampleResult.code === "NOT_FOUND");
check(
  "example key failure is precise, never the blanket error (8c)",
  keygen.keygenMessage(exampleResult) === "مفتاح الترخيص غير صالح أو غير موجود.",
);

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll compatibility checks passed.");
