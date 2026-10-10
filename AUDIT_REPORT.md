# NASAQ | نَسَق — Master production audit and release report

**Audit date:** 2026-10-10
**Repository:** `desfe9l/nasaq`
**Audited branch:** `main`
**Released commit:** `79acc29d863ef07604a2119db8660c4984a72480`
**Production:** https://nasaq-sa.vercel.app
**Latest observed production build:** `79acc29-mv1ukxcm`

## Executive summary

The current `main` revision is deployed to Vercel and serves the public homepage, editor entry, templates, authentication health endpoint, and owner-vault route. The homepage, templates, and about pages were rendered in the sandbox browser with no console errors; the editor route was reachable and rendered its protected start surface. The production `/api/app-version` response matches the released `main` SHA prefix.

The repository contains a mature local-first editor, first-party authentication, PostgreSQL/PGLite data layer, R2-backed optional cloud storage, Gemini integration, editable Office/document exports, offline caches, licensing gates, and extensive automated coverage. The full `npm test` suite passed on the baseline checkout. `npm run typecheck`, `npm run build`, `npm run check:deploy`, `npm run check:auth` (with a running dev server), and `npm run env:audit` passed. Lint completed with **0 errors and 63 existing warnings**.

One verified requirement defect was found and corrected in this audit: public attribution used `فريق نَسَق` / `NASAQ Team`, while the explicit requirement is `المصمم والمطور فيصل المضياني` and, where English is appropriate, `Developed by فيصل المضياني`. The correction is in `src/lib/brand.ts` with a regression test in `src/lib/brand.test.ts`. It is safe and does not alter authentication, storage, licensing, user data, or document behavior.

**Current decision:** `PARTIALLY COMPLETED` — the public release and explicit attribution requirement are complete and verified, while protected database, storage, authenticated editor, AI, and device-specific workflows remain unverified because authorized fixtures and credentials were not available.

## Follow-up implementation session — 2026-10-10 (PR #188)

A continuation session audited `main` at `b9247e333a5a3db6d6d143ed0cb33a13d73f7742`, reconciled this report against the actual repository state, and fixed every defect that could be confirmed with evidence through GitHub-only access. Work was done on branch `arena/88c70384-nasaq` and submitted as **PR #188**.

### Confirmed defects fixed

1. **Account-tier contract regression (red `verify` job on `main`).** `useAccountTier` returns `{ tier, isOwner }`, but six components compared the object itself against tier strings, mis-gating `MyTemplatesPage` and `ProjectFileMenu` (e.g. the FREE tier could see «حفظ كقالب» entries). Root cause fixed in all six call sites; `scripts/account-control.test.mjs` rewritten to assert the real contract (5/5 pass). Commit `3d3e0ad`.
2. **Router search-param coercion dropped boot intents.** TanStack Router's `defaultParseSearch` JSON-coerces `?showcase=1` to the number `1`, and the routes' `typeof value === "string"` guards silently discarded it — showcase/template boot parameters could be lost. Added `src/lib/router-search.ts` (`searchString()`) with unit tests plus intake-boot regression tests, applied in the `editor/index`, `create`, `studio`, and `templates/index` routes. Commit `4c193b6`.
3. **CI `browser` job had never passed since its introduction (commit `4ea5f10`).** All failures traced to stale test scripts, not product regressions: outdated leave-dialog copy, an outdated project-file menu label («فتح ملف نَسَق» vs the shipped «فتح مشروع أو استيراد ملف…»), and persistence round trips that used premium-pack or over-page-limit documents — which `hydrate()` intentionally fail-closes on boot restore under FREE entitlements after a reload (the mocked session cannot cache a server entitlement). The scenarios were corrected to use a genuine 1-page `blank` document (the only shape a FREE boot restore may reopen) and current UI copy; the fail-closed licensing behavior itself is correct and unchanged. Commits `e33ef4f`, `2561137`, `e4226bd`, `e1917bc`, `4acbef9`.

### Test and CI evidence

- Local gates on the final branch state: `npm test` 1293/1293; `test:scripts` 245/245; `test:auth` 100/100; `test:admin` 191/191; `typecheck` pass; `lint` 0 errors / 63 pre-existing warnings; production `build` pass; `env:audit` pass; `check:auth` pass; `test:auth:e2e` 9/9; `test:ai:e2e` 5/5.
- Real-Chromium browser suites run locally against the dev server: `test:nsq:browser` pass; `test:leave:browser` pass (twice, after the fixes above).
- GitHub Actions run `38028055357` on head `4acbef9`: **`verify` job GREEN** (blocking gate) and **`browser` job GREEN — the first green browser job in the repository's history**. The `verify` job was green on every PR #188 run (38026390864, 38026588586, 38026929714, 38027189088, 38027635427, 38028055357).

