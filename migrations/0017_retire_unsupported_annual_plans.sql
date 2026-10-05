-- Only the four current paid plans remain enabled. Keep retired rows so
-- existing subscription/payment history can still reference them, but prevent
-- the old annual tiers (and any other legacy ids) from being offered or renewed.
UPDATE plans
SET enabled = false,
    updated_at = now()
WHERE enabled = true
  AND id NOT IN (
    'individual-monthly',
    'individual-quarterly',
    'team-monthly',
    'team-quarterly'
  );
