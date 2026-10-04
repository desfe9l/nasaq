-- Short, professional share codes for templates.
--
-- A share link used to expose the whole internal identifier
-- (/templates/tpl_9f2c1a7e-4b0d-4a55-9c31-0aa9d0b21f44 or a 32-hex token), which
-- is long, ugly and impossible to read aloud. Every shareable row now also owns
-- a short code so the public address is /t/k7m2p9q or /s/k7m2p9q.
--
-- The code is minted once and never rotated: a link that was sent out keeps
-- working after refresh, after a redeploy and for anyone opening it directly.
-- The long addresses keep working too — short codes are an addition, not a
-- replacement, so nothing already shared breaks.

alter table admin_templates add column if not exists short_code text;
alter table user_templates add column if not exists short_code text;

-- Unique per row, and only enforced where a code exists (existing rows are
-- backfilled lazily on read).
create unique index if not exists admin_templates_short_code_uniq
  on admin_templates (short_code) where short_code is not null;
create unique index if not exists user_templates_short_code_uniq
  on user_templates (short_code) where short_code is not null;

-- Public resolution of a short link must be a single indexed lookup.
create index if not exists user_templates_short_code_lookup
  on user_templates (short_code, visibility) where short_code is not null;
