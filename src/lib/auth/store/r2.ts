/**
 * AuthStore over the deployment's own private object storage (Cloudflare R2,
 * S3-compatible) — the durable backend first-party authentication ships with.
 *
 * WHY OBJECT STORAGE AND NOT THE DATABASE: a session must survive a request on
 * any serverless instance, and login must keep working when the application
 * database (Postgres) is over quota, suspended or being migrated. The
 * bucket is already the app's private durable store for editor assets; identity
 * simply gets its own namespace inside it.
 *
 * KEY LAYOUT — `_nasaq-auth/v1/…`, a namespace disjoint from the asset layout
 * (`users/<id>/projects/...`), so no asset key can collide with identity state
 * and the two can be lifecycle-managed separately:
 *
 *   users/<id>.json               the account row (Argon2id hash, never a password)
 *   emails/<sha256(email)>.json   the unique address index ({ userId })
 *   sessions/<sha256(token)>.json the session row (the token itself is never stored)
 *   throttle/<sha256(key)>.json   brute-force counters
 *
 * Addresses are hashed into the key so an operator listing the bucket cannot
 * enumerate user emails, and a session token never appears in a key name.
 *
 * UNIQUENESS UNDER CONCURRENCY: two simultaneous sign-ups with one address are
 * decided by the bucket, not by a read-then-write race — the email index is
 * claimed with a create-only write (`If-None-Match: *`). When a provider cannot
 * express that, the store falls back to claim → re-read → roll back, which still
 * leaves at most ONE account reachable by that address (the index is the only
 * way in, and login resolves through it).
 */
import { createHash } from "node:crypto";
import type { ObjectStorageProvider } from "@/lib/storage/provider";
import {
  AuthStoreUnavailableError,
  DuplicateEmailError,
  type AuthStore,
  type NewStoredUser,
  type SessionPatch,
  type StoredSession,
  type StoredUser,
  type ThrottleRecord,
  type UserPatch,
} from "./types";

/** Root namespace. Never overlaps the editor's asset keys. */
export const AUTH_OBJECT_PREFIX = "_nasaq-auth/v1";

const USERS_PREFIX = `${AUTH_OBJECT_PREFIX}/users/`;
const EMAILS_PREFIX = `${AUTH_OBJECT_PREFIX}/emails/`;
const SESSIONS_PREFIX = `${AUTH_OBJECT_PREFIX}/sessions/`;
const THROTTLE_PREFIX = `${AUTH_OBJECT_PREFIX}/throttle/`;

/** SHA-256 hex of a value, as used for every hashed key segment. */
export function authKeyHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const userKey = (id: string) => `${USERS_PREFIX}${id}.json`;
const emailKey = (email: string) =>
  `${EMAILS_PREFIX}${authKeyHash(normalizeEmail(email))}.json`;
const sessionKey = (tokenHash: string) => `${SESSIONS_PREFIX}${tokenHash}.json`;
const throttleKey = (key: string) => `${THROTTLE_PREFIX}${authKeyHash(key)}.json`;

/** Addresses are compared lower-cased; the local part is never rewritten. */
export function normalizeEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readJson<T>(
  provider: ObjectStorageProvider,
  key: string,
): Promise<T | null> {
  const bytes = await provider.get(key);
  if (!bytes) return null;
  try {
    return JSON.parse(decoder.decode(bytes)) as T;
  } catch {
    throw new AuthStoreUnavailableError(
      "auth storage returned an unreadable record — refusing to guess",
    );
  }
}

function rowToUser(row: Record<string, unknown>): StoredUser {
  return {
    id: String(row.id),
    email: normalizeEmail(String(row.email ?? "")),
    name: row.name == null ? null : String(row.name),
    emailVerified: row.emailVerified === true,
    image: row.image == null ? null : String(row.image),
    passwordHash: row.passwordHash == null ? null : String(row.passwordHash),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    failedAttempts: Number(row.failedAttempts ?? 0) || 0,
    lockedUntil: row.lockedUntil == null ? null : String(row.lockedUntil),
  };
}

