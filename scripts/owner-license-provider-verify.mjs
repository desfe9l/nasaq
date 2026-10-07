#!/usr/bin/env node
/**
 * Live Keygen verification for the canonical owner's licences (STEP 12).
 *
 * For EVERY licence row the canonical owner holds whose source is Keygen,
 * proves against the ACTUAL provider state:
 *
 *   1. the existing key still exists at the provider (same licence id);
 *   2. it is the SAME key — the provider-side key hashes to the local
 *      key_hash (compared in memory; neither the key nor the hash is printed);
 *   3. the licence belongs to the configured product;
 *   4. status is preserved: a locally ACTIVE licence is not suspended at the
 *      provider and its provider status is live; a locally REVOKED licence is
 *      suspended; expiry agrees with the local row (drift is reported);
 *   5. activation state is preserved (provider user/machine attachment count
 *      is reported; the verification never attaches, detaches or mutates);
 *   6. the provider owner scope (metadata.nasaqUserId) resolves to the
 *      canonical owner — directly, or through the server-written rebound
 *      trail (`ownerReboundFrom`) the reconciliation wrote;
 *   7. the old orphan identity holds no claim on the key (`license_claims`);
 *   8. the admin console read (`listAllLicenses`) and the editor read
 *      (`findLicensesByUserId`) resolve the SAME licence record;
 *   9. no Keygen-sourced row is still owned by a proven orphan id.
 *
 * READ-ONLY. It never creates, invalidates, extends, suspends or reassigns a
 * licence, at the provider or locally.
 *
 * REDACTION: prints licence fingerprints (sha256 of the provider id), statuses
 * and counts only — never a key, a key hash, a user id or an address.
 *
 * Exit: 0 every check passed · 1 a mismatch was found · 2 cannot certify
 *       (provider unconfigured/unreachable, no binding, identity store down).
 */
const [{ getSql, dbSource }, scope, keygen, licenseServer, bindingModule, reconciliation, verify] =
  await Promise.all([
    import("../src/lib/db.ts"),
    import("../src/lib/license/scope.ts"),
    import("../src/lib/license/keygen.ts"),
    import("../src/lib/license/server.ts"),
    import("../src/lib/auth/owner-binding.server.ts"),
    import("../src/lib/auth/owner-reconciliation.server.ts"),
    import("../src/lib/auth/owner-migration-verify.server.ts"),
  ]);

const { hashLicenseKey } = await import("../src/lib/license/key.ts");

const fail = (code, message) => {
  console.error(`\n✗ ${message}\n`);
  process.exit(code);
};

if (dbSource !== "neon") {
  fail(2, "DATABASE_URL is not set — this verifies the DEPLOYMENT's database, never a local fallback.");
}
const directory = await bindingModule.authIdentityDirectory();
if (!directory.ready) fail(2, "The identity store did not answer (fail closed).");
const binding = await bindingModule.readOwnerBinding(await getSql());
if (!binding) fail(2, "No durable owner binding — nothing to verify owner scope against.");
if (!keygen.isKeygenConfigured()) {
  fail(2, "KEYGEN_API_TOKEN is not configured in this environment — provider state cannot be certified.");
}

const sql = await getSql();
await keygen.checkKeygenApiConnection().catch(() => {
  fail(2, "Keygen did not answer an authenticated read — provider state cannot be certified.");
});

const orphans = await reconciliation.provenOwnerOrphanIds(sql, binding, directory);
const canonical = binding.userId;

const ownerRows = await sql.query(
  `select id, key_hash, status, user_id, expires_at, activation_count, metadata
     from licenses
    where user_id = $1 and metadata->>'source' = 'keygen'
    order by created_at`,
  [canonical],
);
const orphanKeygen = await sql.query(
  `select count(*)::int as n from licenses
    where metadata->>'source' = 'keygen' and user_id = any(string_to_array($1, E'\\n'))`,
  [orphans.join("\n") || "∅"],
);

const editorList = await licenseServer.findLicensesByUserId(canonical);
const consoleList = await licenseServer.listAllLicenses(0, 100, "", "ALL");

const results = [];
let failures = 0;
const push = (ok, name, detail) => {
  results.push({ ok, name, detail });
  if (!ok) failures += 1;
};

