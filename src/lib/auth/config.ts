/**
 * Auth configuration contract — the ONE place that answers, from the
 * environment alone:
 *
 *   · which sign-in providers this deployment offers,
 *   · which origins it answers on (canonical base URL + trusted origins),
 *   · whether a real signing secret exists (and whether it is independent of
 *     every OAuth/API secret),
 *   · and whether the environment is complete enough to promise a working
 *     sign-up → sign-in → session flow.
 *
 * It is deliberately dependency-free: no third-party auth import, no `process.env`
 * read at module scope. Callers pass the environment record in, so the same
 * rules can be unit-tested and reused by the deploy-time checks without a
 * server running.
 *
 * WHY THIS MODULE EXISTS (the failures it prevents)
 * -------------------------------------------------
 * 1. `authConfigured` used to mean "Google OAuth credentials are present". A
 *    deployment with only email/password enabled therefore reported NO auth
 *    configured, and `verify.server.ts` returned `null` for a perfectly valid
 *    session — the app rendered signed-out to every server function (AI,
 *    licences, projects) while the browser held a real session cookie.
 * 2. The signing secret fell back to a random per-process value with no error.
 *    On serverless, every instance then signed its own cookies, so the session
 *    did not survive the next request — "login works, then you are logged out
 *    again" — with nothing in the logs to explain it.
 * 3. Trusted origins were built from `BETTER_AUTH_URL` alone. Reaching the same
 *    deployment through its platform URL (`*.vercel.app`), a preview URL, or a
 *    custom domain made every credentialed POST fail as `INVALID_ORIGIN`, which
 *    the user experiences as "sign-in is broken".
 *
 * NOTHING here returns or logs a secret VALUE. Reports carry variable names and
 * booleans only, so they are safe to print and safe to send to the sign-in page.
 */

import { emailAndPasswordEnabled } from "./email-password";
import {
  LIVE_PREVIEW_ALLOWED_HOSTS,
  LIVE_PREVIEW_TRUSTED_ORIGINS,
} from "./preview-host";
import {
  authStoreStatus,
  isDeployedRuntime,
  type AuthStoreStatus,
} from "./store/status";

/** The environment surface this module reads (`process.env` shape). */
export type AuthEnvironment = Record<string, string | undefined>;

/** Which sign-in providers are actually usable in this environment. */
export type AuthProviderFlags = {
  /** Google OAuth (client id + secret both present). */
  google: boolean;
  /** Email + password accounts handled by this app's own auth service. */
  emailPassword: boolean;
};

/** How the session-signing secret was resolved. Never carries the value. */
export type AuthSecretStatus =
  | "configured"
  | "unset"
  | "weak"
  | "reused-oauth-secret"
  | "reused-api-key";

export type AuthEnvironmentReport = {
  /** Sign-in is offered at all (`VITE_AUTH_ENABLED !== "false"`). */
  authEnabled: boolean;
  /** Running on a real deployment (Vercel / strict-env), not a dev machine. */
  deployed: boolean;
  /** True when sign-up → sign-in → persisted session is expected to work. */
  ok: boolean;
  providers: AuthProviderFlags;
  /** Which durable backend serves identity, and whether one exists at all. */
  storage: AuthStoreStatus;
  /**
   * `BETTER_AUTH_SECRET` (or its absence). Sessions are opaque server-side
   * tokens now, not signed cookies, so this value plays NO part in whether a
   * session works — it is reported only so an operator can see that a leftover
   * variable is being ignored rather than silently doing something.
   */
  secret: AuthSecretStatus;
  /** The absolute origin the auth service signs/redirects against, when known. */
  baseURL: string | null;
  /** Origins (and wildcard patterns) that may POST credentials to this app. */
  trustedOrigins: string[];
  /** Blocking problems — each one breaks a real user-visible flow. */
  errors: string[];
  /** Non-blocking, but the operator should know (e.g. dev-only fallbacks). */
  warnings: string[];
};

/** Minimum length accepted for `BETTER_AUTH_SECRET` on a deployment. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Secrets that must never double as the session secret. Reusing one value for
 * two purposes means rotating (or leaking) either one silently invalidates the
 * other — and a leaked OAuth client secret would let an attacker forge
 * session cookies.
 */
