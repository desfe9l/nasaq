/**
 * Password hashing — Argon2id, in this repo, with no native build step.
 *
 * `@noble/hashes` is an audited, zero-dependency, pure-JS implementation of
 * Argon2id; it ships nothing to compile, so it survives serverless bundling
 * (a native `.node` addon is exactly the kind of artifact Nitro fails to trace)
 * and it runs identically in tests, in development and on Vercel.
 *
 * PARAMETERS follow the OWASP Password Storage Cheat Sheet baseline — memory
 * 19 MiB, 2 iterations, 1 lane — and are stored INSIDE every hash in the
 * standard PHC encoding:
 *
 *     $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 *
 * so a future parameter bump needs no migration: `passwordNeedsRehash` reports
 * which rows predate the policy, and the next successful sign-in re-hashes in
 * place.
 *
 * RULES THIS MODULE ENFORCES
 *   · a password is never logged, never stored, and never returned;
 *   · an unknown account still costs a real verification (`verifyPassword`
 *     against a generated hash) so response timing cannot be used to discover
 *     which addresses exist;
 *   · hashes are compared with `timingSafeEqual`, never `===`.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { argon2idAsync } from "@noble/hashes/argon2.js";

/** Minimum accepted password length — mirrors the sign-in/sign-up form. */
export const PASSWORD_MIN_LENGTH = 8;
/** Maximum accepted length. Argon2 has no need for a cap; DoS does. */
export const PASSWORD_MAX_LENGTH = 128;

/** The live policy. Changing it is a rehash trigger, never a breaking change. */
export const ARGON2_PARAMETERS = {
  m: 19456, // 19 MiB
  t: 2,
  p: 1,
  dkLen: 32,
  version: 0x13,
} as const;

const SALT_BYTES = 16;
const ALGORITHM = "argon2id";
/** Scheduler slice for the async variant: yields so a login cannot stall the loop. */
const ASYNC_TICK_MS = 10;

export type PasswordPolicyFailure = {
  ok: false;
  code: "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" | "PASSWORD_TOO_WEAK";
  message: string;
};

export type PasswordPolicyResult = { ok: true } | PasswordPolicyFailure;

/**
 * Passwords that make a brute-force attack unnecessary.
 *
 * Deliberately short and dependency-free: this is a floor, not a strength meter.
 * The list is compared case-insensitively against the whole password, and the
 * email/password-name checks below catch the likeliest "clever" variations.
 */
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password1",
  "password123",
  "passw0rd",
  "qwerty123",
  "qwertyuiop",
  "iloveyou",
  "admin123",
  "administrator",
  "letmein123",
  "welcome1",
  "welcome123",
  "abc12345",
  "11111111",
  "00000000",
  "nasaq123",
  "nasaq1234",
  "changeme",
  "changeme1",
  "secret123",
  "test1234",
  "temppassword",
]);

/**
 * Validate a password against the deployment's policy.
 *
 * Pure and synchronous: the same function runs on the sign-up form's server
 * call, in the API route, and in tests, so the rules cannot drift.
 */
export function validatePasswordPolicy(
  password: string,
  context: { email?: string | null; name?: string | null } = {},
): PasswordPolicyResult {
  const value = String(password ?? "");
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      code: "PASSWORD_TOO_SHORT",
      message: `كلمة المرور قصيرة — ${PASSWORD_MIN_LENGTH} أحرف على الأقل.`,
    };
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      code: "PASSWORD_TOO_LONG",
      message: `كلمة المرور طويلة — ${PASSWORD_MAX_LENGTH} حرفًا كحد أقصى.`,
    };
  }
  const lower = value.toLowerCase();
  const local = String(context.email ?? "")
    .trim()
    .toLowerCase()
    .split("@")[0];
  const name = String(context.name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const weak =
    COMMON_PASSWORDS.has(lower) ||
    (Boolean(local) && local.length >= 4 && (lower === local || lower.includes(local))) ||
    (Boolean(name) && name.length >= 4 && lower.includes(name));
  if (weak) {
    return {
      ok: false,
      code: "PASSWORD_TOO_WEAK",
      message: "كلمة المرور سهلة التخمين — استخدم عبارة أطول لا ترتبط ببريدك أو اسمك.",
    };
  }
  return { ok: true };
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "");
}

function fromBase64(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, "base64"));
}

