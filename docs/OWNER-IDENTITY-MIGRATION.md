# Owner Identity Migration — the canonical identity map and its verification

Internal runbook. It contains **no** identifiers, addresses, licence keys,
hashes or environment values — every id referenced at run time is a one-way
fingerprint.

## 1. The identity graph (STEP 1)

One legitimate owner passes through every system like this:

```
AUTH ACCOUNT (AuthStore: R2, else Postgres)             ← sign-in authority
  └─ canonical user id            ← the id the owner SIGNS IN WITH today
       ├─ legacy user id          ← pre-first-party-auth id (orphan: resolves nowhere)
       ├─ admin_users             ← authority row(s); legacy row may be orphaned
       ├─ site_settings[nasaq.owner_binding.v1]   ← DURABLE OWNER BINDING
       ├─ customers view          ← identity store ∪ legacy "user" projection
       ├─ subscriptions           ← plan entitlement (owner: via binding)
       ├─ licenses                ← licence rows (Keygen mirror + manual)
       ├─ license_claims          ← first-claim reservations per key hash
       ├─ payment_requests        ← purchase attempts / approvals
       ├─ account_trials          ← server-owned trial window (keyed by user_id)
       ├─ library_catalog         ← per-account library metadata (keyed by user_id)
       ├─ user_templates          ← personal templates
       ├─ cloud_projects          ← cloud mirror of editor projects
       ├─ storage_assets          ← asset metadata; bytes in R2 under users/<id-segment>/…
       ├─ storage_projects        ← project-id ownership claims
       ├─ client_requests         ← support/design requests of the account
       └─ Keygen (external provider)
            ├─ license keys       ← NEVER reissued during reconciliation
            ├─ license scope      ← metadata.nasaqUserId / userScopeVerified
            └─ ownerReboundFrom   ← server-written trail letting scope follow the owner
```

Mapping rule applied by the migration:

```
OLD ID → CURRENT ID → RECORD TYPE  → OWNER            → CURRENT AUTHORITY
legacy  → canonical → admin_users  → binding.userId   → owner-binding + admin_users row
legacy  → canonical → commercial   → binding.userId   → subscriptions/plans
legacy  → canonical → licenses     → binding.userId   → licenses row + Keygen scope (+ rebound trail)
legacy  → canonical → storage      → binding.userId   → row user_id + prefix rebound (server-proven)
legacy  → canonical → provider     → (unchanged key)  → Keygen licence itself; local mirror follows
```

