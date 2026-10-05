-- Template records the owner has edited themselves.
--
-- The bundled catalogue is re-seeded from the generators when a database is
-- new (`insertTemplateSeedsOnce`) and re-written when the artwork generation
-- changes (`refreshBundledTemplateArtwork`). Both used to run against a
-- database that could not tell an owner's save from a pristine seed row, so a
-- template edited in the Admin console could be silently rolled back to the
-- generated version on the next boot — the "my template save did not stick"
-- bug. One flag fixes the priority: an owner edit always wins.
alter table admin_templates
  add column if not exists owner_edited boolean not null default false;

-- Personal templates carry the same guarantee for their own rows.
alter table user_templates
  add column if not exists owner_edited boolean not null default true;