### Scope and safety

No destructive migrations, no user-data deletion, no secrets touched; changed files are limited to the six tier-gated components, the new `src/lib/router-search.ts` + tests, the four route files, the two browser test scripts, `scripts/account-control.test.mjs`, `package.json` (test registration), and this report. Production-credential-gated items (REQ-01/02/06/07/08/10/11/12/14 live verification) remain outstanding exactly as listed below.

## Requirements matrix

The attached master brief recovered fourteen durable requirement groups. Each group below is a separate requested outcome; sub-requirements remain represented in the evidence and outstanding actions.

| ID | Requirement / evidence | Relevant implementation | Status | Priority | Corrective action / verification |
|---|---|---|---|---|---|
| REQ-01 | Unified durable persistence; audit prior Neon/Aiven/PostgreSQL/PGLite decisions and protect data. | `src/lib/db.ts`, `migrations/`, `docs/primary-database-cutover.md`, `src/lib/auth/store/` | **PARTIALLY IMPLEMENTED** | P0 | Code and migration architecture are present. Actual production database identity, schema checksum, connection pool behavior, and data continuity require authorized database access; do not cut over or run destructive tests. |
| REQ-02 | Sign-up/sign-in, sessions, Google OAuth, protected routes, logout, and cross-instance continuity. | `src/lib/auth/`, `/api/auth/*`, auth tests, `scripts/auth-e2e.mjs` | **DEPLOYED BUT NOT FULLY VERIFIED** | P0 | `/api/auth/ok` returned 200 and local real-auth E2E/invariant infrastructure passes. A permitted test account and provider-backed session are still needed for production sign-in, navigation to `/editor`, logout, and Google OAuth verification. |
| REQ-03 | Tabs, navigation, RTL, responsive layout, touch targets, and state preservation. | `src/components/editor/`, `src/lib/editor/`, `docs/editor-focused-verification.md`, `scripts/test-editor-workspace.mjs` | **VERIFIED WORKING (AUTOMATED / BROWSER SIMULATION)** | P1 | Existing browser suite covers desktop and simulated iPad sizes, touch/pinch, keyboard, tabs, pages, zoom to 200%, and state preservation. Real iOS/iPadOS/Safari and Apple Pencil remain unverified. |
| REQ-04 | NASAQ identity, palette, modes, editor/public consistency, and required developer attribution. | `src/lib/brand.ts`, `src/styles.css`, `src/components/site/SiteChrome.tsx`, `src/routes/__root.tsx` | **VERIFIED WORKING (PRODUCTION)** | P2 | Root cause was stale shared `BRAND.developer` / `developerEn` values. Changed to the exact required Arabic and English attribution, added `src/lib/brand.test.ts`, and verified the deployed about page renders `Developed by فيصل المضياني`. |
| REQ-05 | Homepage is a genuine marketing entry with working CTAs and a real mini-editor. | `src/components/site/HomePage.tsx`, `/` | **VERIFIED WORKING (PUBLIC RUNTIME)** | P1 | Browser render showed hero, CTAs, functional mini-editor controls, template discovery, pricing links, and responsive content. Production screenshot initially captured SSR skeleton, then hydration completed normally; no console errors. |
| REQ-06 | Production-grade editor: selection, layers, transforms, grouping, crop/mask, save/reload, export, touch, leave protection. | `src/components/editor/`, `src/lib/editor/`, `docs/editor-focused-verification.md`, editor tests | **PARTIALLY VERIFIED** | P1 | Extensive unit and simulated-browser coverage passes. Real production authenticated save/reload, cloud recovery, and physical Apple Pencil/Safari behavior need an authorized account/device. |
| REQ-07 | AI image generation → insertion → decode → save/reload → PNG/PDF/Office export. | `src/lib/ai/`, `src/lib/editor/images.ts`, `src/lib/editor/export.ts`, `src/lib/editor/image-frames.ts` | **PARTIALLY IMPLEMENTED / NOT PRODUCTION-VERIFIED** | P1 | AI image lifecycle and image/export contracts have regression tests. No configured production AI key or authorized generated-image run was available; cannot claim end-to-end production export fidelity. |
| REQ-08 | Unified PSD/PDF/DOCX/PPTX/SVG/import conversion into editable projects. | `src/components/import/`, `src/lib/editor/import/`, `src/lib/editor/psd/`, import tests | **PARTIALLY IMPLEMENTED** | P1 | File detection, repair, SVG safety, PSD handling, office/PDF paths, and editable project conversion exist and are tested. Faithful editability varies by source format and needs representative file-level browser verification; flattened/unsupported limitations must remain labeled. |
| REQ-09 | Template library and Template Studio: discovery, editability, licensing, save/duplicate/update/export. | `src/lib/templates/`, `src/components/site/TemplatesPage.tsx`, admin template panels, `/templates` | **VERIFIED FOR PUBLIC DISCOVERY; ACCOUNT FLOWS PARTIAL** | P2 | Production `/templates` rendered 43 catalog entries, category/theme controls, licensed gating, and use/preview actions. Authenticated save/update/admin lifecycle still needs permitted account verification. |
| REQ-10 | Gemini provider migration and AI/OCR/selection/design workflows without browser key leakage. | `src/lib/ai/provider.server.ts`, `src/lib/ai/*`, `docs/environment.md` | **IMPLEMENTED BUT NOT PRODUCTION-VERIFIED** | P1 | Code uses server-side Gemini boundary, classified errors, bounded retries, model fallback, Arabic contracts, and rate limits. No production key-backed call was available; no obsolete-provider fallback was observed in source. |
| REQ-11 | Offline editing, IndexedDB recovery, service worker, synchronization, conflict handling, and honest capability boundaries. | `src/lib/offline/`, `public/sw.js`, offline tests/docs | **PARTIALLY IMPLEMENTED** | P2 | Local project/cache/editing and conflict logic are covered by tests. Cloud synchronization and reconnection against production require a real account/database; the product correctly does not promise offline AI/server conversion. |
| REQ-12 | R2 upload/read/delete, signed URLs, private access, cross-user isolation, and document retrieval. | `src/lib/storage/`, `src/lib/auth/store/`, `scripts/storage-verify.mjs`, R2 workflow | **IMPLEMENTED BUT NOT RUNTIME-VERIFIED** | P0 | Ownership checks, short-lived signed reads, private keys, quotas, and round-trip verification tooling exist. R2 credentials and a safe test environment were unavailable here; do not claim activation from code alone. |
| REQ-13 | Security, licensing, rate limits, SVG sanitization, CSP, headers, webhook checks, and commercial catalog preservation. | security middleware, auth/license/storage policy modules, migrations, tests | **VERIFIED BY CODE / STATIC AND UNIT GATES** | P0 | Production response included CSP, HSTS, nosniff, referrer and permissions headers. Unit/security tests and env audit passed. Live cross-user authorization and webhook/provider verification still require non-destructive authorized fixtures. |
| REQ-14 | Performance, runtime reliability, routes, deployment relationship, logs, and release verification. | `vercel.json`, `scripts/deploy-config.mjs`, Vercel deployment metadata, route tree | **DEPLOYED BUT VERIFICATION INCOMPLETE** | P0 | Vercel deployment `dpl_9Q7eXGNaky2SXCLD8mrf59zvpGRi` was READY for the baseline SHA; public routes and `/api/app-version` were probed. Vercel runtime logs and serverless resource metrics were not available through the configured access, and the final attribution revision still needs deployment. |

