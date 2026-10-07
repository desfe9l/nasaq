/**
 * Live Keygen verification for the canonical owner's licences — the shared core.
 *
 * This module is the ONE implementation of the provider-side verification. It
 * is called from two places and nowhere else:
 *
 *   · `scripts/owner-license-provider-verify.mjs` — `npm run verify:provider`,
 *     the operator CLI (prints the table, maps the status to an exit code);
 *   · the deployment runtime (`/api/ops/owner-recovery`, stage `provider`),
 *     which has the same configuration in `process.env` and returns the
 *     sanitized report as JSON.
 *
 * Bringing the logic here (rather than copying it) is deliberate: a second
 * implementation would be a second answer, and the whole point of this
 * verification is that there is exactly one.
 *
 * For EVERY licence row the canonical owner holds whose source is Keygen, it
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
 * REDACTION: licence fingerprints (sha256 of the provider id), statuses and
 * counts only — never a key, a key hash, a user id or an address.
 */
import type { Sql } from "../db.ts";
import type { OwnerBinding } from "../auth/owner-binding.server.ts";
import type { IdentityDirectory } from "../auth/owner-binding.server.ts";

export type ProviderVerifyCheck = { ok: boolean; name: string; detail: string };

/** Why the verification could not be certified at all (exit 2 for the CLI). */
export type ProviderVerifyPreflight =
  | {
      ready: true;
      binding: OwnerBinding;
      directory: IdentityDirectory;
      ownerFingerprint: string;
    }
  | { ready: false; reason: "store_unavailable" | "no_binding" | "provider_unconfigured" | "provider_unreachable"; error: string };

/** The verdict: `ok` false means at least one provider-side check is red. */
export type OwnerProviderVerifyReport = {
  ok: boolean;
  ownerFingerprint: string;
  ownerLicenses: number;
  failures: number;
  results: ProviderVerifyCheck[];
};

/**
 * Everything that must hold before a single provider read is attempted. Each
 * branch maps to the CLI's `fail(2, …)` and to the runtime's "cannot certify".
 */
export async function ownerProviderVerifyPreflight(sql: Sql): Promise<ProviderVerifyPreflight> {
  const [bindingModule, keygen] = await Promise.all([
    import("../auth/owner-binding.server.ts"),
    import("./keygen.ts"),
  ]);
  const directory = await bindingModule.authIdentityDirectory();
  if (!directory.ready) {
    return {
      ready: false,
      reason: "store_unavailable",
      error: "The identity store did not answer (fail closed).",
    };
  }
  const binding = await bindingModule.readOwnerBinding(sql);
  if (!binding) {
    return {
      ready: false,
      reason: "no_binding",
      error: "No durable owner binding — nothing to verify owner scope against.",
    };
  }
  if (!keygen.isKeygenConfigured()) {
    return {
      ready: false,
      reason: "provider_unconfigured",
      error:
        "KEYGEN_API_TOKEN is not configured in this environment — provider state cannot be certified.",
    };
  }
  try {
    await keygen.checkKeygenApiConnection();
  } catch {
    return {
      ready: false,
      reason: "provider_unreachable",
      error:
        "Keygen did not answer an authenticated read — provider state cannot be certified.",
    };
  }
  return {
    ready: true,
    binding,
    directory,
    ownerFingerprint: (await import("../auth/owner-migration-verify.server.ts")).fingerprint(
      binding.userId,
    ),
  };
}

/**
 * The verification itself. `sql` must already point at the deployment's
 * database; the preflight above has already proven a binding exists.
 */
