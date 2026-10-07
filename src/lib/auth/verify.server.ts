import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { gateIdentityEnabled } from "./gate-identity.server";
import { resolveRequestSession } from "./request-session.server";
import { authConfigured } from "./server";
import { authStoreStatus } from "./store/status";

/**
 * Server-side session resolution (server-only).
 *
 * This app runs its OWN first-party auth at same-origin `/api/auth/*`, so the
 * session cookie rides along on every request to this app — server functions
 * and SSR loaders included. So we resolve the user straight from the request
 * (cookie, or the live preview's bearer token), with no client-minted identity
 * of any kind. Never trust a client-supplied user id — only the result of this
 * verification.
 *
 * Import-time is safe by construction: nothing here reads a credential or opens
 * a connection, so a missing environment variable degrades sign-in instead of
 * crashing the module graph (pages that need no identity keep rendering).
 */

/** True when a REAL (non-development) identity backend is configured. */
function realAuthStorageConfigured(): boolean {
  const status = authStoreStatus();
  return status.configured && status.kind !== null && status.kind !== "filesystem";
}

/** Re-export so callers can branch on it without importing `server.ts`. */
export { authConfigured };

if (realAuthStorageConfigured() && !authConfigured) {
  console.error(
    "[auth] durable auth storage is set but auth is disabled (VITE_AUTH_ENABLED=false) " +
      "— requireUserId() will reject every request (fail closed) rather than " +
      "share one dev user on a real backend.",
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
 * as a bearer token. When deployed no token is passed and the cookie is used.
 *
 * Read-only on purpose: it never rotates the token or writes a cookie, because a
 * server function cannot hand a replacement cookie back to the browser. Session
 * rotation happens on the HTTP session endpoint, which can.
 */
export async function getSessionUser(bearerToken?: string): Promise<VerifiedUser | null> {
  if (!authConfigured && !gateIdentityEnabled()) return null;
  const request = getRequest();
  if (!request) return null;
  let headers = request.headers;
  if (bearerToken) {
    headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  const resolved = await resolveRequestSession(headers, {
    materializeGate: false,
    emitCookies: false,
  }).catch(() => null);
  if (!resolved) return null;
  return {
    id: resolved.user.id,
    email: resolved.user.email ?? null,
    emailVerified: resolved.user.emailVerified === true,
  };
}

/**
 * Resolve the current user id for a server function, or throw when unauthorized.
 * Prefer `authMiddleware` (`./middleware`), which calls this for you.
 * - Auth enabled -> the verified session user id; throws `UnauthorizedError`
 *   when signed out. Works in the sandbox preview too (real sign-in).
 * - Auth disabled (`VITE_AUTH_ENABLED=false`) + a real backend configured ->
 *   throw (fail closed): one shared dev user on real identity storage would let
 *   every visitor read/write everyone's rows.
 * - Auth disabled + no real backend -> the shared dev user id.
 */
export async function requireUserId(bearerToken?: string): Promise<string> {
  if (!authConfigured && !gateIdentityEnabled()) {
    if (realAuthStorageConfigured()) {
      throw new Error(
        "Auth is disabled (VITE_AUTH_ENABLED=false) but durable auth storage is set — " +
          "refusing to fall back to the shared dev user against real identity storage.",
      );
    }
    return DEV_USER_ID;
  }
  const user = await getSessionUser(bearerToken);
  if (!user) denyUnauthorized();
  return user.id;
}
