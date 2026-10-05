/**
 * Request-context half of the rate-limit IP rule — server-only (`.server.ts`).
 *
 * MUST keep the suffix: it imports `@tanstack/react-start/server`
 * (`getRequest` → Node `AsyncLocalStorage`). Dual client/server modules import
 * the dependency-free `./request-ip` instead and pass their own headers.
 */
import { getRequest } from "@tanstack/react-start/server";
import { clientIpFromHeaders } from "./request-ip";

/** Client IP of the CURRENT request (best effort; never throws). */
export function getClientIp(): string {
  try {
    return clientIpFromHeaders(getRequest()?.headers);
  } catch {
    return "unknown";
  }
}

export { clientIpFromHeaders, rateLimitKey } from "./request-ip";