async function derive(
  password: string,
  salt: Uint8Array,
  parameters: { m: number; t: number; p: number; dkLen: number; version: number },
): Promise<Uint8Array> {
  return argon2idAsync(new TextEncoder().encode(password), salt, {
    m: parameters.m,
    t: parameters.t,
    p: parameters.p,
    dkLen: parameters.dkLen,
    version: parameters.version,
    asyncTick: ASYNC_TICK_MS,
  });
}

/**
 * Hash a password into a PHC string. The salt is fresh per call, so two
 * accounts with the same password never share a hash.
 */
export async function hashPassword(
  password: string,
  parameters: typeof ARGON2_PARAMETERS = ARGON2_PARAMETERS,
): Promise<string> {
  const salt = new Uint8Array(randomBytes(SALT_BYTES));
  const hash = await derive(password, salt, parameters);
  return encodePhc(hash, salt, parameters);
}

function encodePhc(
  hash: Uint8Array,
  salt: Uint8Array,
  parameters: { m: number; t: number; p: number; version: number },
): string {
  return (
    // PHC encodes the version in DECIMAL (`v=19` == 0x13), and the same value
    // is what the verifier must hand back to the KDF.
    `$${ALGORITHM}$v=${parameters.version}` +
    `$m=${parameters.m},t=${parameters.t},p=${parameters.p}` +
    `$${toBase64(salt)}$${toBase64(hash)}`
  );
}

type ParsedHash = {
  parameters: { m: number; t: number; p: number; dkLen: number; version: number };
  salt: Uint8Array;
  hash: Uint8Array;
};

/** Parse a PHC string. Anything unrecognized is `null` — never a guess. */
export function parsePasswordHash(encoded: string | null | undefined): ParsedHash | null {
  if (!encoded) return null;
  const parts = String(encoded).split("$");
  // ["", "argon2id", "v=19", "m=19456,t=2,p=1", salt, hash]
  if (parts.length !== 6 || parts[1] !== ALGORITHM) return null;
  const version = Number(parts[2]?.replace(/^v=/, ""));
  const params = new Map(
    (parts[3] ?? "").split(",").map((pair) => pair.split("=") as [string, string]),
  );
  const m = Number(params.get("m"));
  const t = Number(params.get("t"));
  const p = Number(params.get("p"));
  if (![version, m, t, p].every((value) => Number.isFinite(value) && value > 0)) return null;
  let salt: Uint8Array;
  let hash: Uint8Array;
  try {
    salt = fromBase64(parts[4] ?? "");
    hash = fromBase64(parts[5] ?? "");
  } catch {
    return null;
  }
  if (!salt.length || !hash.length) return null;
  return {
    parameters: { m, t, p, dkLen: hash.length, version },
    salt,
    hash,
  };
}

export type PasswordVerification = {
  ok: boolean;
  /** True when the stored hash predates the current policy (rehash on success). */
  needsRehash: boolean;
};

/** True when a stored hash was produced with parameters we no longer use. */
export function passwordNeedsRehash(encoded: string | null | undefined): boolean {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return true;
  const live = ARGON2_PARAMETERS;
  return (
    parsed.parameters.m !== live.m ||
    parsed.parameters.t !== live.t ||
    parsed.parameters.p !== live.p ||
    parsed.parameters.dkLen !== live.dkLen ||
    parsed.parameters.version !== live.version
  );
}

/**
 * Verify a password against a stored PHC hash.
 *
 * An unparseable/absent hash always fails — an account with no password (created
 * through Google) cannot be entered with one.
 */
export async function verifyPassword(
  password: string,
  encoded: string | null | undefined,
): Promise<PasswordVerification> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return { ok: false, needsRehash: false };
  const candidate = await derive(password, parsed.salt, parsed.parameters);
  const expected = Buffer.from(parsed.hash);
  const actual = Buffer.from(candidate);
  const ok =
    expected.length === actual.length && timingSafeEqual(expected, actual);
  return { ok, needsRehash: ok && passwordNeedsRehash(encoded) };
}

/**
 * Spend the same work on an unknown account as on a known one.
 *
 * Sign-in calls this when no account matches the address, so "no such user" and
 * "wrong password" cannot be told apart by timing.
 */
let dummyHash: string | null = null;
export async function verifyPasswordAgainstUnknownAccount(password: string): Promise<void> {
  dummyHash ??= await hashPassword(randomBytes(24).toString("base64url"));
  await verifyPassword(password, dummyHash);
}
