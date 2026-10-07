/**
 * The first-party authentication service — sign-up, sign-in, sessions,
 * rotation, revocation, lockouts.
 *
 * This is the ONLY place that decides who someone is. It talks to the
 * storage-agnostic `AuthStore` (`./store`), never to Postgres, Better Auth, an
 * identity provider or process memory, so login keeps working exactly as long as
 * durable storage does — and the app's database is no longer part of that answer.
 *
 * SECURITY DECISIONS, each load-bearing:
 *
 *   · **Passwords** are Argon2id (`./password.ts`) and are compared with
 *     `timingSafeEqual`. A wrong password and an unknown address produce the
 *     SAME code, the same status and the same amount of work — no timing or
 *     wording oracle to enumerate accounts with.
 *   · **Sessions** are opaque 256-bit tokens; only their SHA-256 is stored. A
 *     stolen dump of the bucket is not a set of working credentials.
 *   · **Sessions rotate** daily and slide for 30 days up to a 90-day absolute
 *     ceiling, so a copied cookie has a bounded life and an active visitor is
 *     not signed out every month.
 *   · **Brute force** is bounded on two axes: per-IP windows (durable counters)
 *     and per-account lockouts with increasing duration. Both live in the store,
 *     because a serverless instance that recycles must not reset the counter.
 *   · **Error responses** carry a stable code and an Arabic sentence, never a
 *     stack trace, a database message or a hint about which part was wrong.
 */
import { randomUUID } from "node:crypto";
import { isValidEmail, normalizeEmail, normalizeName } from "./credentials";
import {
  hashPassword,
  passwordNeedsRehash,
  validatePasswordPolicy,
  verifyPassword,
  verifyPasswordAgainstUnknownAccount,
} from "./password";
import {
  hashSessionToken,
  isSessionBeyondAbsoluteLimit,
  isSessionUsable,
  mintSessionToken,
  newSessionId,
  normalizeUserAgent,
  sessionExpiryFrom,
  shouldRotateSession,
  SESSION_TTL_SECONDS,
} from "./session";
import type { AuthStore, StoredSession, StoredUser } from "./store/types";
import { mirrorUserToDatabase } from "./user-mirror.server";
import { AuthStoreUnavailableError, DuplicateEmailError } from "./store/types";

/** What a caller gets back: a stable code plus the sentence the UI shows. */
export type AuthFailure = {
  code: string;
  message: string;
  status: number;
  retryAfterSeconds?: number;
};

export type AuthOutcome<T> = { ok: true; value: T } | { ok: false; failure: AuthFailure };

const fail = (
  code: string,
  status: number,
  message: string,
  retryAfterSeconds?: number,
): AuthOutcome<never> => ({
  ok: false,
  failure: { code, status, message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
});

/** The public shape of an account — the password hash never crosses this line. */
export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicSession = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  /** True when this response rotated the token (the caller sets the new cookie). */
  rotated: boolean;
};

export type SessionResult = {
  user: PublicUser;
  session: PublicSession;
  /** The live opaque token. Returned only to the HTTP layer, for the cookie. */
  token: string;
};

export function publicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    image: user.image,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/** Request metadata that gets attached to a session (descriptive only). */
export type AuthRequestContext = {
  ip?: string | null;
  userAgent?: string | null;
};

// ── Rate limiting / lockout policy ───────────────────────────────────────────

/** Per-IP sign-in attempts inside the window before the address is blocked. */
export const LOGIN_IP_MAX_ATTEMPTS = 30;
export const LOGIN_IP_WINDOW_SECONDS = 10 * 60;
/** Per-IP sign-ups per hour — account creation is not a free unbounded action. */
export const SIGNUP_IP_MAX_ATTEMPTS = 10;
export const SIGNUP_IP_WINDOW_SECONDS = 60 * 60;
/**
 * Per-address sign-in attempts (known or not) before a cooling-off block.
 *
 * Deliberately HIGHER than the first rung of the account-lockout ladder: the
 * lockout is the more specific, more useful answer for a real account ("this
 * account is locked, wait 60 s"), and a limit that fires first would mask it
 * with a generic "too many requests". What this limit adds is protection
 * against SPRAYING — many addresses probed from one client — which the per
 * account lock cannot see.
 */
