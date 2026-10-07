/**
 * The active identity store, constructed lazily — server-only.
 *
 * The DECISION lives in `./status.ts` (pure, testable, and importable by the
 * client-side configuration report); this module only turns that decision into a
 * concrete backend, and only when an identity operation actually happens.
 * Importing it never opens a connection, reads a credential or touches a disk.
 */
import { join } from "node:path";
import { createFileAuthStore } from "./file";
import { r2AuthStoreFromEnv } from "./r2";
import { AuthStoreUnavailableError, type AuthStore } from "./types";
import {
  authStoreStatus,
  DEFAULT_FILE_AUTH_DIR,
  type AuthStoreStatus,
} from "./status";

export {
  authStoreStatus,
  r2Configured,
  r2MissingVariables,
  isDeployedRuntime,
  DEFAULT_FILE_AUTH_DIR,
  type AuthStoreStatus,
  type AuthStoreKind,
} from "./status";

type EnvLike = Record<string, string | undefined>;

let cached: AuthStore | null | undefined;

/** The active identity store, or null when this deployment has none. */
export async function getAuthStore(env: EnvLike = process.env): Promise<AuthStore | null> {
  if (env !== process.env && cached !== undefined) return cached;
  if (env !== process.env) return build(env);
  cached ??= await build(env);
  return cached;
}

async function build(env: EnvLike): Promise<AuthStore | null> {
  const status: AuthStoreStatus = authStoreStatus(env);
  if (status.kind === "cloudflare-r2") return r2AuthStoreFromEnv();
  if (status.kind === "postgres") {
    const { createPostgresAuthStore } = await import("./postgres");
    return createPostgresAuthStore(async () => {
      const { getSql } = await import("@/lib/db");
      return getSql();
    });
  }
  if (status.kind === "filesystem") {
    return createFileAuthStore(join(process.cwd(), DEFAULT_FILE_AUTH_DIR));
  }
  return null;
}

/** The active store, or a typed failure the HTTP layer turns into a 503. */
export async function requireAuthStore(env: EnvLike = process.env): Promise<AuthStore> {
  const store = await getAuthStore(env);
  if (!store) {
    throw new AuthStoreUnavailableError(authStoreStatus(env).detail ?? undefined);
  }
  return store;
}

/** Test hook: forget the memoised store after changing the environment. */
export function resetAuthStoreCache(): void {
  cached = undefined;
}