A legacy id is migratable **only** when (a) the identity store does not
resolve it (it is an orphan — a live account's rows are untouchable) and (b)
the durable owner binding proves it belonged to the owner (recorded
`previousUserId`, or a legacy `"user"` projection row carrying the binding's
address). If the identity store cannot answer, every path fails closed.

## 2. The authoritative source per system (STEP 2)

| # | State | Authoritative source | Notes |
|---|-------|----------------------|-------|
| 1 | Authentication | **AuthStore** — Cloudflare R2 when `R2_*` is configured, else Postgres via `DATABASE_URL` | decided by `auth/store/status.ts`; the legacy Better Auth `"user"` table is a **projection**, never the authority |
| 2 | Commercial (customers, plans, subscriptions, payments, trials, requests) | **Neon Postgres** (`DATABASE_URL`) | migrated on every deploy by `scripts/migrate.mjs` |
| 3 | Licences (local mirror, claims, admin inventory) | **Neon Postgres** | `licenses` / `license_claims`; both the admin console and the editor read THE SAME tables |
| 4 | Object storage (asset bytes, legacy auth state) | **Cloudflare R2** | row `object_key` is never rewritten by the migration; access is re-authorized via the prefix rebound |
| 5 | Licence provider | **Keygen** | keys are never regenerated/duplicated/invalidated by the migration; local mirror rows move, provider scope is honoured via `userScopeVerified`/`nasaqUserId` + the server-written `ownerReboundFrom` |
| 6 | Client/offline | never authoritative | IndexedDB entitlement cache is grace-only (7 days); it is dropped when the session reports a different account id (`storage-owner-sync.ts`); fresh state always comes from the server |

## 3. Split-brain authority: the resolvers every path uses (STEP 3)

| Decision | The ONE resolver | Callers |
|----------|------------------|---------|
| current user | `authMiddleware` → verified session | every server function |
| admin | `isAdminCaller` (`admin-identity.server.ts`) | `getAuthorizationContext`, template gate, vault, commercial admin, entitlement account view |
| super-admin/owner | `isSuperAdminIdentity` / `isOwnerIdentityWithBinding` (+ durable binding) | licence minting, vault secrets, owner setup |
| entitlement | `getAuthorizationContext` (`authorization.server.ts`) | editor gates, licence status |
| account status | `getAccount` / `requireActiveEntitlement` (`commercial/entitlement.server.ts`) | account view, paid operations |
| licence scope | `license/scope.ts` (`keygenScopeSatisfied`, `boundToAnotherOwner`, `keygenScopeSql`) | activation, revalidation, ownership SQL, entitlement read |
| storage ownership | `storage/ownership.server.ts` (`findOwnedAsset`, `resolveOwnedProjectSlot`) | upload/read/delete/duplicate — includes the owner-rebound prefix acceptance |

## 4. Running the migration (STEPS 4, 8, 11)

The app self-heals: the owner's next privileged call reconciles their records
(`getLicenseStatusFn`, account page, recovery flow). To run it deliberately
with a printed, fingerprinted before/after proof:

```bash
# with the deployment's own environment (DATABASE_URL + AuthStore env):
npm run migrate:owner -- --dry-run   # what would move; touches nothing
npm run migrate:owner                # move + before/after counts + idempotency pass
npm run verify:owner                 # read-only certification; exit 1 on failure
npm run verify:owner -- --json       # machine report (same redaction rules)
```

`migrate:owner` refuses (exit 2) when the identity store cannot answer or no
durable owner binding exists; the owner must then sign in once so the recovery
flow writes the binding. The reconciliation itself is the same server function
the runtime uses — only the bound owner, only proven orphans, live accounts
untouchable, keyed tables never overwritten, nothing created, nothing deleted,
history preserved (primary keys, timestamps, status, metadata).

### Running it where the production configuration lives (no secret ever leaves)

The commands above need the deployment's `DATABASE_URL`, R2 trio and Keygen
token handed to the process. When those values must not leave the deployment
(the normal case — they live in Vercel and are unreadable through the API),
run the same operations **inside the deployment runtime**:

```
POST /api/ops/owner-recovery   { "stage": "...", "confirm": "..." }
GET  /api/ops/owner-recovery   → the durable ledger (marker + last report per stage)
```

Stages: `plan` · `migrate` (confirm `MIGRATE-OWNER`) · `identity` (verify:owner
+ verify:owner-live) · `provider` (verify:provider) · `storage` (storage:verify)
· `admin-probe` (confirm `ADMIN-PROBE`) · `battery` (identity + provider +
storage). Every stage calls the SAME module its `npm run …` equivalent calls —
one implementation, one answer.

Refusal rules, all fail-closed: `VERCEL_ENV` must be `production`; the managed
database must be configured in that runtime; the caller must carry a real
session that passes the same super-admin/owner resolver the console uses (the
mutating stage additionally requires the durable-bound canonical owner);
cross-site requests are refused; 10 runs per verified session per minute; every
execution **and every refusal** is written to `admin_audit_log` as
`owner.ops_run`. Responses contain fingerprints, counts and verdicts only —
never an id, address, key, key hash, connection string or token.

The operation **disables itself**: once `migrate` completes and the
post-migration verification is green, a marker in `site_settings`
(`nasaq.owner_ops.completed.v1`) makes every mutating stage answer
`409 already_completed` permanently. Read-only stages stay available so the
evidence can be re-read. The route is temporary — delete
`src/routes/api/ops/owner-recovery.ts` once the recovery is verified; the
`site_settings` reports and the audit rows are the surviving record.

Legacy retirement (STEP 8): after verification is green, the orphaned
`admin_users` rows and legacy `"user"` projection rows remain in place —
**non-authoritative by construction** (the gates ignore ids that resolve
nowhere) and kept for audit. The verification report counts them
(`orphan_admin_rows`) so their retirement is visible, never silent. Historical
records are never deleted by this tooling.

## 5. What the verification checks (STEPS 11–12)

`owner-migration-verify.server.ts` (backing `verify:owner`, `migrate:owner`
and the regression suite) certifies, in order:

- `identity_store` — the store that decides orphan-vs-live answered (fail closed);
- `owner_binding` + `binding_admin_row` — canonical owner bound and authorized;
- `orphan_rows` — **0** rows on the proven pre-migration ids, per owned table;
- `duplicate_live_subscriptions`, `duplicate_license_keys`, `subscription_plan`
  — structural integrity of the entitlement schema;
- `owner_license_scope` — every Keygen licence the canonical owner holds is
  scoped to the owner (directly or via the rebound trail);
- `rebound_marker_live` — no rebound marker names a live account (paranoia; must be 0);
- `license_orphan_owner`, `unowned_active_license`, `license_scope_mismatch_other`
  — warnings only (pre-migration customers who have not returned, unissued
  inventory), never auto-“fixed”;
- `orphan_admin_rows` — retired legacy authority, reported for audit.

Provider-side (STEP 12): the admin console's licence tools already revalidate
the owner's Keygen licences against the provider on read
(`revalidateLinkedKeygenLicense`) and every admin mutation (suspend,
reinstate, expiry) is mirrored to the provider first and only then written
locally, so console and provider cannot silently diverge. Existing keys,
activation state and device activations are preserved end to end — the
migration never asks anyone for a new key.

## 6. Caches (STEP 9)

- `localStorage["nasaq.license-key"]` — the typed-in key cache; validated
  against the server on every use, unusable as a second activation path.
- IndexedDB `entitlementCache::<ownerId>` — grace-only; invalidated when the
  session reports a different account id; refreshed from
  `getLicenseStatusFn` in the background on every hydration.
- Service-worker/offline documents — document data only, never entitlement.

After reconciliation the canonical account always receives fresh state from
the server; the stale FREE cached under the old id is dropped on the next
session sync.
