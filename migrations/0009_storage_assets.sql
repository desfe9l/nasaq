-- Editor asset metadata. The bytes live in object storage (Cloudflare R2 by
-- configuration); this table holds only the object key plus what the library
-- needs to render a row, so switching provider never touches the schema.
-- Rows are owner-scoped: every read and delete is filtered by user_id.
create table if not exists storage_assets (
  id text primary key,
  user_id text not null,
  kind text not null,
  object_key text not null unique,
  file_name text not null,
  content_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  project_id text,
  created_at timestamptz not null default now()
);

create index if not exists storage_assets_user_idx
  on storage_assets (user_id, created_at desc);
create index if not exists storage_assets_project_idx
  on storage_assets (user_id, project_id);

-- Project ownership registry.
--
-- NASAQ projects live in the browser (IndexedDB), so the server has no project
-- table to authorize against. First claim wins: the first signed-in user to
-- store an asset under a project id owns that id permanently, and every later
-- upload/read/delete for it must come from the same user. Without this, two
-- accounts that happen to generate the same project id would share a storage
-- prefix.
create table if not exists storage_projects (
  project_id text primary key,
  user_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists storage_projects_user_idx
  on storage_projects (user_id);
