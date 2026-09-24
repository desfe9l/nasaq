/**
 * NASAQ License — Browser-compatible key utilities.
 *
 * These functions are pure JavaScript and work in both Node.js and browser.
 * They do NOT import any Node.js-specific modules.
 */

/** Characters used in license key segments (no ambiguous chars like 0/O/1/I). */
export const CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Unicode dash variants that should be normalized to ASCII hyphen. */
const DASH_VARIANTS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;

/** Non-breaking space and other space variants. */
const SPACE_VARIANTS = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Normalize a license key input for validation/hashing.
 * Handles:
 * - Case insensitivity (uppercase)
 * - ASCII and Unicode spaces (trim + collapse)
 * - Unicode dash variants (en-dash, em-dash, etc.) → ASCII hyphen
 * - Multiple consecutive separators → single hyphen
 *
 * Pure JS — works in both Node.js and browser.
 */
export function normalizeLicenseKey(key: string): string {
  return key
    .replace(SPACE_VARIANTS, " ")
    .replace(DASH_VARIANTS, "-")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * Get a display prefix from a key (first 19 chars: "NASAQ-XXXX-XXXX").
 * Used in admin UI so admins can identify keys without seeing the full key.
 */
export function keyPrefix(key: string): string {
  const trimmed = normalizeLicenseKey(key);
  // "NASAQ-XXXX-XXXX-..." -> first 14 chars show the type + first 2 segments
  return trimmed.length > 14 ? trimmed.slice(0, 14) : trimmed;
}

/**
 * Validate key format before hashing.
 * Returns true if the key matches the expected format after normalization.
 */
export function isValidKeyFormat(key: string): boolean {
  const normalized = normalizeLicenseKey(key);
  return /^NASAQ-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalized);
}

/** Keygen keys are provider-defined and may contain signed URL-safe data. */
export function isKeygenKeyFormat(key: string): boolean {
  const value = key.trim();
  return value.length >= 8 && value.length <= 4096 && !/\s/.test(value);
}

/**
 * Hash a license key using SHA-256.
 * Uses Web Crypto API (available in Node.js 18+ and modern browsers).
 */
export async function hashLicenseKey(key: string): Promise<string> {
  const normalized = normalizeLicenseKey(key);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}