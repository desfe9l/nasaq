# NASAQ — Production Audit, Repair & Hardening Report

**Date:** 2026-10-08
**Branch:** `arena/d220b41b-nasaq` (from `main` @ `d82ef53`)
**Production:** https://nasaq-sa.vercel.app (build `d82ef53-muztotwa` — matches HEAD at audit time)
**Scope:** Complete application audit per the production-grade hardening task: architecture, full site audit, frontend, end-to-end functionality, self-managed resource control, quotas, retries, background work, caching, request deduplication, storage, database, AI resource control, Vercel independence, security.

---

## 1. Executive summary

The application was already substantially hardened by prior sessions (first-party auth, classified AI errors, per-kind storage ceilings, security headers, throttled webhooks). This audit verified the whole surface against the **current** repository and **live production**, and found the resource-control layer had four real gaps:

1. **No application-owned policy module** — every limit was hardcoded at its call site, so limits were neither configurable by policy nor distinguishable by kind (user vs application safety vs provider).
2. **No per-account storage quota** — uploads were capped per *object* and throttled by nothing; an account could accumulate unbounded bytes in the bucket.
3. **No rate limits on any storage endpoint** — the most expensive per-request surface in the app (object storage + database writes) had zero request budgeting.
4. **Duplicate polling + uncached public catalog** — two editor components independently polled the same server function every 15 s, and every public catalog/settings read paid 4+ database queries (including idempotent seed checks) on every call.

All four are fixed in this branch, with 16 new unit tests. **No fix depends on a Vercel upgrade, extra credits, or any paid infrastructure.**

**Verification (all run on this branch):**

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **1213 pass / 0 fail** (baseline 1197 + 16 new) |
| `eslint` on all changed files | clean |
| `npm run env:audit` | ok — 51 documented variables cover every read site |
| `npm run check:deploy` | OK |
| `npm run build` (production) | exit 0 |
| Production probes (`/`, `/templates`, `/create`, `/login`, `/api/app-version`) | all 200, content correct |

---

## 2. What was audited and verified working (evidence)

### 2.1 Production & build
- `/api/app-version` returns `{"buildId":"d82ef53-muztotwa"}` — production matches the audited commit.
- Homepage renders (RTL Arabic, template cards, pricing CTAs); `/templates` renders 43 templates with licensed templates correctly gated («متاح في النسخة الكاملة»); `/create` and `/login` render fully.
- `npm run build` (deploy gate: `check:deploy` + vite build + migrate) exits 0.

### 2.2 Authentication & sessions
- First-party auth at `/api/auth/*`; opaque 256-bit session tokens with SHA-256 stored server-side (no forgeable cookie signature); identity store is R2 or Postgres — never process memory.
- Login/signup throttled per IP **and** per credential (`LOGIN_IP_MAX_ATTEMPTS`, `SIGNUP_IP_MAX_ATTEMPTS`, `LOGIN_ADDRESS_MAX_ATTEMPTS` in `src/lib/auth/service.server.ts`).
- Rate-limit bucket keys use the verified user id (`rateLimitKey`) and parse `x-forwarded-for` from the **rightmost** entry (`src/lib/auth/request-ip.ts`) — a spoofed first entry cannot rotate buckets.
- Admin layout (`/admin`) is wrapped in `RequireSignedIn`; every admin server function re-verifies authority server-side. No admin field is client-decidable.

### 2.3 AI layer (`src/lib/ai/`)
- Single HTTP boundary (`requestGemini`): **max 2 attempts**, exponential backoff (150 ms × 2^attempt), 45 s/30 s timeouts, abort forwarding.
- Permanent errors stop immediately: `provider_auth`, `provider_billing`, `provider_quota`, `invalid_model`, `provider_error` are never retried; only 429/5xx/network-transient retry once.
- Error classification distinguishes `provider_rate` / `provider_quota` / `provider_billing` / `provider_auth` / `provider_timeout` / `provider_blocked` — quota/billing is never reported as an auth failure, and each maps to a distinct Arabic user message.
- OCR (`analyzeImageFn`), report drafts, design briefs and selection transforms are licence-gated (`requireFeature(access, "ai_report")`) and rate-limited per user + per IP.

