/**
 * Self-hosted Better Auth for THIS app (server-only).
 *
 * Accounts are email + password (primary) and Google (when its credentials are
 * present). The app runs its own Better Auth at `/api/auth/*`, so the session
 * cookie stays on this app's own origin — no third-party identity hop is needed
 * to create an account, sign in, or read a session.
 *
 * Runtime modes:
 *   - Deployed: `BETTER_AUTH_SECRET` + `DATABASE_URL` are required (see
 *     `./config`); sessions persist in Postgres. Google is available when
 *     `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set.
 *   - Sandbox live preview: sessions use the app's embedded PGLite database. Iframe
 *     clients use a bearer token when browser cookie partitioning prevents
 *     session reads.
 *   - Explicit local-only opt-out (`VITE_AUTH_ENABLED=false`): no auth providers;
 *     the dev-user fallback is unavailable once `DATABASE_URL` is configured
 *     (see `verify.server.ts`).
 *
 * THE CONFIGURATION CONTRACT LIVES IN `./config`: which providers exist, which
 * origins are trusted, whether the signing secret is real, and what is missing.
 * This file only wires that contract into Better Auth — so the rules can be
 * unit-tested, reported to the sign-in page, and never drift between the client
 * and the server.
 *
 * NEVER import this from client code — it pulls in `pg` + server-only secrets +
 * server-only Better Auth internals. The client uses `@/lib/auth/client`;
 * components read the user via `@/lib/auth/use-current-user`; server functions get
 * a verified id via `@/lib/auth/middleware`.
 */
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getCookie } from "@tanstack/react-start/server";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import {
  authAllowedHosts,
  authBaseURL,
  authEnvironmentReport,
  authProviderFlags,
  authTrustedOrigins,
  describeAuthEnvironment,
  resolveAuthSecret,
  SESSION_COOKIE_CACHE_SECONDS,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  type AuthEnvironmentReport,
} from "./config";
import { GATE_PROVIDER_ID, gateIdentitySessions } from "./gate-session.server";
import {
  GOOGLE_OAUTH_CALLBACK_PATH,
  GOOGLE_PROVIDER_ID,
} from "./providers";
import { pgliteDialect } from "./pglite-dialect";

// Kick (and share) PGLite bootstrap as soon as the auth server module loads.
void ensureDbReady();

/**
 * Preview secret must outlive module reloads: PGLite (and its session rows) is
 * stored on `globalThis`, so an HMR re-eval of this file must NOT mint a new
 * signing secret or every existing session becomes invalid mid-dev. Process
 * restart clears both the secret and PGLite together.
 *
 * NEVER used on a deployment: `authEnvironmentReport` raises a blocking error
 * when `BETTER_AUTH_SECRET` is missing there (a per-process secret cannot sign
 * cookies another serverless instance will verify).
 */
const globalAuthRef = globalThis as typeof globalThis & {
  __grokAuthPreviewSecret__?: string;
};
function previewAuthSecret(): string {
  globalAuthRef.__grokAuthPreviewSecret__ ??= randomBytes(32).toString("hex");
  return globalAuthRef.__grokAuthPreviewSecret__;
}

// ── Environment contract ─────────────────────────────────────────────────────
// Read once at module load: the report drives both the wiring below and what
// `/api/auth/status` (see `./status-functions`) tells the sign-in page.
const environment: AuthEnvironmentReport = authEnvironmentReport(process.env);

/** Provider report — exported so server code never re-derives it. */
export const authProviders = authProviderFlags(process.env);

/** True when this deployment can actually authenticate anyone. */
export const authConfigured =
  environment.authEnabled &&
  (authProviders.google || authProviders.emailPassword);

/** The full configuration report (names and booleans only — never a secret). */
export const authConfiguration = environment;

// Surface a broken configuration ONCE, loudly, in the server log — with variable
// names only. Never fail the import: a misconfigured auth surface must not take
// the whole product (homepage, editor, library) down with it. `/api/auth/status`
// reports the same list to the sign-in surface so the visitor sees a precise
// explanation instead of a button that does nothing.
if (environment.errors.length) {
  console.error(
    `[auth] configuration incomplete — sign-up/sign-in will not work. ${describeAuthEnvironment(environment)}`,
  );
  for (const problem of environment.errors) console.error(`[auth] ${problem}`);
} else if (environment.warnings.length) {
  for (const warning of environment.warnings) console.warn(`[auth] ${warning}`);
}

/**
 * Signing secret. `BETTER_AUTH_SECRET` always wins when present (switching away
 * from an existing value would invalidate every live session); the per-process
 * development secret is the fallback for local work only, and a deployment
 * without a configured secret is reported as a blocking error above.
 */
const secretResolution = resolveAuthSecret(process.env);
const sessionSecret = secretResolution.value ?? previewAuthSecret();