export const LOGIN_ADDRESS_MAX_ATTEMPTS = 10;
export const LOGIN_ADDRESS_WINDOW_SECONDS = 15 * 60;
export const LOGIN_ADDRESS_BLOCK_SECONDS = 300;

/** Account lockout ladder: consecutive failures → lock duration. */
export const ACCOUNT_LOCK_LADDER: ReadonlyArray<{ failures: number; lockSeconds: number }> = [
  { failures: 5, lockSeconds: 60 },
  { failures: 8, lockSeconds: 300 },
  { failures: 12, lockSeconds: 900 },
];

export function lockDurationForFailures(failures: number): number {
  let seconds = 0;
  for (const step of ACCOUNT_LOCK_LADDER) {
    if (failures >= step.failures) seconds = step.lockSeconds;
  }
  return seconds;
}

type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Consume one unit from a durable counter.
 *
 * Failures here are fail-OPEN for availability: if the counter cannot be read or
 * written, the request proceeds (the password check is still the real gate).
 * A limiter that turns a storage hiccup into "nobody can sign in" would be a
 * self-inflicted outage, and the lockout ladder on the account row still applies.
 */
async function consumeRateLimit(
  store: AuthStore,
  key: string,
  policy: { windowSeconds: number; maxAttempts: number; blockSeconds: number },
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  try {
    const record = await store.readThrottle(key);
    const blockedUntil = record?.blockedUntil ? Date.parse(record.blockedUntil) : 0;
    if (blockedUntil > now.getTime()) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now.getTime()) / 1000)),
      };
    }
    const windowStart = record ? Date.parse(record.windowStartedAt) : 0;
    const windowExpired =
      !record || !Number.isFinite(windowStart) ||
      now.getTime() - windowStart >= policy.windowSeconds * 1000;
    const attempts = windowExpired ? 1 : (record?.attempts ?? 0) + 1;
    const overLimit = attempts > policy.maxAttempts;
    const next = {
      windowStartedAt: windowExpired ? now.toISOString() : record!.windowStartedAt,
      attempts,
      blockedUntil: overLimit
        ? new Date(now.getTime() + policy.blockSeconds * 1000).toISOString()
        : null,
    };
    await store.writeThrottle(key, next);
    if (overLimit) {
      return { allowed: false, retryAfterSeconds: policy.blockSeconds };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

/** Forget a counter after a success (nothing to cool down any more). */
async function clearRateLimit(store: AuthStore, key: string): Promise<void> {
  try {
    await store.writeThrottle(key, {
      windowStartedAt: new Date().toISOString(),
      attempts: 0,
      blockedUntil: null,
    });
  } catch {
    /* best effort — a stale counter only costs the visitor a delay */
  }
}

const loginAddressKey = (email: string) => `login:addr:${normalizeEmail(email)}`;
const loginIpKey = (ip: string) => `login:ip:${ip || "unknown"}`;
const signupIpKey = (ip: string) => `signup:ip:${ip || "unknown"}`;

// ── Session issuance ─────────────────────────────────────────────────────────

async function issueSession(
  store: AuthStore,
  user: StoredUser,
  context: AuthRequestContext,
  now: Date = new Date(),
): Promise<{ token: string; session: StoredSession }> {
  const token = mintSessionToken();
  const session: StoredSession = {
    tokenHash: hashSessionToken(token),
    id: newSessionId(),
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: sessionExpiryFrom(now),
    rotatedAt: null,
    revokedAt: null,
    ip: context.ip?.trim() || null,
    userAgent: normalizeUserAgent(context.userAgent),
  };
  await store.createSession(session);
  return { token, session };
}

// ── Sign-up ──────────────────────────────────────────────────────────────────

export type SignUpInput = AuthRequestContext & {
  email?: unknown;
  password?: unknown;
  name?: unknown;
};

/**
 * Create an account and sign it in (one request, one cookie).
 *
 * Duplicate addresses are refused by the STORE (unique index), never by a
 * pre-check, so two simultaneous sign-ups cannot both win.
 */
export async function signUpWithPassword(
  store: AuthStore,
  input: SignUpInput,
  now: Date = new Date(),
): Promise<AuthOutcome<SessionResult>> {
  const email = normalizeEmail(String(input.email ?? ""));
  const password = String(input.password ?? "");
  const name = normalizeName(String(input.name ?? ""));

  if (!isValidEmail(email)) {
    return fail("INVALID_EMAIL", 400, "صيغة البريد الإلكتروني غير صحيحة.");
  }
  const policy = validatePasswordPolicy(password, { email, name });
  if (!policy.ok) return fail(policy.code, 400, policy.message);

  const limit = await consumeRateLimit(
    store,
    signupIpKey(String(input.ip ?? "")),
    {
      windowSeconds: SIGNUP_IP_WINDOW_SECONDS,
      maxAttempts: SIGNUP_IP_MAX_ATTEMPTS,
      blockSeconds: SIGNUP_IP_WINDOW_SECONDS,
    },
    now,
  );
  if (!limit.allowed) {
    return fail(
      "TOO_MANY_REQUESTS",
      429,
      "تم إنشاء حسابات كثيرة من هذا الاتصال. أعد المحاولة بعد قليل.",
      limit.retryAfterSeconds,
    );
  }

  const passwordHash = await hashPassword(password);
  let user: StoredUser;
  try {
    user = await store.createUser({
      id: randomUUID(),
      email,
      name: name || null,
      emailVerified: false,
      image: null,
      passwordHash,
    });
  } catch (error) {
    if (error instanceof DuplicateEmailError) {
      return fail(
        "USER_ALREADY_EXISTS",
        422,
        "هذا البريد الإلكتروني مسجّل بالفعل. سجّل الدخول بدلًا من إنشاء حساب جديد.",
      );
    }
    throw error;
  }

  // Best-effort projection into the application database, so licence/payment
  // /admin code that still joins `"user"` sees the account. It never blocks
  // account creation and never throws (see `user-mirror.server.ts`).
  await mirrorUserToDatabase(user);

  const { token, session } = await issueSession(store, user, input, now);
  return {
    ok: true,
    value: {
      user: publicUser(user),
      session: {
        id: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        rotated: false,
      },
      token,
    },
  };
}

// ── Sign-in ──────────────────────────────────────────────────────────────────

export type SignInInput = AuthRequestContext & {
  email?: unknown;
  password?: unknown;
};

/** The one sentence a failed credential check ever produces. */
const INVALID_CREDENTIALS_MESSAGE = "البريد الإلكتروني أو كلمة المرور غير صحيحة.";

export async function signInWithPassword(
  store: AuthStore,
  input: SignInInput,
  now: Date = new Date(),
): Promise<AuthOutcome<SessionResult>> {
  const email = normalizeEmail(String(input.email ?? ""));
  const password = String(input.password ?? "");
  if (!isValidEmail(email) || !password) {
    // Same code as a wrong password: a malformed address must not be a hint.
    return fail("INVALID_EMAIL_OR_PASSWORD", 401, INVALID_CREDENTIALS_MESSAGE);
  }

  const ipLimit = await consumeRateLimit(
    store,
    loginIpKey(String(input.ip ?? "")),
    {
      windowSeconds: LOGIN_IP_WINDOW_SECONDS,
      maxAttempts: LOGIN_IP_MAX_ATTEMPTS,
      blockSeconds: LOGIN_IP_WINDOW_SECONDS,
    },
    now,
  );
  if (!ipLimit.allowed) {
    return fail(
      "TOO_MANY_REQUESTS",
      429,
      "محاولات دخول كثيرة. أعد المحاولة بعد قليل.",
      ipLimit.retryAfterSeconds,
    );
  }

  const addressLimit = await consumeRateLimit(
    store,
    loginAddressKey(email),
    {
      windowSeconds: LOGIN_ADDRESS_WINDOW_SECONDS,
      maxAttempts: LOGIN_ADDRESS_MAX_ATTEMPTS,
      blockSeconds: LOGIN_ADDRESS_BLOCK_SECONDS,
    },
    now,
  );
  if (!addressLimit.allowed) {
    return fail(
      "TOO_MANY_REQUESTS",
      429,
      "محاولات دخول كثيرة على هذا الحساب. أعد المحاولة بعد قليل.",
      addressLimit.retryAfterSeconds,
    );
  }

  const user = await store.findUserByEmail(email);
  if (!user) {
    // Burn the same work as a real verification, then answer identically.
    await verifyPasswordAgainstUnknownAccount(password);
    return fail("INVALID_EMAIL_OR_PASSWORD", 401, INVALID_CREDENTIALS_MESSAGE);
  }

  if (user.lockedUntil && Date.parse(user.lockedUntil) > now.getTime()) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(user.lockedUntil) - now.getTime()) / 1000),
    );
    // Still run the hash: a locked response must not become a cheap oracle.
    await verifyPassword(password, user.passwordHash);
    return fail(
      "ACCOUNT_LOCKED",
      429,
      "الحساب مقفل مؤقتًا بعد محاولات فاشلة متكررة. أعد المحاولة بعد قليل.",
      retryAfterSeconds,
    );
  }

  const verification = await verifyPassword(password, user.passwordHash);
  if (!verification.ok) {
    const failures = (user.failedAttempts ?? 0) + 1;
    const lockSeconds = lockDurationForFailures(failures);
    await store.updateUser(user.id, {
      failedAttempts: failures,
      lockedUntil:
        lockSeconds > 0 ? new Date(now.getTime() + lockSeconds * 1000).toISOString() : null,
    });
    const locked = lockSeconds > 0;
    return fail(
      locked ? "ACCOUNT_LOCKED" : "INVALID_EMAIL_OR_PASSWORD",
      locked ? 429 : 401,
      locked
        ? "الحساب مقفل مؤقتًا بعد محاولات فاشلة متكررة. أعد المحاولة بعد قليل."
        : INVALID_CREDENTIALS_MESSAGE,
      locked ? lockSeconds : undefined,
    );
  }

  // Success: clear the lock ladder and, if the stored hash predates the current
  // policy, rehash in place now that the plaintext is legitimately available.
  const patch: Record<string, unknown> = {};
  if (user.failedAttempts || user.lockedUntil) {
    patch.failedAttempts = 0;
    patch.lockedUntil = null;
  }
  if (verification.needsRehash || passwordNeedsRehash(user.passwordHash)) {
    patch.passwordHash = await hashPassword(password);
  }
  const updated = Object.keys(patch).length
    ? ((await store.updateUser(user.id, patch)) ?? user)
    : user;
  await clearRateLimit(store, loginAddressKey(email));
  // Catch the projection up when the database was unavailable at sign-up.
  await mirrorUserToDatabase(updated);

  const { token, session } = await issueSession(store, updated, input, now);
  return {
    ok: true,
    value: {
      user: publicUser(updated),
      session: {
        id: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        rotated: false,
      },
      token,
    },
  };
}

