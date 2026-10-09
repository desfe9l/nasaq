/**
 * Host routing for the production domains.
 *
 * Runs before the page is rendered (and before the PWA injector) so a public
 * hostname never streams a workspace document and a workspace hostname never
 * streams the marketing home. The decision table lives in
 * `src/lib/host-routing.ts` and is covered by unit tests; this file only
 * turns a decision into a response.
 *
 * Unknown hosts, nasaq-sa.vercel.app, preview deployments, and local dev fall
 * through unchanged.
 */
import { decideHostRequest } from "../../src/lib/host-routing";

interface HostEvent {
  req: { method?: string; headers: Headers };
  url?: URL;
}

export default async function hostRoutingMiddleware(
  event: HostEvent,
  next: () => unknown | Promise<unknown>,
): Promise<unknown> {
  const url = event.url;
  if (!url) return next();
  const decision = decideHostRequest({
    forwardedHost: event.req.headers.get("x-forwarded-host"),
    hostHeader: event.req.headers.get("host"),
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    method: event.req.method,
  });
  if (!decision) return next();
  return new Response(null, {
    status: decision.status,
    headers: {
      location: decision.location,
      "cache-control": decision.status === 308 ? "public, max-age=3600" : "no-store",
    },
  });
}
