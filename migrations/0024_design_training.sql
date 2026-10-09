-- Account-isolated reference designs used by the Personal Design Twin training center.
create table if not exists design_training_references (
  id text primary key,
  user_id text not null,
  file_name text not null,
  content_type text not null,
  asset_id text,
  analysis jsonb not null default '{}'::jsonb,
  likes text not null default '',
  dislikes text not null default '',
  scope text not null default 'global',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_design_training_references_owner
  on design_training_references (user_id, created_at desc);
