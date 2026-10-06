/**
 * Public auth-status probe — what the sign-in / sign-up surfaces ask before
 * promising that a button will work.
 *
 * It reports the SHAPE of the configuration, never its values: which providers
 * exist, whether a real signing secret is in place, whether accounts persist in
 * managed Postgres, and the blocking problems by variable NAME. No key, secret,
 * token or stack trace ever crosses this boundary, which is why the same payload
 * is safe to render on a public page.
 *
 * Deliberately public (no `authMiddleware`): a visitor who cannot sign in is
 * exactly the person who needs to read why, and requiring a session to learn
 * that sessions are broken would be circular.
 */
import { createServerFn } from "@tanstack/react-start";
import type { AuthProviderFlags } from "./config";

export type AuthStatus = {
  /** True when the environment can host a complete account flow. */
  ok: boolean;
  /** Blocking problems, in operator language, naming variables only. */
  errors: string[];
  providers: AuthProviderFlags;
  secretConfigured: boolean;
  secretSource: "configured" | "unset" | "weak" | "reused-oauth-secret" | "reused-api-key";
  databaseConfigured: boolean;
  /** The origin Better Auth signs against, when the deployment pins one. */
  baseURL: string | null;
};

export const authStatusFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthStatus> => {
    const { authConfiguration } = await import("./server");
    return {
      ok: authConfiguration.ok,
      errors: authConfiguration.errors,
      providers: authConfiguration.providers,
      secretConfigured:
        authConfiguration.secret === "configured",
      secretSource: authConfiguration.secret,
      databaseConfigured: authConfiguration.database,
      baseURL: authConfiguration.baseURL,
    };
  },
);