// ── Session lookup / refresh / rotation ──────────────────────────────────────

/**
 * Resolve an opaque token into a live session.
 *
 * Two things happen on the way, both bounded:
 *   · sliding expiry — the session is extended when it is more than a day from
 *     its expiry, never past the absolute ceiling;
 *   · rotation — a token older than a day is replaced (`rotated: true`), so the
 *     caller emits the new cookie and the old token stops working immediately.
 */
export async function resolveSession(
  store: AuthStore,
  token: string,
  now: Date = new Date(),
  /**
   * `allowRotation: false` is for callers that CANNOT set a cookie (a server
   * function reading the session off a request). Rotation retires the presented
   * token, so performing it there would sign the visitor out on their next
   * request. Rotation therefore happens only on the HTTP session endpoint,
   * which echoes the replacement cookie.
   */
  options: { allowRotation?: boolean } = {},
): Promise<AuthOutcome<SessionResult | null>> {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  const tokenHash = hashSessionToken(trimmed);
  const session = await store.findSession(tokenHash);
  if (!session || !isSessionUsable(session, now)) {
    if (session) await store.deleteSession(tokenHash).catch(() => undefined);
    return { ok: true, value: null };
  }
  const user = await store.findUserById(session.userId);
  if (!user) {
    await store.deleteSession(tokenHash).catch(() => undefined);
    return { ok: true, value: null };
  }

  const absoluteLimit = isSessionBeyondAbsoluteLimit(session, now);
  const rotate =
    (shouldRotateSession(session, now) && options.allowRotation !== false) || absoluteLimit;
  let liveToken = trimmed;
  let rotated = false;

  if (rotate && !absoluteLimit) {
    const fresh = await issueSession(store, user, { ip: session.ip, userAgent: session.userAgent }, now);
    await store.updateSession(tokenHash, { revokedAt: now.toISOString() });
    liveToken = fresh.token;
    rotated = true;
    return {
      ok: true,
      value: {
        user: publicUser(user),
        session: {
          id: fresh.session.id,
          userId: user.id,
          createdAt: fresh.session.createdAt,
          expiresAt: fresh.session.expiresAt,
          rotated: true,
        },
        token: liveToken,
      },
    };
  }

  // Sliding expiry: extend only when it is worth a write (>1 day consumed) and
  // never beyond the absolute ceiling.
  if (!absoluteLimit) {
    const remaining = Date.parse(session.expiresAt) - now.getTime();
    if (remaining < (SESSION_TTL_SECONDS - 60 * 60) * 1000) {
      const expiresAt = sessionExpiryFrom(now);
      await store.updateSession(tokenHash, { expiresAt }).catch(() => undefined);
      session.expiresAt = expiresAt;
    }
  }

  return {
    ok: true,
    value: {
      user: publicUser(user),
      session: {
        id: session.id,
        userId: user.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        rotated,
      },
      token: liveToken,
    },
  };
}

