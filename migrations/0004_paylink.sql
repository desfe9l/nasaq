-- Paylink invoices and their Keygen fulfillment.
-- RETIRED: Paylink is no longer a payment provider — see 0011_drop_paylink.sql,
-- which drops this table. The file is left untouched because it is already
-- recorded in `_migrations` on existing deployments.
-- The unique transaction number is the provider idempotency boundary. A webhook
-- may be delivered more than once, so processing claims are made in SQL before
-- Keygen or entitlement writes happen.

create table if not exists paylink_transactions (
  id text not null primary key,
  user_id text not null,
  order_number text not null unique,
  transaction_no text unique,
  plan_key text not null,
  plan_id text not null,
  amount numeric(12, 2) not null,
  currency text not null default 'SAR',
  client_email text,
  client_mobile text,
  status text not null default 'PENDING',
  paylink_order_status text,
  paylink_payment_url text,
  license_id text,
  keygen_license_id text,
  license_key_prefix text,
  entitlement_expires_at timestamptz,
  last_error text,
  processing_started_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paylink_transactions_status_valid
    check (status in ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELED'))
);

create index if not exists paylink_transactions_user_idx
  on paylink_transactions (user_id, created_at desc);
create index if not exists paylink_transactions_status_idx
  on paylink_transactions (status, created_at desc);

-- Entitlement writes can be retried after a process crash. Recording the source
-- transaction on the entitlement makes the final update idempotent as well.
alter table subscriptions
  add column if not exists source_transaction_id text;
create unique index if not exists subscriptions_source_transaction_idx
  on subscriptions (source_transaction_id)
  where source_transaction_id is not null;
