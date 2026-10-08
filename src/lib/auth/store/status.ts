/**
 * Which durable backend serves identity — the DECISION, as a pure function.
 *
 * Split out of `index.server.ts` on purpose: this module imports nothing, so the
 * environment report can be computed in the browser bundle (the sign-in page
 * shows the operator notice) and in node:test without dragging `node:crypto`
 * or an object-storage client into either.
 *
 * ORDER OF PREFERENCE (deliberate, and reported to the operator verbatim):
 *
 *   1. **Cloudflare R2** (`R2_*`) — the deployment's private object store. It is
 *      already the app's durable home for editor assets, it needs no database,
 *      and it keeps working while the application database is over quota,
 *      suspended or mid-migration. That is the whole point of this work: sign-in
 *      must not inherit the database's availability.
 *   2. **Postgres** (`NASAQ_PRIMARY_DATABASE_URL`) — used only when R2 is not configured. The
 *      same `AuthStore` contract, so nothing above the storage layer changes.
 *   3. **Local filesystem** — development and tests only, refused outright on a
 *      deployed runtime (`VERCEL=1` / `NASAQ_STRICT_ENV=1`), where the disk is
 *      read-only and per-invocation.
 *   4. **Nothing** — a deployment with neither backend fails closed with an
 *      actionable message naming the missing variables. It NEVER falls back to
 *      process memory: a serverless instance would forget every account between
 *      two requests, which reads to a visitor as "my account vanished".
 */

export type AuthStoreKind = "cloudflare-r2" | "postgres" | "filesystem";

export type AuthStoreStatus = {
  /** The backend this environment selects, or null when there is none. */
  kind: AuthStoreKind | null;
  /** True when identity survives a process restart (every real backend). */
  durable: boolean;
  /** True when accounts can be created and read at all. */
  configured: boolean;
  /** Variable NAMES still missing — never a value. */
  missing: string[];
  /** Operator-facing explanation when `configured` is false or degraded. */
  detail: string | null;
};

type EnvLike = Record<string, string | undefined>;

/** Local filesystem location used by development and tests. */
export const DEFAULT_FILE_AUTH_DIR = ".nasaq-auth";

function readEnv(env: EnvLike, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

/** True when a deployment runtime is in effect (no durable local disk). */
export function isDeployedRuntime(env: EnvLike = process.env): boolean {
  return readEnv(env, "VERCEL") === "1" || readEnv(env, "NASAQ_STRICT_ENV") === "1";
}

/** R2 variable NAMES still missing for object storage to be usable. */
export function r2MissingVariables(env: EnvLike = process.env): string[] {
  const missing: string[] = [];
  if (!readEnv(env, "R2_ACCOUNT_ID") && !readEnv(env, "R2_ENDPOINT")) {
    missing.push("R2_ACCOUNT_ID (or R2_ENDPOINT)");
  }
  if (!readEnv(env, "R2_ACCESS_KEY_ID")) missing.push("R2_ACCESS_KEY_ID");
  if (!readEnv(env, "R2_SECRET_ACCESS_KEY")) missing.push("R2_SECRET_ACCESS_KEY");
  return missing;
}

/** True when every R2 variable this project documents is present. */
export function r2Configured(env: EnvLike = process.env): boolean {
  return r2MissingVariables(env).length === 0;
}

/** True when a Postgres URL is available as the fallback backend. */
export function postgresConfigured(env: EnvLike = process.env): boolean {
  return Boolean(readEnv(env, "NASAQ_PRIMARY_DATABASE_URL"));
}

/** The status a deployment reports on the sign-in surface and in its logs. */
export function authStoreStatus(env: EnvLike = process.env): AuthStoreStatus {
  if (r2Configured(env)) {
    return {
      kind: "cloudflare-r2",
      durable: true,
      configured: true,
      missing: [],
      detail: null,
    };
  }
  if (postgresConfigured(env)) {
    return {
      kind: "postgres",
      durable: true,
      configured: true,
      missing: r2MissingVariables(env),
      detail: null,
    };
  }
  if (!isDeployedRuntime(env)) {
    return {
      kind: "filesystem",
      durable: true,
      configured: true,
      missing: r2MissingVariables(env),
      detail:
        "local development store (.nasaq-auth) — a deployment must configure durable identity storage.",
    };
  }
  return {
    kind: null,
    durable: false,
    configured: false,
    missing: r2MissingVariables(env),
    detail:
      "Durable auth storage is not configured — set R2_ACCOUNT_ID (or R2_ENDPOINT), " +
      "R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, or provide NASAQ_PRIMARY_DATABASE_URL. " +
      "Authentication never falls back to process memory.",
  };
}
