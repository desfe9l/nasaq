/**
 * One correct way to reject an authorized-but-not-permitted server call.
 *
 * Throwing a bare `Error("Forbidden")` used to reach the client as **HTTP 500**:
 * TanStack Start serialises any thrown error with `status = ALS response.status
 * ?? 500`, and also logs it through `console.error("Server Fn Error!")`. So an
 * ordinary, expected authorization decision was indistinguishable from a crash
 * — in monitoring, in the browser's network tab, and in the deploy logs.
 *
 * `setResponseStatus(403)` is what makes the response say 403; `ForbiddenError`
 * is what makes the *value* the client receives self-describing, so a caller can
 * branch on `error.name === "ForbiddenError"` instead of string-matching a
 * message. The error still propagates exactly as before — this changes the
 * status code and the error type, never the control flow.
 *
 * This module is `.server` because `setResponseStatus` only exists inside the
 * Start request runtime; client-importable function modules must reach it with
 * a dynamic `await import(...)`, the same way they already load
 * `getAuthorizationContext`.
 */
import { setResponseStatus } from "@tanstack/react-start/server";
import { ForbiddenError } from "./authorization.server";

/**
 * Reject the current request as 403 and throw. Always throws; `never` return
 * keeps the compiler from asking callers to handle a fall-through.
 */
export async function denyForbidden(): Promise<never> {
  try {
    // Outside a Start request context (a direct handler call in a test, an
    // offline migration) there is no response to decorate. The status is a
    // nicety there; the throw is the security-relevant part, so never let the
    // decoration swallow it.
    setResponseStatus(403, "Forbidden");
  } catch {
    /* keep throwing */
  }
  throw new ForbiddenError();
}