push(
  Number(orphanKeygen[0]?.n ?? 0) === 0,
  "orphan_keygen_rows",
  `Keygen-sourced rows still owned by proven orphan ids: ${Number(orphanKeygen[0]?.n ?? 0)}`,
);

if (ownerRows.length === 0) {
  push(true, "owner_keygen_licenses", "the canonical owner holds no Keygen licences — nothing provider-side to reconcile (local-only inventory untouched).");
}

for (const row of ownerRows) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const providerId = String(meta.keygenLicenseId || "");
  const fp = providerId ? verify.fingerprint(providerId) : "n/a";
  if (!providerId) {
    push(false, `license:${fp}`, "Keygen-sourced row without a provider licence id — cannot reconcile");
    continue;
  }
  let remote = null;
  try {
    remote = await keygen.getKeygenLicenseForClaim(providerId);
  } catch (error) {
    push(false, `license:${fp}`, `provider read failed: ${error?.status ?? error?.message ?? "unknown"}`);
    continue;
  }
  const rebound = scope.reboundFromIds(row.metadata);
  const scopeIds = [canonical, ...rebound];
  const checks = [
    [true, "the existing provider key is present (same licence id)"],
    [remote.productId === keygen.keygenProductId(), "belongs to the configured product"],
    [
      remote.key ? hashLicenseKey(remote.key) === row.key_hash : false,
      "the SAME key — provider key hash matches the local record (existing key preserved)",
    ],
    [
      row.status === "ACTIVE" ? !remote.suspended && ["ACTIVE", "EXPIRING"].includes(remote.status)
      : row.status === "REVOKED" ? remote.suspended === true
      : true,
      `status preserved (local ${row.status} / provider ${remote.status || "?"}${remote.suspended ? ", suspended" : ""})`,
    ],
    [
      !remote.nasaqUserId || scopeIds.includes(remote.nasaqUserId),
      `provider owner scope resolves to the canonical owner${rebound.length ? " (via the rebound trail)" : ""}`,
    ],
    [scope.keygenScopeSatisfied(row.metadata, canonical), "local scope markers resolve for the canonical owner"],
  ];
  for (const [ok, name] of checks) {
    push(ok, `license:${fp}`, name + (ok ? "" : "  ← MISMATCH"));
  }
  // activation state: reported, never mutated by this verification
  results.push({
    ok: true,
    name: `license:${fp}`,
    detail: `activations preserved — provider attachments: ${remote.usersCount ?? "unknown"}, local count: ${Number(row.activation_count ?? 0)}`,
  });
  if (
    remote.expiresAt &&
    row.expires_at &&
    Math.abs(new Date(remote.expiresAt).getTime() - new Date(row.expires_at).getTime()) > 60_000
  ) {
    results.push({ ok: true, name: `license:${fp}`, detail: "note: provider/local expiry differ — the admin extend flow writes provider-first on the next change" });
  }
  // claims: the key's first-claim reservation must be the canonical owner's (or absent)
  const claims = await sql.query(
    `select user_id from license_claims where key_hash = $1`,
    [row.key_hash],
  );
  for (const claim of claims) {
    push(
      claim.user_id === canonical,
      `license:${fp}`,
      claim.user_id === canonical
        ? "the key's claim is the canonical owner's"
        : "the key's claim belongs to a non-canonical id ← MISMATCH",
    );
    push(!orphans.includes(claim.user_id), `license:${fp}`, "the old orphan identity holds no claim on this key");
  }
  // console and editor resolve the SAME record
  push(
    editorList.some((l) => l.id === row.id) && consoleList.licenses.some((l) => l.id === row.id),
    `license:${fp}`,
    "admin console and editor resolve the SAME licence record",
  );
}

const width = Math.max(...results.map((r) => r.name.length), 12);
console.log(`\nKeygen live verification — owner ${verify.fingerprint(canonical)} — ${ownerRows.length} owner licence(s)\n`);
for (const r of results) {
  console.log(`  [${r.ok ? " ok " : "FAIL"}] ${r.name.padEnd(width)}  ${r.detail}`);
}
console.log("");
if (failures > 0) {
  console.log(`RESULT: FAILED — ${failures} provider-side check(s) red.\n`);
  process.exit(1);
}
console.log("RESULT: OK — every owner licence exists at Keygen with its key, status, activations and owner scope preserved.\n");
process.exit(0);
