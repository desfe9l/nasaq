-- Per-account design twin memory. Rows are never readable across users.
-- One-off feedback and recurring preferences share this table; the application
-- decides which rows may influence a later brief.

create table if not exists design_memory (
  id text primary key,
  user_id text not null,
  kind text not null,
  category text not null default '',
  brief text not null default '',
  reason text not null default '',
  constitution_version text not null,
  recurring boolean not null default false,
  rule_key text not null default '',
  rule_value text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_design_memory_owner
  on design_memory (user_id, created_at desc);
