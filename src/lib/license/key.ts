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
 * Hash a license key using SHA-256.
 * This is what gets stored in the database — never the raw key.
 */
export function hashLicenseKey(key: string): string {
  return createHash("sha256").update(key.trim().toUpperCase()).digest("hex");
}

/**
 * Get a display prefix from a key (first 19 chars: "NASAQ-XXXX-XXXX").
 * Used in admin UI so admins can identify keys without seeing the full key.
 */
export function keyPrefix(key: string): string {
  const trimmed = key.trim().toUpperCase();
  // "NASAQ-XXXX-XXXX-..." -> first 14 chars show the type + first 2 segments
  return trimmed.length > 14 ? trimmed.slice(0, 14) : trimmed;
}

/**
 * Validate key format before hashing.
 * Returns true if the key matches the expected format.
 */
export function isValidKeyFormat(key: string): boolean {
  return /^NASAQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(
    key.trim().toUpperCase(),
  );
}

/** Keygen keys are provider-defined and may contain signed URL-safe data. */
export function isKeygenKeyFormat(key: string): boolean {
  const value = key.trim();
  return value.length >= 8 && value.length <= 4096 && !/\s/.test(value);
}
