-- NASAQ License Management System
-- Stores license keys (as SHA-256 hashes), types, statuses, and entitlements.
-- Applied automatically by PGLite (dev) and during Vercel build (production).

create table if not exists licenses (
  id              text primary key,
  key_hash        text not null unique,       -- SHA-256 hex of the license key
  key_prefix      text not null,              -- first 19 chars for admin display (e.g. "NASAQ-PRO-XXXX")
  type            text not null check (type in ('FREE','TRIAL','PRO','LIFETIME')),
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','EXPIRED','REVOKED')),
  user_id         text,                       -- optional Better Auth user id
  activated_at    timestamptz,
  expires_at      timestamptz,                -- null for LIFETIME / FREE
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  activation_count integer not null default 0,
  max_activations integer,                    -- null = unlimited
  metadata        jsonb                       -- extensible (payment info, notes, etc.)
);

create index if not exists idx_licenses_key_hash on licenses (key_hash);
create index if not exists idx_licenses_user_id  on licenses (user_id);
create index if not exists idx_licenses_status   on licenses (status);
create index if not exists idx_licenses_type     on licenses (type);
