-- Per-account library catalog. Bytes stay in storage_assets / object storage.
-- This row is metadata only (folders, asset placement, custom vectors) and is
-- always read and written with the session user id.
create table if not exists library_catalog (
  user_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
