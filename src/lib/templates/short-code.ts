/**
 * Short template share codes — the public half.
 *
 * A share link used to expose an internal identifier:
 * `/templates/tpl_9f2c1a7e-4b0d-4a55-9c31-0aa9d0b21f44`, or a 32-character hex
 * token under `/templates/share/`. Both are long, unreadable and impossible to
 * dictate over the phone. A template now also owns a 7-character code, so the
 * address people actually see is `/t/k7m2p9q` (official templates) or
 * `/s/k7m2p9q` (a personal template the owner shared).
 *
 * Codes are minted once and never rotate: a link that left the building keeps
 * resolving after a refresh, a redeploy or a direct open. The long addresses
 * keep working as well, so nothing already shared breaks.
 */

/**
 * Unambiguous alphabet: no `0`/`O`, no `1`/`l`/`I`, no vowels — a code can be
 * read aloud, written down and typed back without a single guess.
 */
export const SHORT_CODE_ALPHABET = "23456789bcdfghjkmnpqrstvwxz";

/** 27^7 ≈ 10^10 addresses — collision-free in practice, short enough to share. */
export const SHORT_CODE_LENGTH = 7;

/** Accepts 6–10 characters so the length can grow without orphaning old links. */
export const SHORT_CODE_RE = /^[2-9bcdfghjkmnpqrstvwxz]{6,10}$/;

/** Lower-cases and validates; returns `null` for anything that is not a code. */
export function normalizeShortCode(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return SHORT_CODE_RE.test(raw) ? raw : null;
}

export function isShortCode(value: unknown): boolean {
  return normalizeShortCode(value) !== null;
}

/**
 * Maps raw bytes onto the alphabet. Pure so it is testable without a database:
 * `newShortCode()` in `short-code.server.ts` feeds it cryptographic bytes.
 */
export function shortCodeFromBytes(bytes: Uint8Array, length = SHORT_CODE_LENGTH): string {
  const alphabet = SHORT_CODE_ALPHABET;
  let out = "";
  for (let i = 0; out.length < length; i += 1) {
    const byte = i < bytes.length ? bytes[i]! : alphabet.charCodeAt(i % alphabet.length);
    out += alphabet[byte % alphabet.length];
  }
  return out;
}
