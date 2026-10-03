-- 0006_paylink_v2.sql
-- Paylink Payment Webhook V2 fields.
-- RETIRED: Paylink is no longer a payment provider — see 0011_drop_paylink.sql,
-- which drops the paylink_transactions table these fields lived on. The file is
-- left untouched because it is already recorded in `_migrations`.
--
-- V2 of the Paylink webhook carries far more than V1 did: the payment method
-- (`paymentType`), the merchant identity block (`merchantMobile`,
-- `merchantAccountNo`, …) and — critically — an explicit `apiVersion` marker.
-- Storing them turns "the webhook said it was paid" into an auditable record:
-- an operator can answer which gateway method settled an order and under which
-- payload contract, without replaying logs.
--
-- Every column is additive and nullable: rows written by the V1-era code stay
-- readable, and nothing here is required for the existing fulfilment path.

alter table paylink_transactions
  add column if not exists api_version text;
alter table paylink_transactions
  add column if not exists payment_type text;
alter table paylink_transactions
  add column if not exists merchant_order_number text;
alter table paylink_transactions
  add column if not exists merchant_mobile text;
alter table paylink_transactions
  add column if not exists paid_at timestamptz;
alter table paylink_transactions
  add column if not exists webhook_received_at timestamptz;

-- The provider's own order reference as Paylink echoed it back. Kept beside our
-- generated `order_number` so a mismatch between the two is visible in SQL
-- rather than inferred from a failed fulfilment.
create index if not exists paylink_transactions_merchant_order_idx
  on paylink_transactions (merchant_order_number)
  where merchant_order_number is not null;

-- ── Super-administrator bypass ──────────────────────────────────────────────
-- `role` separates the platform owner (SUPER_ADMIN) from promoted staff
-- (ADMIN). Only a SUPER_ADMIN may mint, re-assign or force-activate licences
-- by hand, which is the permission the owner was previously blocked from
-- exercising. Existing rows are promoted to SUPER_ADMIN so no current
-- administrator loses access when the column appears.
alter table admin_users
  add column if not exists role text not null default 'ADMIN';
alter table admin_users
  add column if not exists updated_at timestamptz not null default now();

update admin_users
set role = 'SUPER_ADMIN'
where role is null or role not in ('ADMIN', 'SUPER_ADMIN');
