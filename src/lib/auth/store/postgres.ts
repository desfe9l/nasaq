/**
 * AuthStore over Postgres — the OPTIONAL backend.
 *
 * Authentication does not need a database to work: the deployment's durable
 * backend is the object store (`./r2.ts`). This adapter exists so the SAME
 * identity contract can be served by a Postgres the project may already have
 * (Neon, Vercel Postgres, a self-hosted instance, or PGLite in development),
 * and so the storage backend can be switched later without rewriting a line of
 * authentication — which is exactly what the `AuthStore` interface is for.
 *
 * It never touches the application's own tables. Identity lives in three
 * dedicated, namespaced tables created by `migrations/0021_first_party_auth.sql`:
 *
 *   auth_users     one row per account (Argon2id PHC string, never a password)
 *   auth_sessions  sessions keyed by sha256 of the opaque token
 *   auth_throttle  brute-force counters and lockouts
 *
 * A unique index on `email_normalized` is what makes a duplicate sign-up fail —
 * the database decides, not a read-then-write check — and every statement is
 * parameterized.
 */
import type { Sql } from "@/lib/db";
import {
  DuplicateEmailError,
  type AuthStore,
  type NewStoredUser,
  type SessionPatch,
  type StoredSession,
  type StoredUser,
  type ThrottleRecord,
  type UserPatch,
} from "./types";
import { normalizeEmail } from "./r2";

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

function rowToUser(row: Row): StoredUser {
  return {
    id: String(row.id),
    email: normalizeEmail(String(row.email ?? "")),
    name: row.name == null ? null : String(row.name),
    emailVerified: row.email_verified === true,
    image: row.image == null ? null : String(row.image),
    passwordHash: row.password_hash == null ? null : String(row.password_hash),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    failedAttempts: Number(row.failed_attempts ?? 0) || 0,
    lockedUntil: isoOrNull(row.locked_until),
  };
}

function rowToSession(row: Row): StoredSession {
  return {
    tokenHash: String(row.token_hash),
    id: String(row.id),
    userId: String(row.user_id),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    rotatedAt: isoOrNull(row.rotated_at),
    revokedAt: isoOrNull(row.revoked_at),
    ip: row.ip == null ? null : String(row.ip),
    userAgent: row.user_agent == null ? null : String(row.user_agent),
  };
}

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return String((error as { code?: unknown })?.code ?? "") === UNIQUE_VIOLATION;
}

/**
 * Build the Postgres-backed store.
 *
 * `resolveSql` is injected (rather than importing `@/lib/db` at module load) so
 * the connection pool is only created on the first real identity operation —
 * importing this module must never open a connection.
 */
