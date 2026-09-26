-- Gumroad post-sale pipeline (Ping + Resource subscriptions → NASAQ → Keygen).
--
-- Gumroad is the PAYMENT authority; Keygen stays the LICENSING authority and
-- NASAQ entitlements stay the ACCESS authority (mirrors the Paylink layout).
-- Three tables, three concerns:
--
--   gumroad_pings         every raw notification envelope (idempotency + audit)
--   gumroad_sales         one row per verified-or-not sale/charge
--   gumroad_subscriptions the membership state machine keyed by subscription_id
--
-- No financial secrets here: no card data ever arrives in a Gumroad ping and
-- none is stored. `payload` keeps only the fields this pipeline reasons about.

-- ── gumroad_pings ────────────────────────────────────────────────────────────
-- `dedupe_key` is the replay boundary. A redelivered ping collides here and is
-- acknowledged 200 without reprocessing, exactly like paylink_transactions for
-- Paylink. Sale-like resources dedupe on sale_id; membership lifecycle events
-- (cancellation/ended/restarted) dedupe on subscription_id + the event's own
-- timestamp, because a subscription can legitimately be cancelled → restarted →
-- cancelled again.
create table if not exists gumroad_pings (
  id text not null primary key,
  resource_name text not null,
  dedupe_key text not null unique,
  sale_id text,
  subscription_id text,
  product_id text,
  email text,
  is_test boolean not null default false,
  status text not null default 'RECEIVED',
  note text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint gumroad_pings_status_valid
    check (status in ('RECEIVED', 'APPLIED', 'IGNORED', 'UNVERIFIED', 'REJECTED', 'FAILED'))
);

create index if not exists gumroad_pings_recent_idx
  on gumroad_pings (received_at desc);

-- ── gumroad_sales ────────────────────────────────────────────────────────────
-- One row per monetary charge seen (first payment, renewal, refund marker…).
-- `verified_via` records HOW the sale was proven server-side: 'api' (sale
-- fetched from the Gumroad API with the owner token) or 'license' (the ping's
-- license_key confirmed against Gumroad's license-verify endpoint). 'none' rows
-- never fulfil anything.
create table if not exists gumroad_sales (
  sale_id text not null primary key,
  subscription_id text,
  product_id text not null,
  email text not null,
  tier_name text,
  plan_key text,
  recurrence text,
  amount_cents integer,
  currency text,
  is_recurring_charge boolean not null default false,
  is_test boolean not null default false,
  verified_via text not null default 'none',
  verified boolean not null default false,
  applied boolean not null default false,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint gumroad_sales_verified_via_valid
    check (verified_via in ('api', 'license', 'none'))
);

create index if not exists gumroad_sales_subscription_idx
  on gumroad_sales (subscription_id, created_at desc);

-- ── gumroad_subscriptions ────────────────────────────────────────────────────
-- The membership state machine. `bound_user_id` is written exactly once — when
-- the verified buyer email matches exactly one NASAQ account — and is NEVER
-- rebound afterwards, which is what makes activating someone else's
-- subscription impossible. `bound_email` alone (buyer had no NASAQ account at
-- purchase time) is claimed automatically the first time an account with that
-- verified email signs in.
create table if not exists gumroad_subscriptions (
  subscription_id text not null primary key,
  product_id text not null,
  tier_name text,
  plan_key text,
  recurrence text,
  status text not null default 'PENDING',
  bound_email text,
  bound_user_id text,
  claimed_at timestamptz,
  keygen_license_id text,
  last_sale_id text,
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gumroad_subscriptions_status_valid
    check (status in ('PENDING', 'ACTIVE', 'CANCELLED', 'PAYMENT_FAILED', 'ENDED', 'REFUNDED', 'DISPUTED'))
);

create index if not exists gumroad_subscriptions_email_idx
  on gumroad_subscriptions (bound_email)
  where bound_email is not null;
create index if not exists gumroad_subscriptions_user_idx
  on gumroad_subscriptions (bound_user_id)
  where bound_user_id is not null;
create index if not exists gumroad_subscriptions_pending_claim_idx
  on gumroad_subscriptions (bound_email)
  where bound_user_id is null and status in ('PENDING', 'ACTIVE', 'PAYMENT_FAILED');
