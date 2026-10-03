-- NASAQ admin-managed content (/admin).
-- Site-wide settings (commercial config, announcements, texts, Brand Kit
-- presets) are stored as JSON documents keyed by section; templates uploaded
-- by the administrator live in their own table so they can be listed,
-- toggled and gated (free vs licensed) without loading every payload.

create table if not exists site_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists admin_templates (
  id           text primary key,
  title        text not null,
  description  text not null default '',
  category     text not null default 'general',
  tier         text not null default 'free' check (tier in ('free','licensed')),
  status       text not null default 'draft' check (status in ('draft','published','archived')),
  kind         text not null default 'json' check (kind in ('json','svg')),
  content      text not null,              -- project JSON or sanitised SVG markup
  thumbnail    text,                        -- data URL (image) or null
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_admin_templates_status on admin_templates (status);
