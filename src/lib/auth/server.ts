/**
 * Auth environment facade (server-only, and deliberately thin).
 *
 * This module answers ONE question — "is sign-in usable in this deployment, and
 * what exactly is missing if not" — from the environment, once, at load. It
 * holds no session state, opens no connection, and imports no provider SDK:
 * the actual authentication lives in `./service.server` (identity + sessions)
 * and `./http.server` (the `/api/auth/*` surface).
 *
 * Importing this file must NEVER throw. The previous implementation built a
 * third-party auth instance here, read a signing secret, and built an adapter at
 * module load; when a variable was missing the import failed and took the whole
 * site down with it — including pages that have nothing to do with sign-in.
 * Everything expensive (the identity store, the database) is constructed lazily
 * inside the request that first needs it.
 *
 * NEVER import this from client code — the environment report is computed in
 * the browser from `./store/status` (pure) and delivered to the UI through
 * `./status-functions`.
 */
import {
  authEnvironmentReport,
  authProviderFlags,
  describeAuthEnvironment,
  type AuthEnvironmentReport,
} from "./config";

// ── Environment contract ─────────────────────────────────────────────────────
// Read once: the report drives both the wiring below and what `/api/auth/status`
// (see `./status-functions`) tells the sign-in page.
const environment: AuthEnvironmentReport = authEnvironmentReport(process.env);

/** Provider report — exported so server code never re-derives it. */
export const authProviders = authProviderFlags(process.env);

/** True when this deployment can actually authenticate anyone. */
export const authConfigured = environment.authEnabled && environment.ok;

/** The full configuration report (names and booleans only — never a secret). */
export const authConfiguration = environment;

/** Which durable backend serves identity, and whether it exists at all. */
export const authStorage = environment.storage;

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

// Re-exported for convenience; the array lives in the dependency-free
// `providers.ts` so the client can import it too.
export { SOCIAL_PROVIDERS } from "./providers";