/** Explicit refresh: always mint a new token and retire the presented one. */
export async function rotateSession(
  store: AuthStore,
  token: string,
  now: Date = new Date(),
): Promise<AuthOutcome<SessionResult | null>> {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  const tokenHash = hashSessionToken(trimmed);
  const session = await store.findSession(tokenHash);
  if (!session || !isSessionUsable(session, now) || isSessionBeyondAbsoluteLimit(session, now)) {
    if (session) await store.deleteSession(tokenHash).catch(() => undefined);
    return { ok: true, value: null };
  }
  const user = await store.findUserById(session.userId);
  if (!user) {
    await store.deleteSession(tokenHash).catch(() => undefined);
    return { ok: true, value: null };
  }
  const fresh = await issueSession(store, user, { ip: session.ip, userAgent: session.userAgent }, now);
  await store.updateSession(tokenHash, { revokedAt: now.toISOString() });
  return {
    ok: true,
    value: {
      user: publicUser(user),
      session: {
        id: fresh.session.id,
        userId: user.id,
        createdAt: fresh.session.createdAt,
        expiresAt: fresh.session.expiresAt,
        rotated: true,
      },
      token: fresh.token,
    },
  };
}

/**
 * End a session for real: the row is deleted, so replaying the captured cookie
 * gets nothing back. Idempotent — signing out twice is not an error.
 */
