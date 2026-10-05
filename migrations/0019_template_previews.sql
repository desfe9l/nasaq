-- Multiple preview images per template.
--
-- A template is a multi-page document, and one thumbnail cannot show what it
-- contains: a buyer needs to see the cover, a content page and a table page
-- before deciding. `previews` holds an ORDERED list of the owner's uploaded
-- preview images (data URLs, normalised client-side by
-- `src/lib/templates/thumbnail.ts`), rendered by the gallery alongside the real
-- page previews.
--
-- `thumbnail` keeps its meaning as the single card image, so nothing that
-- already reads it changes behaviour.
alter table admin_templates
  add column if not exists previews jsonb not null default '[]'::jsonb;