### 2.4 Retries & background work (audited, no changes needed)
- Sync queue (`src/lib/offline/sync-queue.ts`): coalesced drain (`requestSync` — one timer, dedup), per-entry in-flight dedup, attempt counter with conflict marking, owner-change bail-out. Not a hot loop.
- Connectivity heartbeat publishes only on **change**; boot does one probe + one queue read.
- `AppUpdateNotice` polls `/api/app-version` every 120 s (bounded, cheap static buildId) with idle-gated reload.
- Payment-success page polls every 4 s with a **120 s hard cap**.
- Editor autosave is debounced (900 ms) to IndexedDB with draft snapshots and leave-protection (`requestLeave` flushes before navigation).
- Image enhancement runs in a Web Worker behind hard pixel/edge ceilings (`src/lib/editor/image-enhance/limits.ts`) and a job guard.
- The `for (;;)` loop in `src/lib/multiplayer/p2p.ts` is bounded by `SIGNAL_RETRY_DELAYS_MS` (2 retries), not infinite — but see §4.1 (dead code).

### 2.5 Storage pipeline (`src/lib/storage/`)
- Per-object size ceilings per kind (`STORAGE_MAX_OBJECT_BYTES_BY_KIND`), base64-length pre-check before buffer allocation, decoded-size authoritative check.
- Ownership enforced server-side: project slot resolution, `findOwnedAsset` by `context.userId`, object keys minted server-side, `isKeyOwnedBy` prefix isolation (tests: `isolation.test.ts`, `storage.test.ts`).
- Reads hand back **short-lived signed URLs** (900 s); objects are never made public; no credential leaves the server.
- Upload → persist → read → render → delete flow covered by `verify.server.ts` round-trip check.

### 2.6 Webhooks & payments
- Gumroad ping endpoint: rate-limited (120/min/IP), form/JSON parsing, **server-side sale verification** before any fulfilment, replay deduplication, no secrets logged.
- Manual payment submission: plan price snapshotted server-side (client cannot underpay), one pending request per user, reference/note length-capped.
- License API routes (`/api/license/*`) delegate to throttled server functions.

