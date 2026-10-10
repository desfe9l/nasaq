-- Free export usage tracking for the three-free-file plan
-- Tracks per-user usage of PNG/JPG/PDF exports under the free plan
-- Reset is NOT allowed by clearing browser storage - usage is server-persistent

create table if not exists free_export_usage (
    user_id text not null,
    format text not null check (format in ('png', 'jpg', 'pdf')),
    used_count integer not null default 0,
    updated_at timestamptz not null default now(),
    primary key (user_id, format)
);

-- Index for quick lookup of user's total free export usage
create index if not exists free_export_usage_user_idx on free_export_usage(user_id);

-- Comment explaining the purpose
comment on table free_export_usage is 'Tracks each user''s usage of the three free exports (PNG/JPG/PDF) per format. Free plan users get exactly 3 free exports total across all formats.';