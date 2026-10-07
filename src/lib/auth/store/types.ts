/**
 * The identity storage contract (AuthStore) — storage-agnostic by design.
 *
 * NASAQ owns its accounts. Nothing here knows about Postgres,
 * Cloudflare or the filesystem: the service layer (`../service.server.ts`) speaks
 * only this interface, so the backend can be swapped without touching
 * authentication, its routes or its UI.
 *
 * THE THREE IMPLEMENTATIONS
 *   · `./r2.ts`        — Cloudflare R2 (S3-compatible) object storage. The
 *                        deployment's durable, private backend; independent of
 *                        the application database.
 *   · `./postgres.ts`  — Postgres (Neon/Vercel Postgres/self-hosted/PGLite). An
 *                        OPTIONAL backend for environments that already have a
 *                        database; never required for authentication to work.
 *   · `./file.ts`      — a local directory. Development and tests only; it is
 *                        refused on a deployed runtime (no writable disk).
 *
 * WHAT IS NEVER AN IMPLEMENTATION
 *   · process/module memory — a serverless instance dies between requests, so a
 *     memory store would silently log everyone out;
 *   · cookies or localStorage — the client must never own identity state.
 *
 * SECURITY PROPERTIES THE INTERFACE GUARANTEES
 *   · the password column stores an Argon2id PHC string, never a password;
 *   · a session is keyed by the SHA-256 of its opaque token, so the token itself
 *     is never persisted;
 *   · `createUser` is the ONLY write that must refuse duplicates — an
 *     implementation must make the normalized email unique atomically (or fail
 *     closed with `DuplicateEmailError`), because "two accounts, one address" is
 *     an account-takeover primitive.
 */

/** One account row as the store keeps it. */
export type StoredUser = {
  id: string;
  /** Normalized (trimmed + lower-cased) address. Unique across accounts. */
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  /** Argon2id PHC string, or `null` for an account with no password (Google/gate). */
  passwordHash: string | null;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Consecutive failed password attempts (brute-force lock). */
  failedAttempts: number;
  /** ISO timestamp while the account is locked, else `null`. */
  lockedUntil: string | null;
};

/** Fields a caller supplies when creating an account. */
export type NewStoredUser = Pick<
  StoredUser,
  "id" | "email" | "name" | "emailVerified" | "image" | "passwordHash"
> &
  Partial<Pick<StoredUser, "createdAt" | "updatedAt" | "failedAttempts" | "lockedUntil">>;

/** One session row, keyed by the hash of its opaque token. */
export type StoredSession = {
  /** SHA-256 (hex) of the opaque session token. The only copy that is stored. */
  tokenHash: string;
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  /** When the token was last rotated; `null` for a freshly minted session. */
  rotatedAt: string | null;
  /** Set when the session was signed out or replaced by a rotation. */
  revokedAt: string | null;
  ip: string | null;
  userAgent: string | null;
};

/** Mutable session fields. Immutable keys are rejected by construction. */
export type SessionPatch = Partial<
  Pick<StoredSession, "expiresAt" | "rotatedAt" | "revokedAt" | "ip" | "userAgent">
>;

/** Mutable user fields. `id`/`createdAt` are deliberately not patchable. */
export type UserPatch = Partial<
  Pick<
    StoredUser,
    "name" | "email" | "emailVerified" | "image" | "passwordHash" | "failedAttempts" | "lockedUntil"
  >
>;

/**
 * A durable rate-limit / lock counter.
 *
 * Kept in the same store as identity on purpose: a throttle that evaporates when
 * a serverless instance recycles is not a brute-force control.
 */
export type ThrottleRecord = {
  /** ISO start of the current counting window. */
  windowStartedAt: string;
  /** Attempts counted inside the window. */
  attempts: number;
  /** ISO time while the subject is blocked, else `null`. */
  blockedUntil: string | null;
};

/**
 * The store could not be reached or is not configured. The service translates
 * this into a 503 with an actionable operator message (variable NAMES only) —
 * never into a silent "wrong password".
 */
export class AuthStoreUnavailableError extends Error {
  readonly code = "AUTH_STORE_UNAVAILABLE";
  constructor(message = "durable auth storage is unavailable") {
    super(message);
    this.name = "AuthStoreUnavailableError";
  }
}

/** The normalized email already belongs to an account. */
export class DuplicateEmailError extends Error {
  readonly code = "USER_ALREADY_EXISTS";
  constructor(message = "an account with this email already exists") {
    super(message);
    this.name = "DuplicateEmailError";
  }
}

export interface AuthStore {
  /** Diagnostics label. A constant, never a credential or a URL. */
  readonly kind: string;
  /** True when the backend survives process restarts (every non-test backend). */
  readonly durable: boolean;

  createUser(user: NewStoredUser): Promise<StoredUser>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(id: string): Promise<StoredUser | null>;
  updateUser(id: string, patch: UserPatch): Promise<StoredUser | null>;
  deleteUser(id: string): Promise<void>;
  /** Most recent accounts first. Used by the admin console, never for auth. */
  listUsers(limit: number): Promise<StoredUser[]>;

  createSession(session: StoredSession): Promise<void>;
  findSession(tokenHash: string): Promise<StoredSession | null>;
  updateSession(tokenHash: string, patch: SessionPatch): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Revoke every session of an account (password change, "sign out all"). */
  deleteUserSessions(userId: string): Promise<number>;

  readThrottle(key: string): Promise<ThrottleRecord | null>;
  writeThrottle(key: string, record: ThrottleRecord): Promise<void>;
}