### 2.7 Security
- Global security-headers middleware: `X-Content-Type-Options`, CSP (+ host-aware `frame-ancestors`), `Referrer-Policy`, `Permissions-Policy`, HSTS (production-owned hosts only).
- Template thumbnail route: published rows only, ETag/304 + immutable caching, SVG rasterized to PNG for crawlers, sandboxed CSP on the response, no internal error leakage to anonymous callers.
- All `dangerouslySetInnerHTML` sites go through allow-list sanitizers (`safeLibrarySvg`, the editor's SVG allow-list walk); no `eval`/`new Function` in app code.
- `env:audit` confirms no secret is exposed through a public `VITE_` name and every read variable is documented.
- **No user-facing copy tells anyone to upgrade Vercel, buy credits, or purchase infrastructure.** The only "Vercel" mentions are internal ops diagnostics. Verified by grep across `src/`.

### 2.8 Database
- Shared global pool (`src/lib/db.ts`), Postgres in production via `DATABASE_URL`, PGLite locally; fails closed on Vercel without `DATABASE_URL` (documented, never silently in-memory in production).
- All queries parameterized; template/license/storage reads scoped by verified `user_id`.

---

## 3. Gaps found and repaired (this branch)

### 3.1 NEW — Application-owned resource policy: `src/lib/policy/limits.ts`
The app had limits but no **policy layer**: numbers were hardcoded at call sites and the kinds of limit were indistinguishable. The new module is the single, deployment-configurable source:

- Per-operation budgets for `ai:report`, `ai:design`, `ai:selection`, `ai:image`, `ai:admin-note`, `storage:upload`, `storage:mutation`, `storage:read` (per-user per-minute + per-IP per-minute).
- `checkOperationLimit()` returns a verdict that **distinguishes** `user_limit` (the identity's own budget) from `app_limit` (the application safety ceiling). `checkAppSafetyLimit()` checks the ceiling alone — used for privileged surfaces.
- `withinStorageQuota(used, incoming)` — the per-account storage quota (default 512 MiB).
- `publicCacheTtlMs()` — TTL for the public-read cache (default 30 s).
- Configurable via `NASAQ_LIMITS_JSON` (deep-merge), `NASAQ_STORAGE_QUOTA_BYTES`, `NASAQ_PUBLIC_CACHE_TTL_MS` — all documented in `.env.example`; a malformed override falls back to defaults and can never widen a limit.

### 3.2 NEW — Per-account storage quota enforcement (`src/lib/storage/functions.ts`)
`uploadEditorAsset` now computes the account's authoritative usage (`ownerStorageUsage`) and refuses with a distinct `quota_exceeded` reason **before a single byte is written** when `usage.bytes + incoming > quota`. This is deliberately distinct from the per-object `too_large` ceiling and from the per-minute `rate_limited` refusal — three different limits, three different truths.

### 3.3 NEW — Rate limits on every storage endpoint
All nine storage server functions now consult the policy budget before doing work: uploads and copies spend the `storage:upload` budget (they write bytes), deletes/catalog saves spend `storage:mutation`, and URL/download/list/usage reads spend a generous `storage:read` budget (so a polling meter cannot become a bandwidth bill). New failure reasons: `rate_limited` (and `quota_exceeded` above).

### 3.4 NEW — Admin AI note bounded (`src/lib/intelligence/functions.ts`)
`intelligenceNoteFn` is admin-gated but spends real provider money and had **no** rate limit — a compromised admin session could drain the provider budget. It now applies the `ai:admin-note` application safety ceiling (30/min per user, 60/min per IP) **even to admins**, returning a distinct `rate_limited` code (added to `LanguageNoteResult`).

### 3.5 NEW — Application-level cache for public reads: `src/lib/cache/public-cache.ts`
- TTL cache with **in-flight deduplication** (N concurrent callers share one load), bounded size (500 entries, oldest-expiry-first eviction), and **failures never cached**.
- Wired into: `listPublishedTemplatesFn`, `listBuiltinTemplateStatesFn`, `getPublishedTemplateMetaFn` (per-key), `getSiteSettingsFn`, and the institutional catalog `readCatalog`.
- **Invalidation on mutation**: `adminSaveSettingsFn` → `site:settings`; template upsert/status/delete/slug-regeneration → `templates:*` prefix; institutional `writeCatalog` → its key.
- **Deliberately NOT cached:** `getPublishedTemplateFn` (the payload fetch embeds a per-caller authorization decision for licensed templates — caching it would leak one caller's access into another's response).
- The institutional cache stores the **raw** catalog; the per-user visibility filter (`visibleInstitutionalBackgrounds(catalog, canManage)`) still runs per request, so a cached catalog can never leak an unpublished item to a non-admin.

### 3.6 NEW — Seed checks throttled (`src/lib/admin/functions.ts`)
`ensureProductTemplates` ran 4+ queries inside **every** public catalog read. It is now `ensureProductTemplatesThrottled` — at most once per cache-TTL window per process. Worst case: a newly bundled row appears one TTL late; the first read after boot still seeds before serving.

### 3.7 FIXED — Duplicate institutional-backgrounds polling (`src/lib/editor/use-institutional-backgrounds.ts`)
The hook was mounted by **two editor components at once** (asset library + page-background panel) plus the admin panel, each with its own 15 s interval and its own in-flight request — 2–3 identical server calls per editor session every 15 s, forever. It is now a shared singleton: **one interval, one in-flight request, N subscribers** (via `useSyncExternalStore`), started on first mount and stopped when the last unmounts. Combined with the server-side cache (§3.5), a poll now costs at most one cheap read per TTL window even across tabs.

### 3.8 Wired — AI endpoints through the policy
`ai/functions.ts` (report/design/selection) and `ai/image-functions.ts` (OCR) now use `checkOperationLimit`/`checkAppSafetyLimit` instead of hardcoded numbers. **Defaults are unchanged** (8/16, 6/12, 20/40, 4/8 per minute), so behaviour is identical unless a deployment overrides the policy. Admins are exempt from the per-user budget on customer-facing endpoints but remain under the IP safety ceiling.

---

## 4. Findings noted, not changed (with rationale)

### 4.1 Dead code: `src/lib/multiplayer/p2p.ts`
The entire multiplayer module is unreferenced (no component imports it; the `/api/rtc` signaling route it posts to does not exist). It is **inert** — it never executes — so it consumes no resources today. Its retry loop is bounded (2 attempts). Recommend deleting the module in a future cleanup; not deleted here to keep this branch focused on behaviour.

### 4.2 In-memory rate limiter is per-process
`src/lib/license/rate-limit.ts` keeps buckets in process memory (documented in the file). On serverless, each instance has its own buckets. This is acceptable **because every throttled endpoint pairs the limiter with a check that does not depend on it** (server-side licence verification, provider sale verification, entitlement lookups, ownership checks). The new policy module inherits this property and documents it.

### 4.3 Public cache is per-instance
Same serverless property: each instance caches its own copy, with TTL-bounded staleness for **public, non-personal** data only. Mutations invalidate immediately on the instance that performed them.

### 4.4 `intelligenceNoteFn` has no client caller
The admin AI-note server function is currently uncalled from any component. It was hardened anyway (§3.4) because it is an exposed, money-spending endpoint.

### 4.5 Editor image intake has no local size ceiling
`IMAGE_LIMITS` in `src/lib/editor/images.ts` is intentionally unlimited for the **local-first** path (the original file is stored in the user's own IndexedDB — the user's own disk, not the platform's). The platform-costing path (cloud mirror) **is** bounded: per-object ceilings + per-minute upload budget + per-account quota (§3.2, §3.3). This asymmetry is deliberate and documented.

---

## 5. Vercel-independence statement

Nothing in this branch asks for, assumes, or recommends:

- a Vercel plan upgrade, additional credits, or paid capacity;
- unlimited serverless execution, requests, storage, AI calls, retries, or background work.

Every control implemented here is **application-owned**: the policy module, the storage quota, the endpoint budgets, the public cache, the deduplicated poller. Where a real platform limit exists (per-process memory for rate buckets and caches), the application detects it, bounds it (entry caps, TTLs), and degrades safely — it never converts an infrastructure limit into an application failure, and never tells the user to upgrade.

---

## 6. Files changed

| File | Change |
|---|---|
| `src/lib/policy/limits.ts` | **NEW** — application-owned, env-configurable resource policy (operation budgets, storage quota, cache TTL, limit-kind verdicts) |
| `src/lib/policy/limits.test.ts` | **NEW** — 9 unit tests |
| `src/lib/cache/public-cache.ts` | **NEW** — TTL cache with in-flight dedup, bounded size, no failure caching |
| `src/lib/cache/public-cache.test.ts` | **NEW** — 7 unit tests |
| `src/lib/storage/functions.ts` | Per-account storage quota before write; rate budgets on all 9 storage server functions; new `quota_exceeded` / `rate_limited` reasons |
| `src/lib/ai/functions.ts` | Report/design/selection endpoints wired to the policy (defaults unchanged) |
| `src/lib/ai/image-functions.ts` | OCR endpoint wired to the policy (defaults unchanged) |
| `src/lib/intelligence/functions.ts` | Admin AI note bounded by the safety ceiling even for admins |
| `src/lib/intelligence/provider.ts` | `rate_limited` added to `LanguageNoteResult` |
| `src/lib/admin/functions.ts` | Public catalog/settings cached with invalidation on every mutation; seed checks throttled |
| `src/lib/institutional/functions.ts` | Raw catalog cached (per-user visibility filter preserved); invalidated on write |
| `src/lib/editor/use-institutional-backgrounds.ts` | Shared singleton poller — one interval, one in-flight request, N subscribers |
| `.env.example` | Documents `NASAQ_STORAGE_QUOTA_BYTES`, `NASAQ_PUBLIC_CACHE_TTL_MS`, `NASAQ_LIMITS_JSON` |
| `package.json` | New test files registered in `test:src` |

**Tests:** 1213 pass / 0 fail (16 new). **Typecheck:** clean. **Lint (changed files):** clean. **env:audit:** ok. **check:deploy:** OK. **Production build:** exit 0.
