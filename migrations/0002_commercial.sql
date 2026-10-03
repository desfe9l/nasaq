-- Commercial layer: plans, entitlements, manual payment requests, admins.
--
-- Deliberately four SEPARATE concerns — collapsing them is the usual source of
-- "my subscription is broken" bugs:
--
--   plans          what is for sale (data-driven; the UI never hardcodes a price)
--   payment_requests  a PURCHASE ATTEMPT — evidence the customer says they paid
--   subscriptions  the ENTITLEMENT — access actually granted, with an expiry
--   admin_users    who may approve; authorization is read server-side, never
--                  from anything the browser sends
--
-- A payment request being APPROVED is not itself access: approval writes an
-- entitlement. Account state (FREE/PENDING/ACTIVE/EXPIRED/SUSPENDED) is DERIVED
-- from these rows on the server by `src/lib/commercial/entitlement.server.ts`,
-- so the browser cannot grant itself paid access by editing a variable.
--
-- No financial secrets are stored here: no card numbers, no CVV, no bank
-- credentials, no PINs. `payment_reference` is a transfer receipt id the
-- customer types in, which is why it is text and not a payment token.

-- ── plans ────────────────────────────────────────────────────────────────────
-- The single source of truth for what can be bought. `duration_days` drives
-- activation expiry, so adding a plan never needs a code change.
create table if not exists plans (
  id text not null primary key,
  name text not null,
  arabic_name text not null,
  description text not null default '',
  price numeric(12, 2) not null,
  currency text not null default 'SAR',
  duration_days integer not null,
  features jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_price_nonnegative check (price >= 0),
  constraint plans_duration_positive check (duration_days > 0)
);

-- ── subscriptions (the entitlement) ──────────────────────────────────────────
-- `expires_at` is the authoritative date. Reaching it does NOT delete anything:
-- projects, files and history belong to the customer and survive expiry. A row
-- is never deleted on expiry — status flips and the row stays as account history.
create table if not exists subscriptions (
  id text not null primary key,
  user_id text not null,
  plan_id text not null,
  status text not null,
  activated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_status_valid
    check (status in ('ACTIVE', 'EXPIRED', 'SUSPENDED'))
);

create index if not exists subscriptions_user_idx on subscriptions (user_id);

-- At most one live entitlement per customer. EXPIRED rows are excluded, so the
-- full history accumulates while only ACTIVE/SUSPENDED can ever collide.
create unique index if not exists subscriptions_one_live_per_user
  on subscriptions (user_id)
  where status in ('ACTIVE', 'SUSPENDED');

-- ── payment_requests (the purchase attempt) ──────────────────────────────────
-- `amount` and `currency` are SNAPSHOTS taken when the request was made: a later
-- price change must not rewrite what the customer was quoted. `plan_id` is
-- intentionally NOT a foreign key for the same reason — deleting or renaming a
-- plan must never erase a customer's payment history.
create table if not exists payment_requests (
  id text not null primary key,
  user_id text not null,
  plan_id text not null,
  amount numeric(12, 2) not null,
  currency text not null,
  payment_method text not null default 'MANUAL',
  payment_reference text not null,
  customer_note text,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  admin_note text,
  constraint payment_requests_status_valid
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'))
);

create index if not exists payment_requests_user_idx
  on payment_requests (user_id, created_at desc);
-- The admin queue is "everything still PENDING", so index exactly that.
create index if not exists payment_requests_pending_idx
  on payment_requests (created_at)
  where status = 'PENDING';

-- ── admin_users ──────────────────────────────────────────────────────────────
-- Server-side authorization only. A row here is the ONLY thing that makes an
-- account an administrator; no email comparison in client code, no isAdmin flag.
-- `user_id` is TEXT without a foreign key, per this project's convention: the
-- preview dev user id is the string 'dev-user' and has no `"user"` row, so an FK
-- would reject every admin/renewal write in a no-sign-in workspace. Row deletion
-- is therefore an explicit operation, never a cascade.
create table if not exists admin_users (
  user_id text not null primary key,
  created_at timestamptz not null default now(),
  created_by text,
  note text
);

-- ── admin_audit_log ──────────────────────────────────────────────────────────
-- Lightweight, append-only record of sensitive actions (who/what/when).
-- Never exposed to ordinary customers — read only behind admin authorization.
create table if not exists admin_audit_log (
  id text not null primary key,
  admin_user_id text not null,
  action text not null,
  target_type text not null,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx
  on admin_audit_log (created_at desc);

-- ── payment_settings ─────────────────────────────────────────────────────────
-- Admin-editable external payment instructions. Publicly readable on purpose:
-- the customer must see the account to pay into. These are receiving details,
-- not credentials — nothing here authorizes a payment or moves money.
create table if not exists payment_settings (
  key text not null primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ── seed plans ───────────────────────────────────────────────────────────────
-- `on conflict do nothing` so an admin's later edits are never clobbered if this
-- file is ever re-applied against a database that already has the rows.
insert into plans (id, name, arabic_name, description, price, currency, duration_days, features, enabled, sort_order)
values
  (
    'monthly',
    'Monthly',
    'الباقة الشهرية',
    'وصول كامل لمدة شهر واحد — مناسب لتقرير أو مشروع محدد.',
    199.00, 'SAR', 30,
    '["محرر كامل بجميع العناصر","تصدير PDF وWord وPowerPoint وPNG","قوالب رسمية جاهزة","حفظ المشاريع محلياً في متصفحك"]'::jsonb,
    true, 10
  ),
  (
    'quarterly',
    'Quarterly',
    'الباقة الربع سنوية',
    'وصول كامل لمدة ثلاثة أشهر — الأنسب للعمل المتكرر.',
    499.00, 'SAR', 90,
    '["كل ميزات الباقة الشهرية","أولوية في الدعم","تحديثات القوالب خلال المدة"]'::jsonb,
    true, 20
  ),
  (
    'semiannual',
    'Semi-annual',
    'الباقة النصف سنوية',
    'وصول كامل لمدة ستة أشهر بتوفير أعلى.',
    899.00, 'SAR', 180,
    '["كل ميزات الباقة الربع سنوية","توفير مقارنة بالاشتراك الشهري","مراجعة قوالب مخصصة"]'::jsonb,
    true, 30
  ),
  (
    'annual',
    'Annual',
    'الباقة السنوية',
    'وصول كامل لمدة سنة كاملة — أفضل قيمة.',
    1499.00, 'SAR', 365,
    '["كل ميزات الباقة النصف سنوية","أفضل سعر للشهر","دعم مخصص طوال المدة"]'::jsonb,
    true, 40
  )
on conflict (id) do nothing;

-- ── seed payment settings ────────────────────────────────────────────────────
-- Safe placeholders: the owner MUST replace these with real receiving details
-- before taking any real payment. They are intentionally obvious, not plausible,
-- so nobody transfers money into a placeholder by mistake.
insert into payment_settings (key, value)
values
  ('bank_name', 'يُحدَّد من لوحة الإدارة'),
  ('account_name', 'يُحدَّد من لوحة الإدارة'),
  ('iban', 'يُحدَّد من لوحة الإدارة'),
  ('instructions_ar', 'حوّل مبلغ الباقة إلى الحساب البنكي أعلاه، ثم ارجع إلى هذه الصفحة وأدخل رقم مرجع الحوالة ليتم التحقق منها.'),
  ('instructions_en', 'Transfer the plan amount to the account above, then return here and submit the transfer reference for verification.')
on conflict (key) do nothing;