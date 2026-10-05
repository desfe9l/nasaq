-- Offline-first cloud mirror for projects — local IndexedDB remains source of truth.
-- The server copy is best-effort, versioned for conflict detection, and never
-- overwrites newer remote data. Account-isolated via user_id.

create table if not exists cloud_projects (
  id text primary key,
  user_id text not null,
  payload jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_cloud_projects_owner_updated
  on cloud_projects (user_id, updated_at desc);

create index if not exists idx_cloud_projects_user
  on cloud_projects (user_id);
