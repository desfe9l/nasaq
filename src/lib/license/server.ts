/**
 * NASAQ License — Server-side database operations.
 *
 * All license CRUD lives here. Every function is server-only (uses getSql()).
 * The client never touches the database directly — it calls server functions
 * which use these operations after verifying the caller's identity.
 */

import { getSql } from "@/lib/db";
import { generateLicenseKey, hashLicenseKey, keyPrefix } from "./key";
import type {
  AdminLicenseCreate,
  AdminLicenseList,
  AdminLicenseUpdate,
  License,
  LicenseType,
  LicenseStatus,
} from "./types";

// ── Internal helpers ───────────────────────────────────────────────────────

function rowToLicense(row: Record<string, unknown>): License {
  return {
    id: String(row.id),
    keyHash: String(row.key_hash),
    keyPrefix: String(row.key_prefix),
    type: String(row.type) as LicenseType,
    status: String(row.status) as LicenseStatus,
    userId: (row.user_id as string) ?? null,
    activatedAt: row.activated_at ? String(row.activated_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    activationCount: Number(row.activation_count),
    maxActivations: row.max_activations != null ? Number(row.max_activations) : null,
    metadata: row.metadata ? (typeof row.metadata === "string" ? JSON.parse(row.metadata) as Record<string, string> : row.metadata as Record<string, string>) : null,
  };
}

// ── License CRUD ───────────────────────────────────────────────────────────

export class LicenseOwnershipError extends Error {
  constructor() {
    super("License is bound to a different NASAQ account");
    this.name = "LicenseOwnershipError";
  }
}

/** Atomic, durable first claim; the reservation itself never grants entitlements. */
export async function reserveKeygenClaim(keyHash: string, userId: string): Promise<boolean> {
  const sql = await getSql();
  await sql.query(
    `INSERT INTO license_claims (key_hash, user_id) VALUES ($1, $2)
     ON CONFLICT (key_hash) DO NOTHING`,
    [keyHash, userId],
  );
  const rows = await sql.query<{ user_id: string }>(
    `SELECT user_id FROM license_claims WHERE key_hash = $1`, [keyHash],
  );
  return rows[0]?.user_id === userId;
}

/** Invalidate cached provider access when its user-scoped validation fails. */
export async function setLicenseStatusForUser(id: string, userId: string, status: "EXPIRED" | "REVOKED"): Promise<void> {
  const sql = await getSql();
  await sql.query(`UPDATE licenses SET status = $3, updated_at = now() WHERE id = $1 AND user_id = $2`, [id, userId, status]);
}

/** Find a license by its key hash. */
export async function findLicenseByKeyHash(keyHash: string): Promise<License | null> {
  const sql = await getSql();
  const rows = await sql.query(
    `SELECT * FROM licenses WHERE key_hash = $1 LIMIT 1`,
    [keyHash],
  );
  return rows.length > 0 ? rowToLicense(rows[0]) : null;
}

export async function upsertExternalLicense(params: {
  keyHash: string;
  keyPrefix: string;
  type?: LicenseType;
  userId: string | null;
  expiresAt: string | null;
  activationCount: number;
  maxActivations: number | null;
  status?: LicenseStatus;
  metadata: Record<string, string>;
}): Promise<License> {
  const sql = await getSql();
  const id = `ext_${params.keyHash.slice(0, 24)}`;
  const rows = await sql.query<Record<string, unknown>>(
    `INSERT INTO licenses (id, key_hash, key_prefix, type, status, user_id, activated_at, expires_at, activation_count, max_activations, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6::text IS NULL THEN NULL ELSE now() END, $7, $8, $9, $10::jsonb)
     ON CONFLICT (key_hash) DO UPDATE SET
       status = EXCLUDED.status,
       user_id = COALESCE(licenses.user_id, EXCLUDED.user_id),
       activated_at = COALESCE(licenses.activated_at, EXCLUDED.activated_at),
       expires_at = EXCLUDED.expires_at,
       activation_count = EXCLUDED.activation_count,
       max_activations = EXCLUDED.max_activations,
       metadata = COALESCE(licenses.metadata, '{}'::jsonb) || EXCLUDED.metadata,
       updated_at = now()
     WHERE EXCLUDED.user_id IS NULL OR licenses.user_id IS NULL OR licenses.user_id = EXCLUDED.user_id
     RETURNING *`,
    [
      id,
      params.keyHash,
      params.keyPrefix,
      params.type ?? "PRO",
      params.status ?? "ACTIVE",
      params.userId,
      params.expiresAt,
      params.activationCount,
      params.maxActivations,
      JSON.stringify(params.metadata),
    ],
  );
  if (!rows[0]) throw new LicenseOwnershipError();
  return rowToLicense(rows[0]);
}

export async function findLicenseByProviderId(provider: string, providerId: string): Promise<License | null> {
  const sql = await getSql();
  const rows = await sql.query(
    `SELECT * FROM licenses WHERE metadata->>'source' = $1 AND metadata->>'keygenLicenseId' = $2 LIMIT 1`,
    [provider, providerId],
  );
  return rows.length > 0 ? rowToLicense(rows[0]) : null;
}

export async function findLicenseByPaylinkTransaction(transactionNo: string): Promise<License | null> {
  const sql = await getSql();
  const rows = await sql.query(
    `SELECT * FROM licenses WHERE metadata->>'paylinkTransactionNo' = $1 LIMIT 1`,
    [transactionNo],
  );
  return rows.length > 0 ? rowToLicense(rows[0]) : null;
}

export async function applyKeygenWebhook(params: {
  eventId: string;
  licenseId: string;
  key?: string;
  keyHash?: string;
  keyPrefix?: string;
  type?: LicenseType;
  userId?: string | null;
  status: LicenseStatus;
  expiresAt?: string | null;
  metadata?: Record<string, string>;
}): Promise<boolean> {
  if (!params.eventId || !params.licenseId) return false;
  const sql = await getSql();
  const existing = await findLicenseByProviderId("keygen", params.licenseId);
  if (!existing && !params.key) return false;
  if (!existing && params.key) {
    await upsertExternalLicense({
      keyHash: params.keyHash || hashLicenseKey(params.key),
      keyPrefix: params.keyPrefix || params.key.slice(0, 14),
      type: params.type,
      userId: params.userId ?? null,
      expiresAt: params.expiresAt ?? null,
      activationCount: 0,
      maxActivations: null,
      status: params.status,
      metadata: {
        source: "keygen",
        keygenLicenseId: params.licenseId,
        ...(params.metadata || {}),
        lastWebhookId: params.eventId,
      },
    });
    return true;
  }
  const id = existing?.id;
  if (!id) return false;
  const expiry = params.expiresAt ?? null;
  const metadata = params.metadata || {};
  await sql.query(
    `UPDATE licenses
     SET status = $3,
         expires_at = COALESCE($4, expires_at),
         metadata = metadata || $5::jsonb,
         updated_at = now()
     WHERE id = $1 AND COALESCE(metadata->>'lastWebhookId', '') <> $2`,
    [id, params.eventId, params.status, expiry, JSON.stringify({ ...metadata, lastWebhookId: params.eventId })],
  );
  return true;
}

/** Find a license by ID. */
export async function findLicenseById(id: string): Promise<License | null> {
  const sql = await getSql();
  const rows = await sql.query(
    `SELECT * FROM licenses WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows.length > 0 ? rowToLicense(rows[0]) : null;
}

/** Find all licenses for a user. */
export async function findLicensesByUserId(userId: string): Promise<License[]> {
  const sql = await getSql();
  // A local admin reassignment (or stale import) must not make a Keygen key
  // usable by an account other than the one verified with the provider.
  const rows = await sql.query(
    `SELECT * FROM licenses WHERE user_id = $1
       AND (metadata->>'source' IS DISTINCT FROM 'keygen' OR (
         (metadata->>'nasaqUserId' IS NULL OR metadata->>'nasaqUserId' = $1)
         AND (metadata->>'userScopeVerified' IS NULL OR metadata->>'userScopeVerified' = $1)
       ))
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(rowToLicense);
}

/** Search and paginate at SQL level so administrators can reach every licence. */
export async function listAllLicenses(
  offset = 0,
  limit = 50,
  search = "",
  status: LicenseStatus | "ALL" = "ALL",
): Promise<AdminLicenseList> {
  const sql = await getSql();
  const pageSize = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
  const start = Number.isSafeInteger(offset) ? Math.max(0, offset) : 0;
  const needle = `%${search.trim().slice(0, 100)}%`;
  const filterStatus = ["ACTIVE", "EXPIRED", "REVOKED"].includes(status) ? status : "ALL";
  const where = `WHERE ($1 = '%%' OR l.key_prefix ILIKE $1 OR l.id ILIKE $1
    OR COALESCE(l.user_id, '') ILIKE $1 OR COALESCE(u.email, '') ILIKE $1
    OR COALESCE(l.metadata->>'source', '') ILIKE $1
    OR COALESCE(l.metadata->>'paylinkTransactionNo', '') ILIKE $1)
    AND ($2 = 'ALL' OR l.status = $2)`;
  const joins = `FROM licenses l LEFT JOIN "user" u ON u.id = l.user_id`;
  const countRows = await sql.query<{ total: number }>(
    `SELECT count(*) as total ${joins} ${where}`, [needle, filterStatus],
  );
  const rows = await sql.query<Record<string, unknown>>(
    `SELECT l.*, u.email AS user_email ${joins} ${where}
     ORDER BY l.created_at DESC, l.id DESC LIMIT $3 OFFSET $4`,
    [needle, filterStatus, pageSize, start],
  );
  // No browser, even an administrator's, needs the SHA-256 key hash.
  return { licenses: rows.map((row) => {
    const { keyHash: _keyHash, ...license } = rowToLicense(row);
    return { ...license, userEmail: (row.user_email as string | null) ?? null };
  }), total: Number(countRows[0]?.total ?? 0) };
}

/** Create a new license. Returns the plain-text key (shown once to admin). */
export async function createLicense(
  params: AdminLicenseCreate,
): Promise<{ license: License; plainKey: string }> {
  const sql = await getSql();
  const plainKey = generateLicenseKey();
  const keyHash = hashLicenseKey(plainKey);
  const prefix = keyPrefix(plainKey);
  const id = `lic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const expiresAt = params.expiresAt ?? null;
  const maxActivations = params.maxActivations ?? null;
  const userId = params.userId ?? null;

  await sql.query(
    `INSERT INTO licenses (id, key_hash, key_prefix, type, status, user_id, expires_at, max_activations)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7)`,
    [id, keyHash, prefix, params.type, userId, expiresAt, maxActivations],
  );

  const license = await findLicenseById(id);
  if (!license) throw new Error("Failed to create license");
  return { license, plainKey };
}

/** Activate a license for a user. Returns true on success. */
export async function activateLicense(
  keyHash: string,
  userId: string | null,
): Promise<{ success: boolean; license?: License; error?: string }> {
  const sql = await getSql();
  const license = await findLicenseByKeyHash(keyHash);
  if (!license) {
    return { success: false, error: "NOT_FOUND" };
  }
  if (!userId) return { success: false, error: "USER_SCOPE_REQUIRED" };

  if (license.status === "REVOKED") {
    return { success: false, error: "REVOKED" };
  }

  if (license.status === "EXPIRED") {
    return { success: false, error: "EXPIRED" };
  }

  if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) {
    await sql.query(
      `UPDATE licenses SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
      [license.id],
    );
    return { success: false, error: "EXPIRED" };
  }

  // Already bound keys cannot move to a second account simply because someone
  // knows their plaintext. Repeat activation by the same account is idempotent.
  if (license.userId && license.userId !== userId) {
    return { success: false, error: license.maxActivations != null && license.activationCount >= license.maxActivations
      ? "ACTIVATION_LIMIT" : "USER_SCOPE_MISMATCH" };
  }
  const rows = await sql.query<Record<string, unknown>>(
    `UPDATE licenses
     SET activated_at = COALESCE(activated_at, now()),
          user_id = COALESCE(user_id, $2),
          activation_count = activation_count + CASE WHEN activated_at IS NULL THEN 1 ELSE 0 END,
          updated_at = now()
     WHERE id = $1
       AND (user_id IS NULL OR user_id = $2)
       AND status = 'ACTIVE'
       AND (expires_at IS NULL OR expires_at > now())
       AND (activated_at IS NOT NULL OR max_activations IS NULL OR activation_count < max_activations)
     RETURNING *`,
    [license.id, userId],
  );

  if (rows.length > 0) return { success: true, license: rowToLicense(rows[0]) };

  const current = await findLicenseById(license.id);
  if (current?.status === "REVOKED") return { success: false, error: "REVOKED" };
  if (current?.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()) {
    await sql.query(
      `UPDATE licenses SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
      [license.id],
    );
    return { success: false, error: "EXPIRED" };
  }
  if (
    current?.maxActivations != null &&
    current.activationCount >= current.maxActivations && current.userId !== userId
  ) {
    return { success: false, error: "ACTIVATION_LIMIT" };
  }
  if (current?.userId && current.userId !== userId) return { success: false, error: "USER_SCOPE_MISMATCH" };
  return { success: false, error: "NOT_FOUND" };
}

/** Validate a license key hash. Returns validity + entitlements info. */
export async function validateLicense(
  keyHash: string,
): Promise<{ valid: boolean; license?: License; expired?: boolean; revoked?: boolean }> {
  const sql = await getSql();
  const license = await findLicenseByKeyHash(keyHash);
  if (!license) {
    return { valid: false };
  }

  if (license.status === "REVOKED") {
    return { valid: false, license, revoked: true };
  }

  if (
    license.status === "EXPIRED" ||
    (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now())
  ) {
    // Auto-expire
    await sql.query(
      `UPDATE licenses SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
      [license.id],
    );
    return { valid: false, license: { ...license, status: "EXPIRED" }, expired: true };
  }

  // Update last-validated timestamp
  await sql.query(
    `UPDATE licenses SET updated_at = now() WHERE id = $1`,
    [license.id],
  );

  return { valid: true, license };
}

