/**
 * NASAQ License — Key generation and hashing.
 *
 * License keys are generated server-side using Node.js crypto.
 * Keys are NEVER stored in plaintext — only SHA-256 hashes are persisted.
 */

import { createHash, randomBytes } from "node:crypto";

/** Characters used in license key segments (no ambiguous chars like 0/O/1/I). */
const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generate a cryptographically secure random license key.
 * Format: NASAQ-XXXX-XXXX-XXXX-XXXX (19 chars after prefix)
 *
 * Uses `randomBytes` (CSPRNG) — not predictable, not sequential,
 * not derived from any user data.
 */
export function generateLicenseKey(): string {
  const segment = (len: number): string => {
    const bytes = randomBytes(len);
    return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join("");
  };

  return `NASAQ-${segment(4)}-${segment(4)}-${segment(4)}-${segment(4)}`;
}

/**
 * Normalize a license key the single way the whole system normalizes:
 * trim, drop internal whitespace a paste can introduce, and uppercase.
 *
 * Generator keys (Keygen HEX scheme) are uppercase by definition and never
 * contain spaces, so this normalization is lossless — it only absorbs how the
 * key was typed/pasted, never what the key IS. Verification still happens
 * against the issuing source (Keygen) or the stored SHA-256 hash.
 */
export function normalizeLicenseKey(key: string): string {
  return key.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * Keys issued by the current license generator (Keygen HEX scheme):
 * five uppercase-hex groups of six with a version suffix, e.g.
 * `8BB5C5-56F186-781D92-3C5259-DA12B3-V3`.
 */
export function isGeneratedKeyFormat(key: string): boolean {
  return /^[0-9A-F]{6}(?:-[0-9A-F]{6}){4}-V\d+$/.test(normalizeLicenseKey(key));
}

/**
 * Hash a license key using SHA-256.
 * This is what gets stored in the database — never the raw key.
 */
export function hashLicenseKey(key: string): string {
  return createHash("sha256").update(normalizeLicenseKey(key)).digest("hex");
}

/**
 * Get a display prefix from a key (first 14 chars, e.g. "8BB5C5-56F186-" →
 * "8BB5C5-56F186" or "NASAQ-ABCD-EFG"). Used in admin UI so admins can
 * identify keys without seeing the full key.
 */
export function keyPrefix(key: string): string {
  const trimmed = normalizeLicenseKey(key);
  return trimmed.length > 14 ? trimmed.slice(0, 14) : trimmed;
}

/**
 * Validate key format before hashing.
 * Returns true if the key matches the expected format.
 */
export function isValidKeyFormat(key: string): boolean {
  return /^NASAQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(
    normalizeLicenseKey(key),
  );
}

/** Keygen keys are provider-defined and may contain signed URL-safe data. */
export function isKeygenKeyFormat(key: string): boolean {
  const value = normalizeLicenseKey(key);
  return value.length >= 8 && value.length <= 4096 && !/\s/.test(value);
}
