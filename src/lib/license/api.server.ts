/**
 * Shared response contract for the public license API routes
 * (`/api/license/{activate,validate,deactivate}`).
 *
 * Server-only (`.server.ts`): importing `CrossSiteRequestError` pulls TanStack
 * Start's request context, which must never reach the browser bundle.
 *
 * Status mapping (the whole contract, applied identically by every route):
 *   - CrossSiteRequestError        → 403 (scripted cross-site request)
 *   - UnauthorizedError             → 401 (missing/invalid session)
 *   - ForbiddenError                → 403 (authenticated but not permitted)
 *   - "rate limited" marker        → 429 (too many attempts from one IP)
 *   - handler returned failure     → caller-mapped 400/200 (invalid key etc.)
 *   - anything thrown unexpectedly → 500 (never leak the error text)
 *
 * Every response also carries `Cache-Control: no-store`: license state is
 * per-caller and must never sit in any shared cache, ever.
 */

import { CrossSiteRequestError } from "@/lib/auth/isolation.server";
import { UnauthorizedError } from "@/lib/auth/verify.server";
import { ForbiddenError } from "@/lib/auth/authorization.server";

/** Marker the rate limiter reports through — see functions.ts. */
const RATE_LIMIT_MARK = "تم تجاوز الحد المسموح";

function isRateLimited(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof (payload as { message?: unknown }).message === "string" &&
    (payload as { message: string }).message.startsWith(RATE_LIMIT_MARK)
  );
}

/**
 * Wrap any license handler result (or thrown error) into a Response with the
 * mapped status and the no-store header. `statusOf` maps a *successful shape*
 * result to 200/400; thrown errors are classified before it is consulted.
 */
export async function respondLicense<T>(
  run: Promise<T> | T,
  statusOf: (result: T) => number,
): Promise<Response> {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  try {
    const result = await run;
    if (isRateLimited(result)) {
      return new Response(JSON.stringify(result), { status: 429, headers });
    }
    return new Response(JSON.stringify(result), { status: statusOf(result), headers });
  } catch (err) {
    if (err instanceof CrossSiteRequestError) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
    }
    if (err instanceof UnauthorizedError) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
    }
    if (err instanceof ForbiddenError) {
      return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers });
    }
    // Unexpected — log server-side, return an opaque 500. No stack, no message.
    console.error("[license-api] unexpected failure", err);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers });
  }
}
