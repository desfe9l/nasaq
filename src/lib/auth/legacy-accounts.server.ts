/**
 * Read-only access to the accounts that existed BEFORE first-party auth.
 *
 * WHY THIS EXISTS
 *
 * Until the first-party rewrite (#153) every account lived in Better Auth's
 * schema — first the `"user"` / `"account"` tables in Postgres, then, briefly,
 * the single R2 object `_nasaq-auth/state-v1.json` written by the Better Auth
 * R2 adapter. The new AuthStore (`_nasaq-auth/v1/…`, `auth_users`, or the local
 * file store) started EMPTY and nothing carried those accounts across. The
 * consequences were not cosmetic:
 *
 *   · a pre-existing user's password no longer worked (unknown address);
 *   · signing up again minted a brand-new random id, so everything keyed by the
 *     old id — `admin_users` rows (SUPER_ADMIN / ADMIN), `NASAQ_OWNER_ID`,
 *     licences, subscriptions, projects, `users/<id>/…` storage — stopped
 *     belonging to the person who owns it. That is how the owner and every
 *     promoted administrator lost the admin console.
 *
 * This module lets the sign-in service ADOPT such an account the first time its
 * holder proves who they are — by the old password (verified against the old
 * scrypt hash) or by a provider-verified email — keeping the ORIGINAL id. It
 * never writes to the legacy data and never returns a hash to a caller outside
 * the auth service.
 *
 * Every lookup is best-effort: a missing table, an unreachable database or an
 * absent bucket means "no legacy account", so sign-in for everyone else is
 * unaffected.
 */
import { scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

export type LegacyAccount = {
  /** The ORIGINAL account id — the one every other table references. */
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  /** ISO timestamp, when known. */
  createdAt: string | null;
  /** Better Auth credential hash (`<salt>:<hex key>`), or null (Google-only). */
  passwordHash: string | null;
  source: "postgres" | "r2";
};

export interface LegacyAccountSource {
  findByEmail(email: string): Promise<LegacyAccount | null>;
}

/** A source that knows no legacy accounts (tests, fresh deployments). */
export const NO_LEGACY_ACCOUNTS: LegacyAccountSource = {
  findByEmail: async () => null,
};

// ── Better Auth scrypt verification ─────────────────────────────────────────
//
// Better Auth ≤1.6 hashed passwords as `${hex(16 random bytes)}:${hex(key)}`
// with scrypt(N=16384, r=16, p=1, dkLen=64) over `password.normalize("NFKC")`
// and the HEX salt string as the salt. Mirrored exactly; nothing else accepted.

const LEGACY_SCRYPT = { N: 16384, r: 16, p: 1, dkLen: 64 } as const;
const LEGACY_HASH_PATTERN = /^[0-9a-f]{32}:[0-9a-f]{128}$/i;

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize("NFKC"),
      salt,
      LEGACY_SCRYPT.dkLen,
      {
        N: LEGACY_SCRYPT.N,
        r: LEGACY_SCRYPT.r,
        p: LEGACY_SCRYPT.p,
        maxmem: 128 * LEGACY_SCRYPT.N * LEGACY_SCRYPT.r * 2,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** Constant-time check of a password against a Better Auth credential hash. */
export async function verifyLegacyPasswordHash(
  hash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!hash || !password || !LEGACY_HASH_PATTERN.test(hash)) return false;
  const [salt, expectedHex] = hash.split(":");
  const expected = Buffer.from(expectedHex, "hex");
  try {
    const actual = await scrypt(password, salt);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── Sources ──────────────────────────────────────────────────────────────────

function iso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

let warned = false;
function warnOnce(scope: string, error: unknown): void {
  if (warned) return;
  warned = true;
  // The message only: a driver error can embed a connection string.
  const message = error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/gi, "[redacted]") : String(error);
  console.warn(`[auth] legacy account lookup (${scope}) unavailable: ${message}`);
}

/** Better Auth's Postgres schema: `"user"` + `"account"` (credential rows). */
export function postgresLegacySource(): LegacyAccountSource {
  return {
    async findByEmail(email) {
      if (!process.env.NASAQ_PRIMARY_DATABASE_URL?.trim()) return null;
      try {
        const { getSql } = await import("@/lib/db");
        const sql = await getSql();
        const rows = await sql.query<Record<string, unknown>>(
          `SELECT u.id, u.email, u.name, u."emailVerified" AS email_verified, u.image,
                  u."createdAt" AS created_at, a.password
             FROM "user" u
             LEFT JOIN "account" a
               ON a."userId" = u.id AND a."providerId" = 'credential'
            WHERE lower(u.email) = $1
            ORDER BY (a.password IS NOT NULL) DESC
            LIMIT 1`,
          [email],
        );
        const row = rows[0];
        if (!row || !text(row.id) || !text(row.email)) return null;
        return {
          id: String(row.id),
          email: String(row.email).trim().toLowerCase(),
          name: text(row.name),
          emailVerified: row.email_verified === true,
          image: text(row.image),
          createdAt: iso(row.created_at),
          passwordHash: text(row.password),
          source: "postgres",
        };
      } catch (error) {
        warnOnce("postgres", error);
        return null;
      }
    },
  };
}

/** The object the Better Auth R2 adapter kept every table in. */
export const LEGACY_R2_STATE_KEY = "_nasaq-auth/state-v1.json";

type LegacyState = { tables?: Record<string, Array<Record<string, unknown>>> };

/** Pure lookup over a parsed Better Auth R2 state document (exported for tests). */
export function findInLegacyState(state: LegacyState | null, email: string): LegacyAccount | null {
  const users = state?.tables?.user ?? [];
  const user = users.find((row) => typeof row.email === "string" && row.email.trim().toLowerCase() === email);
  if (!user || !text(user.id)) return null;
  const credential = (state?.tables?.account ?? []).find(
    (row) => row.userId === user.id && row.providerId === "credential" && text(row.password),
  );
  return {
    id: String(user.id),
    email,
    name: text(user.name),
    emailVerified: user.emailVerified === true,
    image: text(user.image),
    createdAt: iso(user.createdAt),
    passwordHash: credential ? String(credential.password) : null,
    source: "r2",
  };
}

const R2_STATE_TTL_MS = 60_000;
let r2StateCache: { at: number; state: LegacyState | null } | null = null;

export function r2LegacySource(): LegacyAccountSource {
  return {
    async findByEmail(email) {
      try {
        const now = Date.now();
        if (!r2StateCache || now - r2StateCache.at > R2_STATE_TTL_MS) {
          const { getObjectStorage } = await import("@/lib/storage/r2.server");
          const storage = getObjectStorage();
          if (!storage) return null;
          const bytes = await storage.get(LEGACY_R2_STATE_KEY);
          const state = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as LegacyState) : null;
          r2StateCache = { at: now, state };
        }
        return findInLegacyState(r2StateCache.state, email);
      } catch (error) {
        warnOnce("r2", error);
        return null;
      }
    },
  };
}

/**
 * Most recent first: the R2 state was written after the Postgres era, so an
 * account present there is the newer copy of the same identity.
 */
export function combineLegacySources(...sources: LegacyAccountSource[]): LegacyAccountSource {
  return {
    async findByEmail(email) {
      const normalized = String(email ?? "").trim().toLowerCase();
      if (!normalized) return null;
      for (const source of sources) {
        const found = await source.findByEmail(normalized);
        if (found) return found;
      }
      return null;
    },
  };
}

let defaultSource: LegacyAccountSource | null = null;

/** The production source: R2 state, then the Postgres Better Auth tables. */
export function defaultLegacyAccountSource(): LegacyAccountSource {
  if (process.env.NASAQ_LEGACY_ACCOUNT_ADOPTION?.trim().toLowerCase() === "off") {
    return NO_LEGACY_ACCOUNTS;
  }
  defaultSource ??= combineLegacySources(r2LegacySource(), postgresLegacySource());
  return defaultSource;
}