export async function signOutSession(store: AuthStore, token: string): Promise<void> {
  const trimmed = String(token ?? "").trim();
  if (!trimmed) return;
  await store.deleteSession(hashSessionToken(trimmed));
}

/** Revoke every session of one account (password change, suspension). */
export async function revokeUserSessions(store: AuthStore, userId: string): Promise<number> {
  return store.deleteUserSessions(userId);
}

// ── Gate identity (preview "Sign in with Grok") ──────────────────────────────

/** A verified identity asserted by an external provider (Google, the platform gate). */
export type ExternalIdentityInput = AuthRequestContext & {
  /** `google` or `grok-gate` — decides the account-id namespace. */
  providerId: string;
  /** The provider's stable subject claim. */
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
  image?: string | null;
};

export type GateIdentityInput = AuthRequestContext & {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
};

/**
 * Materialize a session for a VERIFIED external identity.
 *
 * The caller must have verified the provider's token/profile itself; this
 * function trusts nothing else. Accounts are keyed deterministically from
 * (provider, subject), so the same identity always lands in the same account
 * and never accumulates duplicates. When the address already belongs to an
 * account created with a password, that account is used instead of creating a
 * second one for the same person — identity is the account, the provider is
 * only one way to prove it.
 */
export async function signInWithExternalIdentity(
  store: AuthStore,
  identity: ExternalIdentityInput,
  now: Date = new Date(),
): Promise<AuthOutcome<SessionResult>> {
  const subject = String(identity.subject ?? "").trim();
  if (!subject) return fail("INVALID_USER", 400, "تعذّر تحديد هوية المستخدم.");
  const email = normalizeEmail(identity.email);
  if (!isValidEmail(email)) return fail("INVALID_EMAIL", 400, "صيغة البريد الإلكتروني غير صحيحة.");
  const prefix = identity.providerId === "google" ? "google" : "gate";
  const id = `${prefix}_${hashSessionToken(`${identity.providerId}:${subject}`).slice(0, 32)}`;
  const name = identity.name?.trim() || null;
  const image = identity.image?.trim() || null;

  let user = await store.findUserById(id);
  if (!user) {
    try {
      user = await store.createUser({
        id,
        email,
        name,
        emailVerified: identity.emailVerified === true,
        image,
        passwordHash: null,
      });
    } catch (error) {
      if (!(error instanceof DuplicateEmailError)) throw error;
      // The address already belongs to an account (typically a password one):
      // sign into THAT account instead of creating a second one.
      const existing = await store.findUserByEmail(email);
      if (!existing) throw error;
      user = existing;
    }
  }

  const patch: Record<string, unknown> = {};
  if (name && user.name !== name) patch.name = name;
  if (image && user.image !== image) patch.image = image;
  if (identity.emailVerified === true && !user.emailVerified) patch.emailVerified = true;
  if (Object.keys(patch).length) user = (await store.updateUser(user.id, patch)) ?? user;

  await mirrorUserToDatabase(user);

  const { token, session } = await issueSession(store, user, identity, now);
  return {
    ok: true,
    value: {
      user: publicUser(user),
      session: {
        id: session.id,
        userId: session.userId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        rotated: false,
      },
      token,
    },
  };
}