export const SECRET_ALIAS_VARS = [
  "GOOGLE_CLIENT_SECRET",
  "GEMINI_API_KEY",
  "KEYGEN_API_TOKEN",
  "GUMROAD_ACCESS_TOKEN",
  "R2_SECRET_ACCESS_KEY",
] as const;

/** Local development origins (the `npm run dev` port contract). */
export const LOCAL_DEV_ORIGINS: readonly string[] = [
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "http://[::1]:8080",
];

/** Local hostnames accepted by the dynamic base URL. */
export const LOCAL_DEV_HOSTS: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "[::1]",
];

/** Session lifetime: 30 days, refreshed at most once a day (sliding). */
export const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
/** Signed session cookie-cache window (skips a DB read on the client fetch). */
export const SESSION_COOKIE_CACHE_SECONDS = 300;

/** Read an env var, treating empty/whitespace as unset. */
export function readEnv(env: AuthEnvironment, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Split a comma/space separated env list, dropping blanks and duplicates. */
export function parseEnvList(value: string | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  for (const entry of value.split(/[,\s]+/)) {
    const item = entry.trim();
    if (item) seen.add(item);
  }
  return [...seen];
}

/** `https://host/path` → `https://host`; returns null for anything unparseable. */
export function originOf(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** `https://host/path` or `host` → `host` (no scheme, no path); null if invalid. */
export function hostOf(value: string | undefined): string | null {
  const origin = originOf(value);
  if (!origin) return null;
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

/** Vercel injects the production hostname here; a bare host, no scheme. */
const VERCEL_HOST_VARS = ["VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"] as const;

/** Explicit operator overrides, highest priority last. */
const PUBLIC_URL_VARS = ["BETTER_AUTH_URL", "NASAQ_PUBLIC_URL"] as const;

/**
 * The hosts this deployment legitimately answers on, in priority order:
 * an explicit public URL, then the Vercel-assigned hosts, then the live-preview
 * hosts (Arena's `*.e2b.app` iframe origin) and local development.
 */
export function deploymentHosts(env: AuthEnvironment): string[] {
  const hosts: string[] = [];
  const push = (value: string | undefined) => {
    const host = hostOf(value);
    if (host && !hosts.includes(host)) hosts.push(host);
  };
  for (const key of PUBLIC_URL_VARS) push(readEnv(env, key));
  for (const key of VERCEL_HOST_VARS) push(readEnv(env, key));
  for (const pattern of LIVE_PREVIEW_ALLOWED_HOSTS) hosts.push(pattern);
  for (const host of LOCAL_DEV_HOSTS) if (!hosts.includes(host)) hosts.push(host);
  return hosts;
}

/**
 * The origin the auth service signs against and redirects back to.
 *
 * `BETTER_AUTH_URL` wins when set (Google OAuth requires a redirect URI that is
 * registered exactly, so a fixed public origin is the correct production
 * choice). Without it, the auth service derives the origin per request from the
 * (proxied) host, validated against `authAllowedHosts()`.
 */
export function authBaseURL(env: AuthEnvironment): string | undefined {
  for (const key of PUBLIC_URL_VARS) {
    const origin = originOf(readEnv(env, key));
    if (origin) return origin;
  }
  return undefined;
}

/**
 * Wildcard-safe origin patterns for Vercel preview deployments of THIS project
 * (`<project>-<git-branch-or-hash>-<team>.vercel.app`).
 *
 * Derived from the project's own production hostname rather than a blanket
 * `*.vercel.app`: trusting every Vercel site on the internet would let an
 * unrelated deployment POST credentials to this app.
 */
export function vercelPreviewOriginPatterns(env: AuthEnvironment): string[] {
  const projectHost =
    hostOf(readEnv(env, "VERCEL_PROJECT_PRODUCTION_URL")) ??
    hostOf(readEnv(env, "BETTER_AUTH_URL")) ??
    hostOf(readEnv(env, "NASAQ_PUBLIC_URL")) ??
    hostOf(readEnv(env, "VERCEL_URL"));
  if (!projectHost) return [];
  const hostname = projectHost.split(":")[0] ?? "";
  if (!hostname.endsWith(".vercel.app")) return [];
  const slug = hostname.slice(0, -".vercel.app".length);
  if (!slug) return [];
  return [`https://${slug}.vercel.app`, `https://${slug}-*.vercel.app`];
}

/**
 * Origins the auth service accepts on credentialed requests (sign-up, sign-in, …).
 * A missing entry surfaces to the user as `INVALID_ORIGIN` on the auth POST —
 * which looks exactly like "the login button does nothing".
 *
 * Accepts wildcard patterns (`NASAQ_TRUSTED_ORIGINS=https://*.example.com`) and
 * bare hostnames (`nasaq.app` → both `http` and `https` forms).
 */
export function authTrustedOrigins(env: AuthEnvironment): string[] {
  const origins = new Set<string>();
  const add = (value: string | undefined) => {
    const origin = originOf(value);
    if (origin) origins.add(origin);
  };
  const addPattern = (entry: string) => {
    const value = entry.trim();
    if (!value) return;
    if (value.includes("*") || value.includes("?")) {
      // A bare pattern (`*.example.com`) is trusted on both schemes; a pattern
      // that names its scheme is kept exactly as written.
      if (value.includes("://")) origins.add(value.replace(/\/+$/, ""));
      else {
        origins.add(`https://${value}`);
        origins.add(`http://${value}`);
      }
      return;
    }
    const origin = originOf(value);
    if (origin) origins.add(origin);
    else if (!value.includes("://")) {
      // Bare host with no scheme: trust both forms.
      origins.add(`https://${value}`);
      origins.add(`http://${value}`);
    }
  };

  for (const key of PUBLIC_URL_VARS) add(readEnv(env, key));
  for (const key of VERCEL_HOST_VARS) {
    const host = hostOf(readEnv(env, key));
    if (host) {
      origins.add(`https://${host}`);
      if (host.startsWith("localhost")) origins.add(`http://${host}`);
    }
  }
  for (const pattern of vercelPreviewOriginPatterns(env)) origins.add(pattern);
  for (const origin of LIVE_PREVIEW_TRUSTED_ORIGINS) origins.add(origin);
  for (const origin of LOCAL_DEV_ORIGINS) origins.add(origin);
  for (const entry of parseEnvList(readEnv(env, "NASAQ_TRUSTED_ORIGINS"))) {
    addPattern(entry);
  }
  return [...origins];
}

/** Host patterns for the per-request (dynamic) base URL. */
export function authAllowedHosts(env: AuthEnvironment): string[] {
  const hosts = new Set<string>();
  for (const host of deploymentHosts(env)) hosts.add(host);
  for (const pattern of vercelPreviewOriginPatterns(env)) {
    hosts.add(pattern.replace(/^https?:\/\//, ""));
  }
  for (const entry of parseEnvList(readEnv(env, "NASAQ_ALLOWED_HOSTS"))) {
    hosts.add(entry.replace(/^https?:\/\//, "").replace(/\/+$/, ""));
  }
  return [...hosts];
}

/** Resolve the session signing secret and classify how it was obtained. */
export function resolveAuthSecret(env: AuthEnvironment): {
  value: string | null;
  status: AuthSecretStatus;
} {
  const value = readEnv(env, "BETTER_AUTH_SECRET");
  if (!value) return { value: null, status: "unset" };
  for (const key of SECRET_ALIAS_VARS) {
    if (readEnv(env, key) === value) {
      return {
        value,
        status: key === "GOOGLE_CLIENT_SECRET" ? "reused-oauth-secret" : "reused-api-key",
      };
    }
  }
  if (value.length < MIN_SECRET_LENGTH) return { value, status: "weak" };
  return { value, status: "configured" };
}

/** Which providers this environment can actually run. */
export function authProviderFlags(
  env: AuthEnvironment,
  emailPassword: boolean = emailAndPasswordEnabled,
): AuthProviderFlags {
  return {
    google: Boolean(
      readEnv(env, "GOOGLE_CLIENT_ID") && readEnv(env, "GOOGLE_CLIENT_SECRET"),
    ),
    emailPassword,
  };
}

/** Sign-in is offered unless the deployment explicitly disables it. */
export function authEnabled(env: AuthEnvironment): boolean {
  return readEnv(env, "VITE_AUTH_ENABLED") !== "false";
}

/**
 * True for a real deployment (Vercel injects `VERCEL=1` in build and function
 * runtimes). `NASAQ_STRICT_ENV=1` opts a self-hosted production runtime into the
 * same requirements.
 *
 * Re-exported from the identity-store decision so callers keep one import site,
 * and so there is exactly ONE definition of "deployed" in the codebase.
 */
export { isDeployedRuntime };

/**
 * The environment contract, evaluated.
 *
 * `errors` are conditions under which a user-visible auth flow is broken
 * (accounts cannot be persisted, no provider exists, the public URL would make
 * `__Host-` cookies undeliverable). `warnings` describe working-but-noteworthy
 * states such as a dev-only store or a leftover `BETTER_AUTH_SECRET`.
 */
export function authEnvironmentReport(
  env: AuthEnvironment,
  emailPassword: boolean = emailAndPasswordEnabled,
): AuthEnvironmentReport {
  const enabled = authEnabled(env);
  const deployed = isDeployedRuntime(env);
  const providers = authProviderFlags(env, emailPassword);
  const storage = authStoreStatus(env);
  const secret = resolveAuthSecret(env);
  const baseURL = authBaseURL(env) ?? null;
  const trustedOrigins = authTrustedOrigins(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (enabled) {
    if (!providers.google && !providers.emailPassword) {
      errors.push(
        "No sign-in provider is configured: set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET, " +
          "or keep the email/password provider enabled (src/lib/auth/email-password.ts).",
      );
    }
    if (!storage.configured) {
      if (deployed) {
        errors.push(
          `Durable auth storage is not configured (missing: ${storage.missing.join(", ")}). ` +
            "Set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, " +
            "or provide NASAQ_PRIMARY_DATABASE_URL; auth never falls back to process memory.",
        );
      } else {
        warnings.push(
          "R2 auth storage is not set — durable account and session tests require the R2 variables.",
        );
      }
    } else if (storage.durable && !deployed && storage.kind !== "filesystem") {
      warnings.push(
        `Auth storage backend: ${storage.kind}. Development uses the local filesystem store ` +
          "when R2 is absent; a deployment requires a durable backend.",
      );
    }
    /* `BETTER_AUTH_SECRET` signed cookies for the previous implementation. This
       one stores opaque server-side session tokens, so the variable no longer
       affects whether a session works. Say so instead of demanding it. */
    if (secret.status === "unset") {
      if (deployed) {
        warnings.push(
          "BETTER_AUTH_SECRET is not set. It is no longer required — sessions are opaque " +
            "tokens verified against durable storage — so this is informational only.",
        );
      }
    } else if (deployed && secret.status !== "configured") {
      warnings.push(
        "BETTER_AUTH_SECRET is present but unused by this implementation " +
          `(status: ${secret.status}). Remove it to avoid implying it still signs sessions.`,
      );
    }
    if (baseURL) {
      const https = baseURL.startsWith("https://");
      const loopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(baseURL);
      if (!https && !loopback) {
        if (deployed) {
          errors.push(
            `BETTER_AUTH_URL (${baseURL}) must use https on a deployment: __Host- session ` +
              "cookies are rejected over plain http, so no session is ever stored.",
          );
        } else {
          warnings.push(
            `BETTER_AUTH_URL (${baseURL}) is not https — session cookies are only sent over ` +
              "https (local loopback is exempt).",
          );
        }
      }
    } else if (deployed) {
      warnings.push(
        "BETTER_AUTH_URL is not set — the origin is derived from the request host. " +
          "Set it to the canonical public origin so OAuth redirect URIs stay stable.",
      );
    }
  }

  return {
    authEnabled: enabled,
    deployed,
    ok: errors.length === 0,
    providers,
    storage,
    secret: secret.status,
    baseURL,
    trustedOrigins,
    errors,
    warnings,
  };
}

/** One-line operator summary. Contains variable NAMES only — never values. */
export function describeAuthEnvironment(report: AuthEnvironmentReport): string {
  const providers = [
    report.providers.google ? "google" : null,
    report.providers.emailPassword ? "email-password" : null,
  ]
    .filter(Boolean)
    .join("+");
  return (
    `[auth] enabled=${report.authEnabled} providers=${providers || "none"} ` +
    `storage=${report.storage.kind ?? "none"}${report.storage.durable ? "" : "!"} ` +
    `secret=${report.secret} ` +
    `baseURL=${report.baseURL ?? "(per-request)"} origins=${report.trustedOrigins.length}`
  );
}