### State transition ledger for the actionable fix

| Requirement | Requested | Implemented | Tested | Committed | Pushed | Merged | Deployed | Verified working |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| REQ-04 attribution correction | yes | yes | yes | yes | yes | yes (main) | yes (`dpl_J98pG7utYchgDrWeTXu9BSRE3MNP`) | yes (production about page) |
| All other requirements | yes | see matrix | see matrix | historical evidence varies | historical evidence varies | historical evidence varies | baseline only | see matrix |

## Root-cause findings

1. **Confirmed — stale attribution source:** public footer and metadata read `BRAND.developer`, which was still set to team copy. Because it was centralized, one source change fixes footer, document metadata, root author metadata, and the English about-page attribution. No duplicate component patch was added.
2. **Confirmed — production verification boundary:** the public deployment exposes health and public routes without requiring secrets, but account, R2, database, Keygen, Gumroad, and Gemini acceptance tests need protected credentials or safe test fixtures. The repository deliberately fails closed rather than using process memory or fake provider responses.
3. **Confirmed — prior audit drift:** older `AUDIT_REPORT.md` called `NASAQ_PRIMARY_DATABASE_URL` optional and described obsolete Better Auth/secret assumptions. Current `docs/environment.md` and source implement first-party opaque sessions backed by R2 or PostgreSQL, with PostgreSQL still required for commercial/application data. This report treats current source and current production evidence as authoritative.
4. **Not a confirmed defect — SSR skeleton capture:** the initial browser snapshot showed a loading skeleton, but a subsequent hydrated view rendered the complete homepage and showed no console errors. No code change is justified.
5. **Known verification limitation:** browser iPad tests are Chromium/CDP simulations, not physical Apple Pencil or Safari tests. This remains an explicit limitation rather than an unsupported completion claim.

## Database, infrastructure, and storage status

