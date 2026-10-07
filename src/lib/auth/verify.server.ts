import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { gateIdentityEnabled } from "./gate-identity.server";
import { auth, authConfigured } from "./server";
import { objectStorageConfigured } from "@/lib/storage/r2.server";

/**
 * Server-side session resolution (server-only).
 *
 * Because this app runs its OWN Better Auth at same-origin `/api/auth/*`, the
 * session cookie is sent with every request to this app — server functions AND
 * SSR loaders included. So we resolve the user straight from the request cookies
 * via `auth.api.getSession` (no client-minted JWT needed). Never trust a
 * client-supplied user id — only the result of this verification.
 */

/** True when a real database is configured server-side. */
const authStorageConfigured = objectStorageConfigured();

/** Re-export so callers can branch on it without importing `server.ts`. */
export { authConfigured };

if (authStorageConfigured && !authConfigured) {
  console.error(
    "[auth] durable auth storage is set but auth is disabled (VITE_AUTH_ENABLED=false) " +
      "— requireUserId() will reject every request (fail closed) rather than " +
      "share one dev user on a real database.",
  );
}

/** Dev fallback user id, used only when auth is disabled (VITE_AUTH_ENABLED=false). */
export const DEV_USER_ID = "dev-user";

/**
 * Thrown by `requireUserId` when the caller has no valid session. Carries
 * `status: 401`; the message is a stable contract — match
 * `err.message === "Unauthorized"` client-side to send the visitor to sign-in.
 */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * Reject an unauthenticated server call, and make the rejection READ as 401.
 *
 * TanStack Start serialises a thrown error with
 * `status = ALS response.status ?? 500`, so a signed-out call to an
 * authenticated server function used to answer **HTTP 500** — indistinguishable
 * from a crash in the network tab, in monitoring, and in the deploy logs (the
 * exact failure `forbidden.server.ts` documents for 403). Setting the status
 * first gives the client and the operator the true diagnosis; the throw below
 * still carries the stable `UnauthorizedError` contract.
 */
export function denyUnauthorized(): never {
  try {
    // Outside a Start request context (a direct call in a test, an offline
    // script) there is no response to decorate — the throw is the part that
    // matters, so never let the decoration replace it.
    setResponseStatus(401, "Unauthorized");
  } catch {
    /* keep throwing */
  }
  throw new UnauthorizedError();
}

export type VerifiedUser = {
  id: string;
  email: string | null;
  /** Account-row verification status, never supplied by the client. */
  emailVerified: boolean;
};

/**
 * Resolve the signed-in user from the current request, or `null` when auth isn't
 * configured / nobody is signed in. Safe to call from server functions and SSR
 * loaders.
 *
 * `bearerToken` is for the LIVE PREVIEW: the app runs in a partitioned iframe
 * whose cookies don't reach the server, so `authMiddleware` forwards the session
 * as a bearer token, which we present as `Authorization: Bearer …` (the `bearer`
 * plugin resolves it). When deployed no token is passed and the cookie is used.
 */
export async function getSessionUser(
  bearerToken?: string,
): Promise<VerifiedUser | null> {
  if (!authConfigured && !gateIdentityEnabled()) return null;
  const request = getRequest();
  if (!request) return null;
  let headers = request.headers;
  if (bearerToken) {
    headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? null,
    emailVerified: session.user.emailVerified === true,
  };
}

/**
 * Resolve the current user id for a server function, or throw when unauthorized.
 * Prefer `authMiddleware` (`./middleware`), which calls this for you.
 * - Auth enabled -> the verified session user id; throws
 *   `UnauthorizedError` when signed out. Works in the sandbox preview too (real
 *   sign-in via the baked preview client).
 * - Auth disabled (`VITE_AUTH_ENABLED=false`) + `DATABASE_URL` set -> throw (fail
 *   closed): one shared dev user on a real database would let every visitor
 *   read/write everyone's rows.
 * - Auth disabled + no database -> the shared dev user id.
 */
export async function requireUserId(bearerToken?: string): Promise<string> {
  if (!authConfigured && !gateIdentityEnabled()) {
    if (authStorageConfigured) {
      throw new Error(
        "Auth is disabled (VITE_AUTH_ENABLED=false) but durable auth storage is set — " +
          "refusing to fall back to the shared dev user against a real database.",
      );
    }
    return DEV_USER_ID;
  }
  const user = await getSessionUser(bearerToken);
  if (!user) denyUnauthorized();
  return user.id;
}
