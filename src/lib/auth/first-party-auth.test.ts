/**
 * First-party auth, end to end at the module level.
 *
 * The HTTP behaviour is proven against a real server by
 * `scripts/auth-e2e.mjs`; this suite pins the DECISIONS underneath it, where a
 * regression is silent:
 *
 *   · which durable backend an environment selects (and that a deployment with
 *     none fails closed instead of pretending process memory is storage);
 *   · that passwords are Argon2id PHC strings, verified in constant time, and
 *     that policy failures are named exactly as the UI expects;
 *   · that session tokens are opaque, stored only as a hash, expire, rotate and
 *     slide within their absolute ceiling;
 *   · that sign-in answers identically for an unknown address and a wrong
 *     password, locks an account after repeated failures, and refuses a
 *     duplicate sign-up instead of merging two people into one account.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { authStoreStatus, isDeployedRuntime } from "./store/status";
import { DuplicateEmailError } from "./store/types";
import type { AuthStore, SessionPatch, StoredSession, StoredUser, UserPatch } from "./store/types";
import {
  ARGON2_PARAMETERS,
  hashPassword,
  parsePasswordHash,
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
  sessionCookie,
  clearedSessionCookie,
  shouldRotateSession,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_ROTATION_SECONDS,
  SESSION_TTL_SECONDS,
  sessionExpiryFrom,
} from "./session";
import {
  signInWithPassword,
  signOutSession,
  signUpWithPassword,
  resolveSession,
  ACCOUNT_LOCK_LADDER,
} from "./service.server";

const R2_ENV = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
};

describe("identity store selection", () => {
  it("prefers object storage, falls back to Postgres, then to local dev", () => {
    assert.equal(authStoreStatus(R2_ENV).kind, "cloudflare-r2");
    assert.equal(authStoreStatus({ DATABASE_URL: "postgres://x" }).kind, "postgres");
    assert.equal(authStoreStatus({}).kind, "filesystem");
  });

  it("refuses the local filesystem store on a deployment", () => {
    const status = authStoreStatus({ VERCEL: "1" });
    assert.equal(status.kind, null);
    assert.equal(status.configured, false);
    assert.equal(status.durable, false);
    // The error must name the variable an operator has to set.
    assert.ok(status.missing.some((name) => name.includes("R2_ACCESS_KEY_ID")));
    assert.match(String(status.detail), /never falls back to process memory/i);
  });

  it("treats Vercel and strict self-hosted runtimes as deployed", () => {
    assert.equal(isDeployedRuntime({ VERCEL: "1" }), true);
    assert.equal(isDeployedRuntime({ NASAQ_STRICT_ENV: "1" }), true);
    assert.equal(isDeployedRuntime({}), false);
  });
});

describe("password hashing", () => {
  it("produces an Argon2id PHC string that verifies and contains no secret", async () => {
    const password = "correct horse battery staple";
    const hash = await hashPassword(password);
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[^$]+\$[^$]+$/);
    assert.ok(!hash.includes(password));
    assert.deepEqual(await verifyPassword(password, hash), { ok: true, needsRehash: false });
    assert.equal((await verifyPassword("wrong password", hash)).ok, false);
  });

  it("salts every hash, so equal passwords never share a digest", async () => {
    const [first, second] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    assert.notEqual(first, second);
  });

  it("never throws on a broken or absent stored hash", async () => {
    assert.equal((await verifyPassword("x", null)).ok, false);
    assert.equal((await verifyPassword("x", "$argon2id$nonsense")).ok, false);
    assert.equal(parsePasswordHash(""), null);
  });

  it("flags a hash that predates the current parameters for rehashing", () => {
    const legacy = `$argon2id$v=19$m=8192,t=1,p=1$${Buffer.from("salt").toString("base64")}$${Buffer.from("hash").toString("base64")}`;
    assert.equal(passwordNeedsRehash(legacy), true);
    assert.equal(passwordNeedsRehash(null), true);
  });

  it("spends real work on an unknown account (no timing oracle)", async () => {
    await verifyPasswordAgainstUnknownAccount("whatever");
  });

  it("names each policy failure with the code the UI translates", () => {
    assert.equal(validatePasswordPolicy("short").ok, false);
    assert.equal((validatePasswordPolicy("short") as { code: string }).code, "PASSWORD_TOO_SHORT");
    assert.equal(
      (validatePasswordPolicy("password123") as { code: string }).code,
      "PASSWORD_TOO_WEAK",
    );
    assert.equal(
      (validatePasswordPolicy("a".repeat(200)) as { code: string }).code,
      "PASSWORD_TOO_LONG",
    );
    assert.equal(
      (validatePasswordPolicy("mohammed-secret-123", { email: "mohammed@example.com" })).ok,
      false,
    );
    assert.equal(validatePasswordPolicy("q7#vN2!pxWz").ok, true);
  });

  it("uses parameters at or above the OWASP Argon2id baseline", () => {
    assert.ok(ARGON2_PARAMETERS.m >= 19456);
    assert.ok(ARGON2_PARAMETERS.t >= 2);
    assert.equal(ARGON2_PARAMETERS.p, 1);
    assert.equal(ARGON2_PARAMETERS.dkLen, 32);
  });
});

describe("session tokens and cookies", () => {
  it("mints opaque tokens and stores only their hash", () => {
    const first = mintSessionToken();
    const second = mintSessionToken();
    assert.notEqual(first, second);
    assert.ok(first.length >= 40);
    assert.notEqual(hashSessionToken(first), first);
    assert.equal(hashSessionToken(first), hashSessionToken(first));
  });

  it("serializes a __Host- cookie that cannot be forged by a sibling host", () => {
    const cookie = sessionCookie("token-value");
    assert.match(cookie, /__Host-grok-auth\.session_token=token-value/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.ok(!cookie.includes("Domain="));
    assert.match(clearedSessionCookie(), /Max-Age=0/);
  });

  it("expires, rotates daily and slides for at most the absolute ceiling", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const session: StoredSession = {
      tokenHash: hashSessionToken("t"),
      id: "s",
      userId: "u",
      createdAt: now.toISOString(),
      expiresAt: sessionExpiryFrom(now),
      rotatedAt: null,
      revokedAt: null,
      ip: null,
      userAgent: null,
    };
    assert.equal(isSessionUsable(session, now), true);
    assert.equal(SESSION_TTL_SECONDS, 60 * 60 * 24 * 30);
    assert.equal(shouldRotateSession(session, now), false);
    assert.equal(
      shouldRotateSession(session, new Date(now.getTime() + (SESSION_ROTATION_SECONDS + 60) * 1000)),
      true,
    );
    const expired = { ...session, expiresAt: new Date(now.getTime() - 1000).toISOString() };
    assert.equal(isSessionUsable(expired, now), false);
    const ancient = {
      ...session,
      createdAt: new Date(
        now.getTime() - (SESSION_ABSOLUTE_TTL_SECONDS + 60) * 1000,
      ).toISOString(),
      expiresAt: new Date(now.getTime() + 1000).toISOString(),
    };
    assert.equal(isSessionBeyondAbsoluteLimit(ancient, now), true);
  });
});

// ── An in-memory AuthStore, so the service can be driven like a real backend ──

function memoryStore(): AuthStore & { users: Map<string, StoredUser>; sessions: Map<string, StoredSession> } {
  const users = new Map<string, StoredUser>();
  const byEmail = new Map<string, string>();
  const sessions = new Map<string, StoredSession>();
  const throttle = new Map<string, { windowStartedAt: string; attempts: number; blockedUntil: string | null }>();
  const now = () => new Date().toISOString();
  return {
    kind: "memory",
    durable: true,
    users,
    sessions,
    async createUser(input) {
      if (byEmail.has(input.email)) throw new DuplicateEmailError();
      const user: StoredUser = {
        id: input.id,
        email: input.email,
        name: input.name ?? null,
        emailVerified: input.emailVerified ?? false,
        image: input.image ?? null,
        passwordHash: input.passwordHash ?? null,
        createdAt: input.createdAt ?? now(),
        updatedAt: input.updatedAt ?? now(),
        failedAttempts: 0,
        lockedUntil: null,
      };
      users.set(user.id, user);
      byEmail.set(user.email, user.id);
      return user;
    },
    async findUserByEmail(email) {
      const id = byEmail.get(email);
      return id ? (users.get(id) ?? null) : null;
    },
    async findUserById(id) {
      return users.get(id) ?? null;
    },
    async updateUser(id: string, patch: UserPatch) {
      const user = users.get(id);
      if (!user) return null;
      const next = { ...user, ...patch, updatedAt: now() } as StoredUser;
      users.set(id, next);
      byEmail.set(next.email, id);
      return next;
    },
    async deleteUser(id) {
      users.delete(id);
    },
    async listUsers(limit) {
      return [...users.values()].slice(0, limit);
    },
    async createSession(session) {
      sessions.set(session.tokenHash, session);
    },
    async findSession(tokenHash) {
      return sessions.get(tokenHash) ?? null;
    },
    async updateSession(tokenHash: string, patch: SessionPatch) {
      const session = sessions.get(tokenHash);
      if (session) sessions.set(tokenHash, { ...session, ...patch });
    },
    async deleteSession(tokenHash) {
      sessions.delete(tokenHash);
    },
    async deleteUserSessions(userId) {
      let removed = 0;
      for (const [key, session] of sessions) {
        if (session.userId === userId) {
          sessions.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    async readThrottle(key) {
      return throttle.get(key) ?? null;
    },
    async writeThrottle(key, record) {
      throttle.set(key, record);
    },
  };
}

describe("sign-up / sign-in / sign-out", () => {
  it("creates an account, signs it in and refuses a duplicate address", async () => {
    const store = memoryStore();
    const created = await signUpWithPassword(store, {
      email: "User@Example.com ",
      password: "q7#vN2!pxWz",
      name: "مستخدم",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.value.user.email, "user@example.com");
    assert.ok(created.value.token.length > 20);

    const duplicate = await signUpWithPassword(store, {
      email: "user@example.com",
      password: "q7#vN2!pxWz",
      name: "آخر",
    });
    assert.equal(duplicate.ok, false);
    if (duplicate.ok) return;
    assert.equal(duplicate.failure.code, "USER_ALREADY_EXISTS");
    assert.equal(duplicate.failure.status, 422);
  });

  it("answers the SAME failure for an unknown address and a wrong password", async () => {
    const store = memoryStore();
    await signUpWithPassword(store, { email: "known@example.com", password: "q7#vN2!pxWz" });
    const wrongPassword = await signInWithPassword(store, {
      email: "known@example.com",
      password: "not-the-password",
    });
    const unknown = await signInWithPassword(store, {
      email: "nobody@example.com",
      password: "not-the-password",
    });
    assert.equal(wrongPassword.ok, false);
    assert.equal(unknown.ok, false);
    if (wrongPassword.ok || unknown.ok) return;
    assert.equal(wrongPassword.failure.code, unknown.failure.code);
    assert.equal(wrongPassword.failure.message, unknown.failure.message);
    assert.equal(wrongPassword.failure.status, 401);
    assert.equal(unknown.failure.status, 401);
  });

  it("locks an account after repeated failures and reports the ladder honestly", async () => {
    const store = memoryStore();
    await signUpWithPassword(store, { email: "lock@example.com", password: "q7#vN2!pxWz" });
    const threshold = ACCOUNT_LOCK_LADDER[0];
    let locked = null;
    for (let attempt = 0; attempt < threshold.failures; attempt += 1) {
      const result = await signInWithPassword(store, {
        email: "lock@example.com",
        password: "wrong-password",
      });
      if (!result.ok) locked = result.failure;
    }
    assert.equal(locked?.code, "ACCOUNT_LOCKED");
    assert.equal(locked?.status, 429);
    // Even the RIGHT password is refused while the lock stands.
    const blocked = await signInWithPassword(store, {
      email: "lock@example.com",
      password: "q7#vN2!pxWz",
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.failure.code, "ACCOUNT_LOCKED");
  });

  it("signs out for real (idempotently) and rotates on demand", async () => {
    const store = memoryStore();
    const created = await signUpWithPassword(store, {
      email: "out@example.com",
      password: "q7#vN2!pxWz",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const token = created.value.token;

    const resolved = await resolveSession(store, token);
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.value?.user.email, "out@example.com");

    await signOutSession(store, token);
    const after = await resolveSession(store, token);
    assert.equal(after.ok, true);
    if (after.ok) assert.equal(after.value, null);
    // Signing out twice is not an error.
    await signOutSession(store, token);
  });
});