// This app's own Better Auth origin. `BETTER_AUTH_URL` (or `NASAQ_PUBLIC_URL`)
// pins it — required for a stable Google OAuth redirect URI. Without one, Better
// Auth derives the origin per-request from the (proxied) host, validated against
// the same allowlist that drives trusted origins, so a preview deployment or a
// platform URL works instead of failing every sign-in as an invalid origin.
const explicitBaseURL = authBaseURL(process.env);
const baseURL = explicitBaseURL ?? {
  allowedHosts: authAllowedHosts(process.env),
  // `auto` → trust both http:// and https:// expansions of allowedHosts
  // (preview is https; local dev is http).
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

// Origins Better Auth accepts on credentialed POSTs (sign-up/sign-in, etc.).
// Missing entries here surface as FORBIDDEN "Invalid origin" — the sign-in
// button then does nothing, with only a server-side log to explain it.
const trustedOrigins = authTrustedOrigins(process.env);

const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;

// Real Postgres when `DATABASE_URL` is set (deployed apps), else the app's
// embedded PGLite (preview) via a Kysely dialect — so Better Auth persists to the
// SAME DB as app data, including email/password users. Both use the Better Auth
// schema from the root migrations (0001/0003_auth.sql).
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

/** Session token cookie name — also read by the live-preview popup completion page. */
export const SESSION_TOKEN_COOKIE = "__Host-grok-auth.session_token";

const googleSocialProvider = authProviders.google
  ? {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID?.trim() as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() as string,
        scope: ["openid", "profile", "email"],
        ...(explicitBaseURL
          ? { redirectURI: `${explicitBaseURL}${GOOGLE_OAUTH_CALLBACK_PATH}` }
          : {}),
      },
    }
  : null;

export const auth = betterAuth({
  baseURL,
  secret: sessionSecret,
  database,
  ...(googleSocialProvider ? { socialProviders: googleSocialProvider } : {}),

  // CSRF / origin check for credentialed auth POSTs (email sign-up/sign-in, …).
  // See `authTrustedOrigins` — must cover every host this deployment answers on
  // (canonical URL, platform URLs, preview URLs, custom domains, loopback).
  trustedOrigins,

  // Encrypt Google OAuth tokens at rest and trust Google for account linking.
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: true,
      trustedProviders: [
        GOOGLE_PROVIDER_ID,
        GATE_PROVIDER_ID,
      ],
      requireLocalEmailVerified: false,
    },
  },

  // Session lifetime. The signing secret is what makes these cookies verifiable
  // across serverless instances, and `updateAge` keeps an active visitor signed
  // in without writing a session row on every request.
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
    // Cache the session in the short-lived signed `session_data` cookie so reads
    // (incl. the client's `/get-session`) skip the DB — this shrinks the
    // "loading" window and reduces auth flicker.
    cookieCache: { enabled: true, maxAge: SESSION_COOKIE_CACHE_SECONDS },
  },

  // Email + password accounts in this app's own database. `autoSignIn` makes
  // sign-up end in a real session (the same cookie the sign-in path issues), so
  // a new account is never left in a half-signed-up state. Address verification
  // is intentionally not required: NASAQ sends no email today, and requiring a
  // mail loop that does not exist would lock every new account out.
  ...(authProviders.emailPassword
    ? {
        emailAndPassword: {
          enabled: true,
          autoSignIn: true,
          requireEmailVerification: false,
          minPasswordLength: 8,
          maxPasswordLength: 128,
        },
      }
    : {}),

  // `__Host-` prefixed cookies: the browser REFUSES any same-named cookie that
  // carries a `Domain` attribute, so a sibling `*.grok.me` app cannot "toss" a
  // `Domain=.grok.me` session cookie onto this app. `__Host-` requires Secure +
  // Path=/ + no Domain; Better Auth otherwise uses `__Secure-` (which permits
  // Domain), so we drop its auto prefix (`useSecureCookies: false`) and set
  // Secure + the names ourselves. (Browsers allow Secure cookies on
  // `http://localhost`, so local dev still works.)
  advanced: {
    useSecureCookies: false,
    defaultCookieAttributes: { secure: true, sameSite: "lax", path: "/" },
    cookies: {
      session_token: { name: SESSION_TOKEN_COOKIE },
      session_data: { name: "__Host-grok-auth.session_data" },
      account_data: { name: "__Host-grok-auth.account_data" },
      dont_remember: { name: "__Host-grok-auth.dont_remember" },
    },
  },

  plugins: [
    gateIdentitySessions(),

    // Accept `Authorization: Bearer <session-token>` as an alternative to the
    // cookie. Needed for the LIVE PREVIEW: the app runs in an embedded iframe
    // where cookies are partitioned, so after popup sign-in it authenticates with
    // a bearer token instead (see `client.ts`). The hook only fires when an
    // Authorization header is present, so the cookie path (deployed apps) is
    // unaffected.
    bearer(),

    // Bridges Better Auth's Set-Cookie into TanStack Start responses. MUST be
    // last so it runs after every other plugin's hooks.
    tanstackStartCookies(),
  ],
});

export function readSessionToken(): string | null {
  return getCookie(SESSION_TOKEN_COOKIE) ?? null;
}

// Re-exported for convenience; the array lives in the dependency-free
// `providers.ts` so the client can import it too.
export { SOCIAL_PROVIDERS } from "./providers";
