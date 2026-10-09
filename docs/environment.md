# NASAQ environment contract

Every variable the code reads, what it is needed for, and — the part that matters
operationally — **what the product does when it is missing**. Nothing here is
allowed to fail silently: a missing variable either degrades one clearly-labelled
capability or is reported as a blocking error on the sign-in surface and in the
server log.

Two commands keep this document honest, and both are safe to run anywhere:

```bash
npm run env:audit     # fails if the code reads an undocumented variable,
                      # or if anything credential-shaped carries a VITE_ prefix
npm run check:auth    # the auth invariant: first-party wiring, cookie
                      # attributes, secret independence, schema coverage
```

The audit is strict on purpose: a new variable cannot enter the code without
being declared in `.env.example`. It also reports documented-but-unread
variables, because those rot into lies. Platform variables (`VERCEL`, `NODE_ENV`,
`VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, …) and the browser
harness knobs (`HARNESS_VARS` in `scripts/env-audit.mjs`) are exempt by design:
they are injected, not configured.

**Rules that are not negotiable**

- A real secret is never committed to Git and never printed to a log or an error
  message. The app reports variable **names** and booleans, never values.
- Only `VITE_*` names reach the browser bundle, and only non-secret values may
  carry that prefix. `npm run env:audit` fails the moment a credential-shaped
  name gets one.

---

## 1. Required in production (Vercel)

| Variable | Read by | If it is missing |
| --- | --- | --- |
| `VITE_AUTH_ENABLED` | `src/lib/auth/config.ts`, `src/lib/auth/client.ts` | Defaults to `true`. Setting it to `false` disables sign-in entirely; with durable identity storage also set, every authenticated server function rejects (fail closed) instead of sharing one dev user across real data. |
| **Identity storage — `R2_ACCOUNT_ID` (or `R2_ENDPOINT`), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`** | `src/lib/auth/store/` | **Blocking for sign-in only.** Accounts and sessions live in this app's own object storage under the private `_nasaq-auth/` prefix. With **no R2 and no `NASAQ_PRIMARY_DATABASE_URL`**, every page still renders but sign-in answers `503 AUTH_STORE_UNAVAILABLE` with the missing variable NAMES in the log (`auth never falls back to process memory`). `R2_BUCKET_NAME` defaults to the configured bucket; the same credentials already serve the editor's cloud library, so no new service is needed. |
| `NASAQ_PRIMARY_DATABASE_URL` | `src/lib/db.ts`, `src/lib/auth/store/status.ts`, `scripts/migrate.mjs` | **No longer required for sign-in.** It serves the app's own data (licences, projects, requests, admin) and stands in as the identity store when R2 is not configured. Without it, database-backed features fail closed with a clear message instead of pretending to persist, and sign-in falls back to R2. Migrations in `migrations/` apply automatically during `npm run build`; a database that is unreachable or over quota **no longer fails the deploy** — the log says so and the rest of the app ships. |
| `BETTER_AUTH_URL` | `src/lib/auth/config.ts` | Not fatal — the auth service derives the origin per request from the (proxied) host, validated against the same allowlist as trusted origins. Set it to the canonical `https://` origin so the Google OAuth redirect URI and absolute links are stable. A non-https value on a deployment is a blocking error: `__Host-` session cookies are rejected over plain http. |
| `BETTER_AUTH_SECRET` | `src/lib/auth/config.ts`, `src/lib/owner/setup.server.ts` | **Ignored, and no longer needed.** Sessions are opaque 256-bit tokens whose SHA-256 is stored in the identity store — there is no cookie signature to forge and no per-instance state to keep in sync. A deployment that still sets it gets an explicit warning that it does nothing instead of assuming it protects something. Do NOT treat its absence as a misconfiguration. |

Production also relies on variables Vercel injects itself — `VERCEL=1`,
`VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `NODE_ENV`. Never
set these by hand; the auth config reads them to trust this project's own preview
deployments (`https://<project>-*.vercel.app`), never a blanket `*.vercel.app`.

## 2. Required in development

None. `npm run dev` works with no `.env` at all:

- accounts and sessions live in a local file store (`<cwd>/.nasaq-auth/`,
  gitignored) and survive a dev-server restart;
- passwords are hashed with Argon2id (`m=19456, t=2, p=1`) and sessions are
  random opaque tokens — no signing secret exists to configure;
- email/password sign-up and sign-in are fully functional, which is what the
  HTTP end-to-end check (`npm run test:auth:e2e`) exercises.

`npm run preview` serves the built output with `VERCEL=1` set, i.e. as a
deployed runtime: with no R2 and no `NASAQ_PRIMARY_DATABASE_URL` it deliberately refuses
sign-in (503) instead of pretending a read-only, per-invocation filesystem is
storage. Use the dev server (or configure a store) to exercise sign-in.

Useful for local work, none required:

| Variable | Effect |
| --- | --- |
| `NASAQ_PRIMARY_DATABASE_URL` | Runs local dev against real Postgres instead of PGLite. |
| `R2_*` | Runs local dev against real object storage for both assets and identity. |
| `GEMINI_API_KEY` | Turns the real AI surfaces on locally (see §3). Without it every AI call answers `not_configured` — clearly, never with fake content. |

## 3. Optional

Everything here is read by the code and safely absent. "Clearly absent" is the
contract: the capability reports `not_configured` (or the licence/admin path
explains what is needed) instead of failing obscurely.

| Variable | Capability | If unset |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in | Provider is simply not offered (`authProviderFlags`); email/password still works. Both are needed — a half-configured pair counts as absent. |
| `GEMINI_API_KEY` | Every AI feature: report drafts, design briefs, selection transforms, image analysis, template studio | Each AI server function returns `{ok:false, code:"not_configured"}` with an Arabic message. Verified end to end by `npm run test:ai:e2e`. |
| `NASAQ_AI_MODEL` | Model id for the Gemini boundary (`src/lib/ai/provider.server.ts`) | Defaults to `gemini-2.5-flash`. A 404 (`invalid_model`) retries `gemini-3.5-flash` then `gemini-3.1-flash-lite`. Auth, quota, and billing errors do not switch models. The key is sent as `x-goog-api-key`, never in the URL. |
| `NASAQ_PUBLIC_URL` | Owner diagnostics ping; public-origin fallbacks | Falls back to `VERCEL_PROJECT_PRODUCTION_URL` / `BETTER_AUTH_URL`. |
| `NASAQ_TRUSTED_ORIGINS` | Extra origins allowed to POST credentials (custom domains, staging) | Only this deployment's own hosts are trusted. A credential POST from another origin is refused (`INVALID_ORIGIN`), which `npm run test:auth:e2e` asserts. |
| `NASAQ_ALLOWED_HOSTS` | Extra host patterns for the per-request base URL | Only hostnames derived from `VERCEL_*` / configured origins are accepted. |
| `NASAQ_STRICT_ENV=1` | Applies the production requirements on a self-hosted runtime that does not set `VERCEL=1` | Ignored. |
| `GUMROAD_ACCESS_TOKEN` | The only payment provider — verifies every sale/subscription before licence issuance | The Gumroad status card reports exactly what is missing; no fake activation. |
| `GUMROAD_PRODUCT_ID`, `GUMROAD_PRODUCT_PERMALINK`, `GUMROAD_STORE_BASE_URL`, `GUMROAD_TIER_*_NAME` | Product/tier resolution for the same flow | Product id is resolved from `GET /v2/products` by permalink; tier names default to the shipped ones. |
| `KEYGEN_ACCOUNT_SLUG`, `KEYGEN_PRODUCT_ID`, `KEYGEN_API_TOKEN`, `KEYGEN_PUBLIC_KEY`, `KEYGEN_POLICY_*_ID` | The licensing authority (activation, validation, suspension, trials) | Licence calls return a clear configuration error; the editor keeps working offline and the free/trial path is unaffected. `KEYGEN_POLICY_*_ID` names are read dynamically, so the audit matches them by prefix. |
| `NASAQ_OWNER_ID`, `NASAQ_OWNER_EMAIL`, `NASAQ_SUPER_ADMIN_IDS`, `NASAQ_SUPER_ADMIN_EMAILS`, `NASAQ_ADMIN_USER_IDS` | Owner/admin identity (licence administration) | No one is an administrator; nothing else changes. These are identities, not secrets — they still belong in the server environment only. |
| `NASAQ_LEGACY_ACCOUNT_ADOPTION` | Optional. `off` disables the read-only lookup that adopts pre-first-party (Better Auth) accounts under their ORIGINAL id when the holder proves the old password or a Google-verified address | Default (unset): adoption on. With `off`, pre-migration users must register again and lose the link to roles/licences/files keyed by their old id. |
| `NASAQ_OWNER_BINDING` | Optional. `off` disables the one-time repair that re-binds administrator authority to the account the owner actually signs in with — and with it the ownership reconciliation that follows the same binding (licences, subscriptions, licence claims, payment history, trials, templates, cloud projects and storage rows left on the owner's orphaned pre-migration id are moved onto the account they sign in with) | Default (unset): repair on. With `off`, an owner whose account id changed in the first-party auth migration stays locked out until `NASAQ_OWNER_ID` is set to their current id by hand. The repair only runs when no account that can still sign in holds administrator authority, so it can never take authority away from a live administrator; the reconciliation only ever moves rows owned by ids the binding proved are that same owner's and that the identity store cannot resolve, so no live account's records are touched. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT` | Cloudflare R2 asset storage (cloud library) | Storage calls return `not_configured`; the editor keeps its local-first library, so work is never lost. Verify with `npm run storage:verify` (reports names, never values). |
| `VITE_NASAQ_BG_MODEL_PUBLIC_PATH` | Self-hosted background-removal model weights | The public model CDN is used. Image tools run in the browser either way; no image leaves the device. |
| `GROK_PROJECT_ID`, `GROK_GATE_ORIGIN`, `GROK_CONNECTORS_URL`, `GROK_CONNECTOR_ACCESS_TOKEN` | The Grok platform gate/connector (injected by the Grok deployer only) | Inert. On Vercel either the app's own session or the built-in gate identity path is used. |

## 4. Server-only secrets

Never exposed to the browser, never logged, never committed:

`NASAQ_PRIMARY_DATABASE_URL`, `SOURCE_DATABASE_URL` (cutover only), `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`,
`GUMROAD_ACCESS_TOKEN`, `KEYGEN_API_TOKEN`, `KEYGEN_PUBLIC_KEY`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `GROK_CONNECTOR_ACCESS_TOKEN`,
`NASAQ_COMPAT_KEY` (sample key for `scripts/license-compat-check.mjs`).

None of them may be given a `VITE_` prefix: Vite inlines those into the browser
bundle by construction, so the leak would be silent and permanent in shipped
assets. `npm run env:audit` treats `VITE_` + a credential-shaped name as a hard
failure.

## 5. Public / client variables

`VITE_AUTH_ENABLED`, `VITE_PUBLIC_HOSTNAME`, `VITE_STUN_URLS`,
`VITE_NASAQ_BG_MODEL_PUBLIC_PATH`.

`VITE_OG_SERVICE_URL`, `VITE_PROJECT_ID`, `X_CREATOR`, `X_CREATOR_ID` are
public values injected by the Grok deployer for the PWA metadata scripts; on
Vercel they are simply absent.

---

## Verification map

| Command | Proves |
| --- | --- |
| `npm run env:audit` | Every read variable is documented; no secret carries `VITE_`. |
| `npm run check:auth` | Auth wiring: first-party endpoints, secret independence, cookie attributes, session config, schema coverage. |
| `npm run test:auth` | Unit contract: environment report, credential validation, error mapping, account normalization. |
| `npm run test:auth:e2e` | Real HTTP account flow: sign-up → session → duplicate refused → wrong password refused → foreign origin refused → sign-in → protected route with/without session → sign-out. |
| `npm run test:ai:e2e` | Every AI server function answers **401** without a session and reaches the handler with one — returning either a real draft or a typed failure, never a fake success. |
| `npm run storage:verify` | R2 round trip (upload, read, signed URL, delete) when the five `R2_*` names are set. |