/**
 * Materialize a session for a VERIFIED platform identity.
 *
 * The caller must have verified a signed token from the platform gate
 * (`gate-identity.server.ts`); this function trusts nothing else. Accounts are
 * keyed deterministically from the subject, so the same platform identity always
 * lands in the same account and never accumulates duplicates.
 */
export async function signInWithGateIdentity(
  store: AuthStore,
  identity: GateIdentityInput,
  now: Date = new Date(),
): Promise<AuthOutcome<SessionResult>> {
  // The gate is a provider like any other: one account per platform identity,
  // and the same `gate_` id namespace the previous implementation used, so
  // accounts created before this rewrite keep resolving.
  return signInWithExternalIdentity(
    store,
    {
      providerId: "grok-gate",
      subject: identity.subject,
      email: identity.email,
      emailVerified: identity.emailVerified === true,
      name: identity.name,
      image: null,
      ip: identity.ip,
      userAgent: identity.userAgent,
    },
    now,
  );
}

/** Translate an unexpected storage failure into the one operator-facing code. */
export function storeFailure(error: unknown): AuthOutcome<never> {
  if (error instanceof AuthStoreUnavailableError) {
    return fail(
      "AUTH_STORE_UNAVAILABLE",
      503,
      "خدمة الحسابات غير متاحة مؤقتًا. أعِد المحاولة بعد قليل.",
    );
  }
  return fail("AUTH_INTERNAL_ERROR", 500, "خطأ غير متوقع في خدمة المصادقة.");
}