/** Update license (admin). */
export async function updateLicense(
  id: string,
  updates: AdminLicenseUpdate,
): Promise<License | null> {
  const sql = await getSql();
  const setClauses: string[] = ["updated_at = now()"];
  const values: unknown[] = [id];
  let paramIdx = 2;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIdx}`);
    values.push(updates.status);
    paramIdx++;
    if (updates.status === "REVOKED") {
      setClauses.push(`revoked_at = now()`);
    }
  }
  if (updates.expiresAt !== undefined) {
    setClauses.push(`expires_at = $${paramIdx}`);
    values.push(updates.expiresAt);
    paramIdx++;
  }
  if (updates.maxActivations !== undefined) {
    setClauses.push(`max_activations = $${paramIdx}`);
    values.push(updates.maxActivations);
    paramIdx++;
  }

  await sql.query(
    `UPDATE licenses SET ${setClauses.join(", ")} WHERE id = $1`,
    values,
  );

  return findLicenseById(id);
}

/** Revoke a license (admin). */
export async function revokeLicense(id: string): Promise<License | null> {
  return updateLicense(id, { status: "REVOKED" });
}

/** Reactivate a revoked/expired license (admin). */
export async function reactivateLicense(id: string): Promise<License | null> {
  const sql = await getSql();
  await sql.query(
    `UPDATE licenses SET status = 'ACTIVE', revoked_at = NULL, updated_at = now() WHERE id = $1`,
    [id],
  );
  return findLicenseById(id);
}

/** Extend a license's expiry date (admin). */
export async function extendLicense(
  id: string,
  daysToAdd?: number,
  newExpiresAt?: string,
): Promise<License | null> {
  const sql = await getSql();
  const license = await findLicenseById(id);
  if (!license) return null;
  let targetExpiresAt: string | null = license.expiresAt;
  if (newExpiresAt != null) {
    targetExpiresAt = newExpiresAt;
  } else if (daysToAdd != null && daysToAdd > 0) {
    const base = license.expiresAt ? new Date(license.expiresAt) : new Date();
    targetExpiresAt = new Date(base.getTime() + daysToAdd * 86400000).toISOString();
  }
  await sql.query(
    `UPDATE licenses SET expires_at = COALESCE($2, expires_at), updated_at = now() WHERE id = $1`,
    [id, targetExpiresAt],
  );
  return findLicenseById(id);
}

/** Assign a license to a user (admin). */
export async function assignLicense(
  licenseId: string,
  userId: string,
  activate = true,
): Promise<License | null> {
  const sql = await getSql();
  const license = await findLicenseById(licenseId);
  if (!license) return null;
  if (license.metadata?.source === "keygen") {
    const verifiedFor = license.metadata.userScopeVerified || license.metadata.nasaqUserId;
    // An administrator's local assignment does not attach/change a Keygen
    // user. Never let this route turn an unlinked or someone else's key into
    // an entitlement: issue it for that user, or activate it in their session.
    if (!verifiedFor || verifiedFor !== userId ||
        (license.metadata.nasaqUserId && license.metadata.nasaqUserId !== userId)) {
      throw new LicenseOwnershipError();
    }
    if (license.userId === userId) return license;
  }
  if (activate) {
    await sql.query(
      `UPDATE licenses SET user_id = $2, activated_at = COALESCE(activated_at, now()), activation_count = activation_count + 1, updated_at = now() WHERE id = $1`,
      [licenseId, userId],
    );
  } else {
    await sql.query(
      `UPDATE licenses SET user_id = $2, updated_at = now() WHERE id = $1`,
      [licenseId, userId],
    );
  }
  return findLicenseById(licenseId);
}

/** Remove a user's local binding without changing the provider license. */
export async function unassignLicense(licenseId: string, userId: string): Promise<License | null> {
  const sql = await getSql();
  await sql.query(
    `UPDATE licenses SET user_id = NULL, updated_at = now() WHERE id = $1 AND user_id = $2`,
    [licenseId, userId],
  );
  return findLicenseById(licenseId);
}
