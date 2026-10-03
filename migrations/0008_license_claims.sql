-- One first-claim per Keygen key, across concurrent server instances. A claim
-- does not grant access: only a successful user-scoped Keygen validation does.
-- Keep the reservation when a network request fails so another account cannot
-- take the same key while the first claimant retries.
create table if not exists license_claims (
  key_hash text primary key,
  user_id text not null,
  created_at timestamptz not null default now()
);
