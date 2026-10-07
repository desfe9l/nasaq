-- First-party identity: accounts, sessions and brute-force counters.
--
-- WHY THIS EXISTS SEPARATELY FROM `"user"` / `"session"` (0001_auth.sql)
-- ---------------------------------------------------------------------
-- Those tables were Better Auth's schema. This app now owns its sign-in flow
-- end to end and keeps identity in the AuthStore (Cloudflare R2 by default, or
-- Postgres through this schema). The names are deliberately namespaced
-- (`auth_*`) so a deployment can run both during a migration window without a
-- collision, and so nothing here is confused with the application tables that
-- merely REFERENCE a user id.
--
-- The three guarantees this schema enforces:
--   1. `auth_users.email_normalized` is UNIQUE — a duplicate sign-up fails as a
--      constraint violation, not as a read-then-write race between two
--      serverless instances.
--   2. `auth_users.password_hash` holds an Argon2id PHC string ($argon2id$…),
--      never a password and never a reversible value.
--   3. `auth_sessions.token_hash` holds sha256(token). The token itself is only
--      ever in the cookie, so a database read cannot mint a session.
--
-- `if not exists` everywhere: this file may be applied by the deploy-time
-- migrator (scripts/migrate.mjs) and, on a database where it was already
-- applied by hand, it must be a no-op.

create table if not exists auth_users (
  id text not null primary key,
  email text not null,
  email_normalized text not null unique,
  name text,
  email_verified boolean not null default false,
  image text,
  password_hash text,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive lookups (the authoritative key is `email_normalized`; this
-- index also serves the legacy `lower(email) = …` lookups elsewhere in the app).
create index if not exists idx_auth_users_email_lower
  on auth_users (lower(email));

create table if not exists auth_sessions (
  token_hash text not null primary key,
  id text not null,
  user_id text not null references auth_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  rotated_at timestamptz,
  revoked_at timestamptz,
  ip text,
  user_agent text
);

-- Revoking every session of one account ("sign out everywhere", password
-- change) and pruning expired rows both walk this index.
create index if not exists idx_auth_sessions_user
  on auth_sessions (user_id);

create index if not exists idx_auth_sessions_expires
  on auth_sessions (expires_at);

-- Brute-force state. One row per throttle key (a login address, an originating
-- IP, or a sign-up IP), holding a fixed window and an optional lockout.
-- Authentication FAILS OPEN when this table is unreachable: a storage outage
-- must not lock every visitor out of their account.
create table if not exists auth_throttle (
  throttle_key text not null primary key,
  window_started_at timestamptz not null,
  attempts integer not null default 0,
  blocked_until timestamptz
);

-- The application database is allowed to be over quota, suspended, or absent —
-- that is the whole point of the default AuthStore living in object storage.
-- When it IS reachable, sign-up mirrors the account into the legacy `"user"`
-- table (see src/lib/auth/user-mirror.server.ts) so licence, payment and admin
-- queries that join on it keep resolving.
create index if not exists idx_auth_throttle_blocked
  on auth_throttle (blocked_until)
  where blocked_until is not null;
