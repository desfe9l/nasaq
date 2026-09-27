-- Marketing template share links: stable public slug
ALTER TABLE admin_templates ADD COLUMN IF NOT EXISTS slug TEXT;
-- Unique where not null, so existing nulls don't collide
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_templates_slug_unique ON admin_templates (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_templates_slug ON admin_templates (slug);
