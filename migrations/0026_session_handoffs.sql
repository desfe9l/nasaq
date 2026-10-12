-- Cross-domain session handoff codes.
--
-- nasaq.team (public) and nasaq.work (workspace) are DIFFERENT registrable
-- domains; the `__Host-` session cookie set on one is never sent to the other.
-- When a signed-in visitor moves between the two (or finishes sign-in), the
-- app mints a one-time, 60-second handoff code, redirects through the other
-- domain's `/api/auth/handoff`, and that endpoint exchanges the code for a
-- fresh first-party session on its own host.
--
-- Security notes:
--   · only sha256(code) is stored — a dump of this table yields no usable code;
--   · consumption is a single atomic `delete ... returning`, so a code can be
--     exchanged exactly once;
--   · rows expire within a minute and are garbage-collected on consumption
--     attempts, so the table cannot grow from handoff traffic.

create table if not exists auth_handoffs (
  code_hash text not null primary key,
  user_id text not null references auth_users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_auth_handoffs_expires
  on auth_handoffs (expires_at);
