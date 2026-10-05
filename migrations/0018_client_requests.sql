-- Client requests — «تواصل معنا / اطلب خدمة».
--
-- One row per request a visitor or an account holder submits from the platform:
-- a design/service request, a template question, a licensing question, or
-- support. The platform owns the record end to end, so a request exists even
-- when every external channel (WhatsApp, phone, mail) is unavailable, and the
-- administration reads it in its own inbox.
--
-- Privacy: nothing here is public. Reads are scoped to the administration, and
-- a signed-in customer may read only rows whose `user_id` is their own.

create table if not exists client_requests (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- What the request is about. `design` is the «طلب تصميم» service, `template`
  -- is about a specific catalogue item, `license` about plans/entitlement,
  -- `support` everything else.
  kind text not null default 'design',
  -- The customer's own words are never rewritten; status is the platform's.
  status text not null default 'new',
  priority text not null default 'normal',

  -- The two fields the brief requires capture, plus the optional context.
  name text not null,
  contact text not null,
  email text,
  organization text,
  details text not null,

  -- Where the request came from and what it refers to.
  source text not null default 'site',
  template_id text,

  -- Account association, filled server-side from the verified session only.
  user_id text,
  user_email text,
  -- A snapshot of the requester's entitlement AT submission time. It answers
  -- "was this a licensed customer?" months later without joining live licence
  -- state that may have changed.
  license_plan text,
  license_status text,

  -- Administration workflow.
  assigned_to text,
  response_note text,
  responded_at timestamptz
);

-- The inbox is read newest-first per status, and the customer's own history is
-- read per account. Both are covered here.
create index if not exists client_requests_status_idx
  on client_requests (status, created_at desc);
create index if not exists client_requests_user_idx
  on client_requests (user_id, created_at desc);

-- Administration-managed presentation and workflow settings: the contact
-- numbers the platform displays, the service types it offers, which optional
-- fields it asks for, and the response expectations it states. A single row
-- (`default`) holds the current document; defaults live in code, so an empty
-- table is a working configuration rather than a broken one.
create table if not exists client_request_settings (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
