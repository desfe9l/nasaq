/**
 * NASAQ License — Key generation (Node.js only).
 *
 * License keys are generated server-side using Node.js crypto.
 * Keys are NEVER stored in plaintext — only SHA-256 hashes are persisted.
 * Hashing is done via Web Crypto API (key.client.ts) which works everywhere.
 * Random bytes use Web Crypto API (available in Node.js 18+ and browsers).
 */

import { CHARSET, normalizeLicenseKey, keyPrefix, isValidKeyFormat, isKeygenKeyFormat, hashLicenseKey } from "./key.client";

export { normalizeLicenseKey, keyPrefix, isValidKeyFormat, isKeygenKeyFormat, hashLicenseKey };

/**
 * Generate a cryptographically secure random license key.
 * Format: NASAQ-XXXX-XXXX-XXXX-XXXX (19 chars after prefix)
 *
 * Uses Web Crypto API `crypto.getRandomValues` (CSPRNG) — available in Node.js 18+ and browsers.
 * Not predictable, not sequential, not derived from any user data.
 * Server-side only.
 */
export function generateLicenseKey(): string {
  const segment = (len: number): string => {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => CHARSET[b % CHARSET.length]).join("");
  };

  return `NASAQ-${segment(4)}-${segment(4)}-${segment(4)}-${segment(4)}`;
}