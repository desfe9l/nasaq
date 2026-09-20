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
  type: LicenseType;
  userId: string | null;
  expiresAt: string | null;
  activationCount: number;
  maxActivations: number | null;
  metadata: Record<string, string>;
}): Promise<License> {
  const sql = await getSql();
  const id = `ls_${params.keyHash.slice(0, 24)}`;
  await sql.query(
    `INSERT INTO licenses (id, key_hash, key_prefix, type, status, user_id, activated_at, expires_at, activation_count, max_activations, metadata)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5, now(), $6, $7, $8, $9::jsonb)
     ON CONFLICT (key_hash) DO UPDATE SET
       status = 'ACTIVE',
       user_id = COALESCE(EXCLUDED.user_id, licenses.user_id),
       activated_at = COALESCE(licenses.activated_at, EXCLUDED.activated_at),
       expires_at = EXCLUDED.expires_at,
       activation_count = EXCLUDED.activation_count,
       max_activations = EXCLUDED.max_activations,
       metadata = EXCLUDED.metadata,
       updated_at = now()`,
    [
      id,
      params.keyHash,
      params.keyPrefix,
      params.type,
      params.userId,
      params.expiresAt,
      params.activationCount,
      params.maxActivations,
      JSON.stringify(params.metadata),
    ],
  );
  const license = await findLicenseByKeyHash(params.keyHash);
  if (!license) throw new Error("Failed to persist external license");
  return license;
}

export async function applyLemonWebhook(params: {
  eventId: string;
  orderId?: string;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  expiresAt?: string | null;
}): Promise<boolean> {
  if (!params.eventId || !params.orderId) return false;
  const sql = await getSql();
  const rows = await sql.query(
    `SELECT id FROM licenses WHERE metadata->>'source' = 'lemonsqueezy' AND metadata->>'orderId' = $1 LIMIT 1`,
    [params.orderId],
  );
  const id = rows[0]?.id;
  if (!id) return false;
  const values: unknown[] = [id, params.eventId, params.status];
  const expiry = params.expiresAt ?? null;
  await sql.query(
    `UPDATE licenses
     SET status = $3,
         expires_at = COALESCE($4, expires_at),
         metadata = metadata || jsonb_build_object('lastWebhookId', $2),
         updated_at = now()
     WHERE id = $1 AND COALESCE(metadata->>'lastWebhookId', '') <> $2`,
    [...values, expiry],
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
  const rows = await sql.query(
    `SELECT * FROM licenses WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(rowToLicense);
}

/** List all licenses (admin). */
export async function listAllLicenses(
  offset = 0,
  limit = 50,
): Promise<AdminLicenseList> {
  const sql = await getSql();
  const countRows = await sql.query(`SELECT count(*) as total FROM licenses`);
  const total = Number(countRows[0]?.total ?? 0);
  const rows = await sql.query(
    `SELECT * FROM licenses ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return { licenses: rows.map(rowToLicense), total };
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

  // Check status
  if (license.status === "REVOKED") {
    return { success: false, error: "REVOKED" };
  }

  // Check expiry
  if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
    // Auto-expire
    await sql.query(
      `UPDATE licenses SET status = 'EXPIRED', updated_at = now() WHERE id = $1`,
      [license.id],
    );
    return { success: false, error: "EXPIRED" };
  }

  // Check activation limit
  if (
    license.maxActivations != null &&
    license.activationCount >= license.maxActivations
  ) {
    return { success: false, error: "ACTIVATION_LIMIT" };
  }

  // Activate
  await sql.query(
    `UPDATE licenses
     SET status = 'ACTIVE',
         activated_at = COALESCE(activated_at, now()),
         user_id = COALESCE($2, user_id),
         activation_count = activation_count + 1,
         updated_at = now()
     WHERE id = $1`,
    [license.id, userId],
  );

  const updated = await findLicenseById(license.id);
  return { success: true, license: updated! };
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

  if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
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