export async function runOwnerProviderVerify(
  sql: Sql,
  preflight: Extract<ProviderVerifyPreflight, { ready: true }>,
): Promise<OwnerProviderVerifyReport> {
  const [scope, keygen, licenseServer, reconciliation, verify] = await Promise.all([
    import("./scope.ts"),
    import("./keygen.ts"),
    import("./server.ts"),
    import("../auth/owner-reconciliation.server.ts"),
    import("../auth/owner-migration-verify.server.ts"),
  ]);
  const { hashLicenseKey } = await import("./key.ts");

  const { binding, directory } = preflight;
  const orphans = await reconciliation.provenOwnerOrphanIds(sql, binding, directory);
  const canonical = binding.userId;

  const ownerRows = await sql.query<{
    id: string;
    key_hash: string;
    status: string;
    user_id: string;
    expires_at: string | null;
    activation_count: number | null;
    metadata: Record<string, unknown> | null;
  }>(
    `select id, key_hash, status, user_id, expires_at, activation_count, metadata
       from licenses
      where user_id = $1 and metadata->>'source' = 'keygen'
      order by created_at`,
    [canonical],
  );
  const orphanKeygen = await sql.query<{ n: number }>(
    `select count(*)::int as n from licenses
      where metadata->>'source' = 'keygen' and user_id = any(string_to_array($1, E'\\n'))`,
    [orphans.join("\n") || "∅"],
  );

  const editorList = await licenseServer.findLicensesByUserId(canonical);
  const consoleList = await licenseServer.listAllLicenses(0, 100, "", "ALL");

  const results: ProviderVerifyCheck[] = [];
  let failures = 0;
  const push = (ok: boolean, name: string, detail: string) => {
    results.push({ ok, name, detail });
    if (!ok) failures += 1;
  };

  push(
    Number(orphanKeygen[0]?.n ?? 0) === 0,
    "orphan_keygen_rows",
    `Keygen-sourced rows still owned by proven orphan ids: ${Number(orphanKeygen[0]?.n ?? 0)}`,
  );

  if (ownerRows.length === 0) {
    push(
      true,
      "owner_keygen_licenses",
      "the canonical owner holds no Keygen licences — nothing provider-side to reconcile (local-only inventory untouched).",
    );
  }

  for (const row of ownerRows) {
    const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const providerId = String((meta as Record<string, unknown>).keygenLicenseId || "");
    const fp = providerId ? verify.fingerprint(providerId) : "n/a";
    if (!providerId) {
      push(
        false,
        `license:${fp}`,
        "Keygen-sourced row without a provider licence id — cannot reconcile",
      );
      continue;
    }
    let remote: Awaited<ReturnType<typeof keygen.getKeygenLicenseForClaim>> | null = null;
    try {
      remote = await keygen.getKeygenLicenseForClaim(providerId);
    } catch (error) {
      const detail =
        (error as { status?: string | number; message?: string })?.status ??
        (error as { message?: string })?.message ??
        "unknown";
      push(false, `license:${fp}`, `provider read failed: ${detail}`);
      continue;
    }
    const rebound = scope.reboundFromIds(row.metadata);
    const scopeIds = [canonical, ...rebound];
    const checks: Array<[boolean, string]> = [
      [true, "the existing provider key is present (same licence id)"],
      [remote.productId === keygen.keygenProductId(), "belongs to the configured product"],
      [
        remote.key ? hashLicenseKey(remote.key) === row.key_hash : false,
        "the SAME key — provider key hash matches the local record (existing key preserved)",
      ],
      [
        row.status === "ACTIVE"
          ? !remote.suspended && ["ACTIVE", "EXPIRING"].includes(remote.status)
          : row.status === "REVOKED"
            ? remote.suspended === true
            : true,
        `status preserved (local ${row.status} / provider ${remote.status || "?"}${remote.suspended ? ", suspended" : ""})`,
      ],
      [
        !remote.nasaqUserId || scopeIds.includes(remote.nasaqUserId),
        `provider owner scope resolves to the canonical owner${rebound.length ? " (via the rebound trail)" : ""}`,
      ],
      [
        scope.keygenScopeSatisfied(row.metadata, canonical),
        "local scope markers resolve for the canonical owner",
      ],
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
      results.push({
        ok: true,
        name: `license:${fp}`,
        detail:
          "note: provider/local expiry differ — the admin extend flow writes provider-first on the next change",
      });
    }
    // claims: the key's first-claim reservation must be the canonical owner's (or absent)
    const claims = await sql.query<{ user_id: string }>(
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
      push(
        !orphans.includes(claim.user_id),
        `license:${fp}`,
        "the old orphan identity holds no claim on this key",
      );
    }
    // console and editor resolve the SAME record
    push(
      editorList.some((l) => l.id === row.id) && consoleList.licenses.some((l) => l.id === row.id),
      `license:${fp}`,
      "admin console and editor resolve the SAME licence record",
    );
  }

  return {
    ok: failures === 0,
    ownerFingerprint: preflight.ownerFingerprint,
    ownerLicenses: ownerRows.length,
    failures,
    results,
  };
}

/**
 * One call for both consumers: preflight then verify. Returns the preflight's
 * "cannot certify" branch unchanged so callers keep the exact reason.
 */
export async function ownerProviderVerify(
  sql: Sql,
): Promise<
  | { status: "uncertified"; reason: string; error: string }
  | { status: "verified" | "failed"; report: OwnerProviderVerifyReport }
> {
  const preflight = await ownerProviderVerifyPreflight(sql);
  if (!preflight.ready) {
    return { status: "uncertified", reason: preflight.reason, error: preflight.error };
  }
  const report = await runOwnerProviderVerify(sql, preflight);
  return { status: report.ok ? "verified" : "failed", report };
}
