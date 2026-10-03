-- Personal templates (قوالبي) and a stable origin key for owner templates.
-- Official templates stay in admin_templates. Personal rows are readable only
-- by their owner unless visibility is explicitly 'shared'.

alter table admin_templates add column if not exists origin_project_id text;

create unique index if not exists idx_admin_templates_origin
  on admin_templates (origin_project_id)
  where origin_project_id is not null;

create table if not exists user_templates (
  id text primary key,
  user_id text not null,
  origin_project_id text,
  title text not null,
  description text not null default '',
  category text not null default 'general',
  content text not null,
  thumbnail text,
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  share_token text,
  page_count integer not null default 1,
  page_w double precision,
  page_h double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_templates_owner
  on user_templates (user_id, updated_at desc);

create unique index if not exists idx_user_templates_origin
  on user_templates (user_id, origin_project_id)
  where origin_project_id is not null;

create unique index if not exists idx_user_templates_share
  on user_templates (share_token)
  where share_token is not null;
