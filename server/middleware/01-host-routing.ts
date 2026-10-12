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
 *
 * CROSS-DOMAIN SESSION HANDOFF
 * ----------------------------
 * `.team` and `.work` are different registrable domains, so the `__Host-`
 * session cookie set on one is never sent to the other. When a decision moves
 * a SIGNED-IN visitor to the other origin, the redirect is routed through the
 * arrival host's `/api/auth/handoff` with a one-time 60-second code
 * (`src/lib/auth/handoff.server.ts`), which mints a fresh first-party session
 * there. Without this hop every domain change silently logged the visitor out.
 * Signed-out visitors get the plain redirect — there is nothing to carry.
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

  let location = decision.location;
  const targetOrigin = new URL(decision.location).origin;
  const requestOrigin = url.origin;

  // A cross-origin move is the only case that loses the host-only cookie.
  if (targetOrigin !== requestOrigin) {
    const relay = await crossOriginHandoffLocation(event, decision.location);
    if (relay) location = relay;
  }

  return new Response(null, {
    status: decision.status,
    headers: {
      location,
      // Never cache a redirect that carries a one-time handoff code.
      "cache-control":
        location === decision.location && decision.status === 308
          ? "public, max-age=3600"
          : "no-store",
    },
  });
}

/**
 * The handoff-routed Location for a signed-in cross-origin redirect, or null
 * to fall back to the plain redirect. Every failure (no cookie, store outage,
 * unsupported host) degrades to today's behaviour — a redirect that arrives
 * signed out — because blocking navigation on the relay would be worse.
 */
async function crossOriginHandoffLocation(
  event: HostEvent,
  plainLocation: string,
): Promise<string | null> {
  try {
    const { sessionTokenFromCookieHeader } = await import(
      "../../src/lib/auth/session"
    );
    const token = sessionTokenFromCookieHeader(event.req.headers.get("cookie"));
    if (!token) return null;

    const { getAuthStore } = await import("../../src/lib/auth/store/index.server");
    const store = await getAuthStore().catch(() => null);
    if (!store) return null;

    // Read-only resolution: rotation must never happen here (there is no way
    // to hand the replacement cookie back on a 30x), and a token that does not
    // resolve simply gets the plain redirect.
    const { resolveSession } = await import("../../src/lib/auth/service.server");
    const resolved = await resolveSession(store, token, new Date(), {
      allowRotation: false,
    }).catch(() => null);
    if (!resolved?.ok || !resolved.value) return null;

    const { createHandoffCode } = await import("../../src/lib/auth/handoff.server");
    const code = await createHandoffCode(store, resolved.value.user.id);
    if (!code) return null;

    const target = new URL("/api/auth/handoff", plainLocation);
    target.searchParams.set("code", code);
    target.searchParams.set("return", `${new URL(plainLocation).pathname}${new URL(plainLocation).search}`);
    return target.toString();
  } catch {
    return null;
  }
}