function rowToSession(row: Record<string, unknown>): StoredSession {
  return {
    tokenHash: String(row.tokenHash),
    id: String(row.id),
    userId: String(row.userId),
    createdAt: String(row.createdAt),
    expiresAt: String(row.expiresAt),
    rotatedAt: row.rotatedAt == null ? null : String(row.rotatedAt),
    revokedAt: row.revokedAt == null ? null : String(row.revokedAt),
    ip: row.ip == null ? null : String(row.ip),
    userAgent: row.userAgent == null ? null : String(row.userAgent),
  };
}

/**
 * Build the R2-backed store.
 *
 * `provider` is the app's existing object-storage provider (`getObjectStorage()`),
 * or any object implementing the same operations — which is what the unit tests
 * substitute for a fake bucket.
 */
export function createR2AuthStore(provider: ObjectStorageProvider): AuthStore {
  const put = async (key: string, value: unknown): Promise<void> => {
    await provider.put(key, encoder.encode(JSON.stringify(value)), "application/json");
  };

  const readUser = async (id: string): Promise<StoredUser | null> => {
    const row = await readJson<Record<string, unknown>>(provider, userKey(id));
    return row ? rowToUser(row) : null;
  };

  const cascadeDelete = async (userId: string, email: string): Promise<void> => {
    await deleteUserSessions(userId);
    await provider.delete(userKey(userId));
    await releaseEmail(email, userId);
  };

  /**
   * Claim the unique address index for `userId`.
   *
   * Returns normally when this caller owns the address, throws
   * `DuplicateEmailError` when another account already does.
   */
  const claimEmail = async (email: string, userId: string): Promise<void> => {
    const key = emailKey(email);
    const payload = encoder.encode(JSON.stringify({ userId }));
    if (typeof provider.putIfAbsent === "function") {
      let created: boolean;
      try {
        created = await provider.putIfAbsent(key, payload, "application/json");
      } catch (error) {
        // A provider without conditional-write support throws; a provider that
        // is merely unreachable must NOT be papered over by the fallback.
        const status = (error as { status?: number })?.status;
        if (status !== 400 && status !== 501) throw error;
        created = await claimEmailWithoutConditionalWrite(key, userId);
      }
      if (!created) throw new DuplicateEmailError();
      return;
    }
    const created = await claimEmailWithoutConditionalWrite(key, userId);
    if (!created) throw new DuplicateEmailError();
  };

  /**
   * Claim → confirm → roll back. Strong read-after-write on the same key means
   * the loser of a race observes the winner here and aborts before a session is
   * ever issued; the address index can only ever name one account, so the other
   * row is unreachable by sign-in.
   */
  const claimEmailWithoutConditionalWrite = async (
    key: string,
    userId: string,
  ): Promise<boolean> => {
    const existing = await readJson<{ userId?: string }>(provider, key);
    if (existing?.userId && existing.userId !== userId) return false;
    await put(key, { userId });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const settled = await readJson<{ userId?: string }>(provider, key);
    return !settled?.userId || settled.userId === userId;
  };

  /** Release an index entry, but only when it still points at `userId`. */
  const releaseEmail = async (email: string, userId: string): Promise<void> => {
    const key = emailKey(email);
    const existing = await readJson<{ userId?: string }>(provider, key);
    if (existing?.userId !== userId) return;
    await provider.delete(key);
  };

  const deleteUserSessions = async (userId: string): Promise<number> => {
    if (typeof provider.list !== "function") {
      throw new AuthStoreUnavailableError(
        "auth storage cannot enumerate sessions (provider has no list operation)",
      );
    }
    const keys = await provider.list(SESSIONS_PREFIX, 1000);
    let removed = 0;
    for (const key of keys) {
      const row = await readJson<Record<string, unknown>>(provider, key);
      if (!row || String(row.userId) !== userId) continue;
      await provider.delete(key);
      removed += 1;
    }
    return removed;
  };

  return {
    kind: "cloudflare-r2",
    durable: true,

    async createUser(input: NewStoredUser) {
      const email = normalizeEmail(input.email);
      // Claim the address BEFORE the account row exists: the index is the only
      // way to reach an account, so a failed claim can never leave an orphan.
      await claimEmail(email, input.id);
      const now = new Date().toISOString();
      const user: StoredUser = {
        id: input.id,
        email,
        name: input.name ?? null,
        emailVerified: input.emailVerified === true,
        image: input.image ?? null,
        passwordHash: input.passwordHash ?? null,
        createdAt: input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
        failedAttempts: input.failedAttempts ?? 0,
        lockedUntil: input.lockedUntil ?? null,
      };
      try {
        await put(userKey(user.id), user);
      } catch (error) {
        await releaseEmail(email, user.id).catch(() => undefined);
        throw error;
      }
      return user;
    },

    async findUserByEmail(email) {
      const index = await readJson<{ userId?: string }>(provider, emailKey(email));
      if (!index?.userId) return null;
      return readUser(index.userId);
    },

    async findUserById(id) {
      return readUser(id);
    },

    async updateUser(id, patch: UserPatch) {
      const current = await readUser(id);
      if (!current) return null;
      const next: StoredUser = {
        ...current,
        ...patch,
        email: patch.email ? normalizeEmail(patch.email) : current.email,
        updatedAt: new Date().toISOString(),
      };
      if (next.email !== current.email) {
        await claimEmail(next.email, id);
        await put(userKey(next.id), next);
        await releaseEmail(current.email, id);
        return next;
      }
      await put(userKey(next.id), next);
      return next;
    },

    async deleteUser(id) {
      const current = await readUser(id);
      if (!current) return;
      await cascadeDelete(id, current.email);
    },

    async listUsers(limit) {
      if (typeof provider.list !== "function") {
        throw new AuthStoreUnavailableError(
          "auth storage cannot list accounts (provider has no list operation)",
        );
      }
      const keys = await provider.list(
        USERS_PREFIX,
        Math.max(1, Math.min(Math.trunc(limit), 500)),
      );
      // Bounded parallel reads: one GET per account, read sequentially, made
      // the admin customer list time out once the store held a few hundred.
      const users: StoredUser[] = [];
      for (let index = 0; index < keys.length; index += 25) {
        const rows = await Promise.all(
          keys.slice(index, index + 25).map((key) => readJson<Record<string, unknown>>(provider, key)),
        );
        for (const row of rows) if (row) users.push(rowToUser(row));
      }
      return users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    createSession: (session) => put(sessionKey(session.tokenHash), session),

    async findSession(tokenHash) {
      const row = await readJson<Record<string, unknown>>(provider, sessionKey(tokenHash));
      return row ? rowToSession(row) : null;
    },

    async updateSession(tokenHash, patch: SessionPatch) {
      const current = await readJson<Record<string, unknown>>(
        provider,
        sessionKey(tokenHash),
      );
      if (!current) return;
      await put(sessionKey(tokenHash), { ...rowToSession(current), ...patch });
    },

    deleteSession: (tokenHash) => provider.delete(sessionKey(tokenHash)),

    deleteUserSessions,

    async readThrottle(key) {
      const row = await readJson<Record<string, unknown>>(provider, throttleKey(key));
      if (!row) return null;
      return {
        windowStartedAt: String(row.windowStartedAt),
        attempts: Number(row.attempts ?? 0) || 0,
        blockedUntil: row.blockedUntil == null ? null : String(row.blockedUntil),
      };
    },

    writeThrottle: (key, record: ThrottleRecord) => put(throttleKey(key), record),
  };
}

/**
 * The deployment's R2 store, or null when the R2 variables are absent
 * (`getObjectStorage()` already reports that as null instead of throwing).
 */
export async function r2AuthStoreFromEnv(): Promise<AuthStore | null> {
  const { getObjectStorage } = await import("@/lib/storage/r2.server");
  const provider = getObjectStorage();
  return provider ? createR2AuthStore(provider) : null;
}