export function createPostgresAuthStore(resolveSql: () => Promise<Sql>): AuthStore {
  const sql = () => resolveSql();

  return {
    kind: "postgres",
    durable: true,

    async createUser(input: NewStoredUser) {
      const db = await sql();
      const now = new Date().toISOString();
      try {
        const rows = await db<Row>`
          insert into auth_users (
            id, email, email_normalized, name, email_verified, image,
            password_hash, created_at, updated_at, failed_attempts, locked_until
          ) values (
            ${input.id}, ${input.email}, ${normalizeEmail(input.email)},
            ${input.name ?? null}, ${input.emailVerified === true}, ${input.image ?? null},
            ${input.passwordHash ?? null}, ${input.createdAt ?? now}, ${input.updatedAt ?? now},
            ${input.failedAttempts ?? 0}, ${input.lockedUntil ?? null}
          )
          returning *
        `;
        return rowToUser(rows[0]);
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateEmailError();
        throw error;
      }
    },

    async findUserByEmail(email) {
      const db = await sql();
      const rows = await db<Row>`
        select * from auth_users where email_normalized = ${normalizeEmail(email)} limit 1
      `;
      return rows[0] ? rowToUser(rows[0]) : null;
    },

    async findUserById(id) {
      const db = await sql();
      const rows = await db<Row>`select * from auth_users where id = ${id} limit 1`;
      return rows[0] ? rowToUser(rows[0]) : null;
    },

    async updateUser(id, patch: UserPatch) {
      const db = await sql();
      const sets: string[] = ["updated_at = now()"];
      const values: unknown[] = [];
      const push = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      if (patch.email !== undefined) {
        push("email", normalizeEmail(patch.email));
        push("email_normalized", normalizeEmail(patch.email));
      }
      if (patch.name !== undefined) push("name", patch.name);
      if (patch.emailVerified !== undefined) push("email_verified", patch.emailVerified);
      if (patch.image !== undefined) push("image", patch.image);
      if (patch.passwordHash !== undefined) push("password_hash", patch.passwordHash);
      if (patch.failedAttempts !== undefined) push("failed_attempts", patch.failedAttempts);
      if (patch.lockedUntil !== undefined) push("locked_until", patch.lockedUntil);
      values.push(id);
      try {
        const rows = await db.query<Row>(
          `update auth_users set ${sets.join(", ")} where id = $${values.length} returning *`,
          values,
        );
        return rows[0] ? rowToUser(rows[0]) : null;
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateEmailError();
        throw error;
      }
    },

    async deleteUser(id) {
      const db = await sql();
      await db`delete from auth_sessions where user_id = ${id}`;
      await db`delete from auth_users where id = ${id}`;
    },

    async listUsers(limit) {
      const db = await sql();
      const rows = await db<Row>`
        select * from auth_users order by created_at desc limit ${Math.max(1, Math.trunc(limit))}
      `;
      return rows.map(rowToUser);
    },

    async createSession(session) {
      const db = await sql();
      await db`
        insert into auth_sessions (
          token_hash, id, user_id, created_at, expires_at, rotated_at, revoked_at, ip, user_agent
        ) values (
          ${session.tokenHash}, ${session.id}, ${session.userId}, ${session.createdAt},
          ${session.expiresAt}, ${session.rotatedAt}, ${session.revokedAt}, ${session.ip}, ${session.userAgent}
        )
      `;
    },

    async findSession(tokenHash) {
      const db = await sql();
      const rows = await db<Row>`
        select * from auth_sessions where token_hash = ${tokenHash} limit 1
      `;
      return rows[0] ? rowToSession(rows[0]) : null;
    },

    async updateSession(tokenHash, patch: SessionPatch) {
      const db = await sql();
      const sets: string[] = [];
      const values: unknown[] = [];
      const push = (column: string, value: unknown) => {
        values.push(value);
        sets.push(`${column} = $${values.length}`);
      };
      if (patch.expiresAt !== undefined) push("expires_at", patch.expiresAt);
      if (patch.rotatedAt !== undefined) push("rotated_at", patch.rotatedAt);
      if (patch.revokedAt !== undefined) push("revoked_at", patch.revokedAt);
      if (patch.ip !== undefined) push("ip", patch.ip);
      if (patch.userAgent !== undefined) push("user_agent", patch.userAgent);
      if (!sets.length) return;
      values.push(tokenHash);
      await db.query(
        `update auth_sessions set ${sets.join(", ")} where token_hash = $${values.length}`,
        values,
      );
    },

    async deleteSession(tokenHash) {
      const db = await sql();
      await db`delete from auth_sessions where token_hash = ${tokenHash}`;
    },

    async deleteUserSessions(userId) {
      const db = await sql();
      const rows = await db<{ count: number }>`
        with removed as (delete from auth_sessions where user_id = ${userId} returning 1)
        select count(*)::int as count from removed
      `;
      return Number(rows[0]?.count ?? 0);
    },

    async readThrottle(key) {
      const db = await sql();
      const rows = await db<Row>`
        select window_started_at, attempts, blocked_until
        from auth_throttle where throttle_key = ${key} limit 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        windowStartedAt: iso(row.window_started_at),
        attempts: Number(row.attempts ?? 0) || 0,
        blockedUntil: isoOrNull(row.blocked_until),
      };
    },

    async writeThrottle(key, record: ThrottleRecord) {
      const db = await sql();
      await db`
        insert into auth_throttle (throttle_key, window_started_at, attempts, blocked_until)
        values (${key}, ${record.windowStartedAt}, ${record.attempts}, ${record.blockedUntil})
        on conflict (throttle_key) do update set
          window_started_at = excluded.window_started_at,
          attempts = excluded.attempts,
          blocked_until = excluded.blocked_until
      `;
    },
  };
}
