-- One server-owned trial window per account. Expiry and eligibility are derived
-- on the server; the browser never creates or extends a trial.
create table if not exists account_trials (
  user_id text primary key,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists account_trials_expires_idx
  on account_trials (expires_at);