- **Local:** PGLite fallback and migrations are present and the build skips managed migration when `NASAQ_PRIMARY_DATABASE_URL` is absent.
- **Production application data:** source and migration docs specify PostgreSQL through `NASAQ_PRIMARY_DATABASE_URL`; the exact live provider/resource cannot be named from the accessible deployment metadata without exposing or reading secrets.
- **Identity:** current source uses a first-party opaque-token AuthStore backed by R2 when configured, otherwise PostgreSQL; it does not use process memory as a production fallback.
- **R2:** private object keys, server-side credentials, signed reads, ownership checks, quotas, and CI/owner verification tooling exist. Activation is **not claimed** without the configured runtime variables and a safe round trip.
- **Rollback/data safety:** no migration or provider cutover was executed by this audit; no user data was deleted or overwritten.

## Product and editor status

- **Tabs/navigation:** covered by existing unit and simulated browser suites; public navigation rendered correctly.
- **Identity:** palette, RTL, modes, and coherent public/editor source exist; creator attribution was corrected locally in this release.
- **Homepage:** public marketing entry and functional in-page editor verified after hydration.
- **Editor:** substantial editable canvas, page rail, layers, selection, transforms, import/export, offline/local persistence, and leave protection exist; protected cloud workflows remain unverified.
- **AI image/export:** contracts and lifecycle defenses exist; production provider-backed generated-image export remains outstanding.
- **Import:** unified import architecture exists with format-specific limits; full fidelity is format-dependent and not universally proven.
- **Templates:** 43 public catalog entries rendered with category/theme/license controls; account/admin mutation lifecycle remains protected.
- **Gemini:** server-side provider boundary and error/rate-limit policy are implemented; no live key-backed request was run.
- **Offline:** local-first editing and cache/conflict handling are implemented; server-dependent operations correctly remain online-only.
- **Licensing/security:** server-side entitlement gates, private storage policies, sanitization, CSP, rate limits, and commercial catalog protections are present and covered by tests/static checks.

## GitHub, deployment, and test evidence

- **Baseline main SHA:** `29211729849f5ce03f223388a7734787b4a71097`.
- **Released production deployment:** `dpl_J98pG7utYchgDrWeTXu9BSRE3MNP`, READY, production, commit `79acc29d863ef07604a2119db8660c4984a72480`, aliases `nasaq-sa.vercel.app`, `nasaq.team`, and `www.nasaq.team`.
- **Production build API:** `GET /api/app-version` returned `{"buildId":"79acc29-mv1ukxcm"}`.
- **Production probes:** `/`, `/editor`, `/templates`, `/create?start=raw`, `/ai`, `/login`, `/account`, `/api/app-version`, `/api/auth/ok`, `/owner-vault`, and `/about` responded; protected pages correctly expose their sign-in boundary where applicable.
- **Browser verification:** homepage, templates, and about pages hydrated in Sandbox browser; editor route rendered the create/start surface; about page visibly rendered `Developed by فيصل المضياني`; no console output/errors were observed on the public pass.
- **Local gates:** `npm ci` completed with Node engine warnings from upstream packages; `npm run typecheck` passed; `npm run build` passed; `npm run check:deploy` passed; `npm run check:auth` passed with the dev server; `npm run env:audit` passed; full `npm test` passed; `npm run lint` had 0 errors and 63 warnings.
- **Changed files for this audit:** `src/lib/brand.ts`, `src/lib/brand.test.ts`, and this report.

## Outstanding items and exact next actions

1. **REQ-01/REQ-12:** run read-only owner/database and R2 verification from the authorized GitHub Environment or Owner Vault; publish only redacted counts/fingerprints. Never paste secret values.
2. **REQ-02/REQ-06/REQ-09/REQ-11:** use a dedicated permitted test account to verify sign-in, session continuity, editor save/reload, template activation, and cloud/offline synchronization without touching customer data.
3. **REQ-07/REQ-10:** run one representative Gemini-generated image and verify editor visibility, save/reload, PNG/PDF/Office exports in an authorized environment. Record provider model and result, not the API key.
4. **REQ-08:** run representative PSD/PDF/DOCX/PPTX/SVG fixtures and record which elements remain editable versus intentionally flattened/unsupported.
5. **REQ-14:** obtain Vercel runtime logs/metrics through an authorized project-scoped capability; public route smoke verification is complete for the released deployment.
6. Existing non-blocking lint warnings should be cleaned in a separate focused change; no unrelated refactor was introduced here.

## Final decision

**PARTIALLY COMPLETED** — the released commit is healthy for public routes and automated gates; the explicit branding defect is fixed, deployed, and verified live. No safe production data changes were made. The remaining partial status is limited to protected database, storage, authenticated editor, AI, import-fidelity, runtime-metrics, and device-specific workflows that require authorized fixtures or physical devices.
