/**
 * Request → session resolution, server-only.
 *
 * ONE place answers "who is this request", for both the HTTP auth endpoints and
 * every server function/SSR loader, so the two can never disagree:
 *
 *   1. `Authorization: Bearer <token>` — the live-preview path (partitioned
 *      cookies) and the popup completion page;
 *   2. the `__Host-` session cookie — the deployed path;
 *   3. the platform gate (`x-grok-identity`) — a VERIFIED, signed identity that
 *      may materialize a session with no click at all. Only the HTTP session
 *      endpoint does this (`materializeGate`), so a background server function
 *      can never mint an account as a side effect of a read.
 *
 * Sessions rotate ONLY where the replacement cookie can actually be delivered
 * (the HTTP endpoint); everywhere else resolution is read-only, so a rotated
 * token can never be dropped on the floor and sign the visitor out.
 */
import { clientIpFromHeaders } from "./request-ip";
import {
  gateIdentityEnabled,
  gateIdentityFromHeaders,
  gateIdentityUserInfo,
} from "./gate-identity.server";
import { resolveSession, signInWithGateIdentity } from "./service.server";
import {
  GATE_SESSION_MARKER_COOKIE,
  SESSION_TTL_SECONDS,
  clearedGateMarkerCookie,
  clearedSessionCookie,
  gateMarkerCookie,
  hashSessionToken,
  isSessionUsable,
  readCookieValue,
  sessionCookie,
  sessionTokenFromAuthorization,
  sessionTokenFromCookieHeader,
} from "./session";
import { getAuthStore } from "./store/index.server";

const secureCookie = { secure: true } as const;

function tokenFromHeaders(headers: Headers): string | null {
  return (
    sessionTokenFromAuthorization(headers.get("authorization")) ??
    sessionTokenFromCookieHeader(headers.get("cookie"))
  );
}

/*
 * Bounded in-process cache for READ-ONLY session resolution.
 *
 * A page load fans out a burst of server functions, and each one resolved the
 * session from durable storage (2 reads per request; on the Postgres identity
 * backend that was 2 queries per request, which under serverless concurrency
 * fed the connection-pool exhaustion this deployment has seen). The cache is:
 *
 *   · keyed by the SHA-256 of the token — the token itself is never a key;
 *   · 10-second TTL — a sign-out or revocation propagates within that window,
 *     which is the same order as any stateless session cache; the cookie is
 *     cleared on sign-out anyway, so the next request has no token to hit it;
 *   · used ONLY for the read-only path (`emitCookies: false`, no rotation);
 *     the HTTP session endpoint always resolves fresh;
 *   · capped, evicting the oldest entry — identity must never become a leak.
 */
const SESSION_CACHE_TTL_MS = 10_000;
const SESSION_CACHE_MAX = 512;

type SessionCacheEntry = {
  user: { id: string; email: string; name: string | null; emailVerified: boolean; image: string | null; createdAt: string; updatedAt: string };
  session: { id: string; userId: string; createdAt: string; expiresAt: string; rotated: boolean };
  token: string;
  cachedAt: number;
};

const sessionCache = new Map<string, SessionCacheEntry>();

function sessionCacheGet(tokenHash: string): SessionCacheEntry | null {
  const hit = sessionCache.get(tokenHash);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > SESSION_CACHE_TTL_MS) {
    sessionCache.delete(tokenHash);
    return null;
  }
  return hit;
}

function sessionCacheSet(tokenHash: string, entry: SessionCacheEntry): void {
  if (sessionCache.size >= SESSION_CACHE_MAX) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
  sessionCache.set(tokenHash, entry);
}

/**
 * Resolve the identity of a request. Returns `null` when nobody is signed in —
 * never throws for a missing/broken/absent store: a deployment with no identity
 * storage must still serve public pages, it just cannot sign anyone in.
 */
export async function resolveRequestSession(
  headers: Headers,
  options: { materializeGate?: boolean; emitCookies?: boolean } = {},
) {
  const store = await getAuthStore().catch(() => null);
  const cookieHeader = headers.get("cookie");
  const markerPresent = Boolean(readCookieValue(cookieHeader, GATE_SESSION_MARKER_COOKIE));
  const gateToken = headers.get("x-grok-identity")?.trim() ?? null;
  const gateActive = Boolean(gateToken) && gateIdentityEnabled();
  const cookies: string[] = [];
  const emit = options.emitCookies !== false;

  const token = tokenFromHeaders(headers);
  if (store && token) {
    // Read-only requests (server functions, SSR loaders) may reuse a fresh
    // resolution; anything that would set a cookie must resolve live.
    if (!emit) {
      const tokenHash = hashSessionToken(token);
      const cached = sessionCacheGet(tokenHash);
      if (cached && isSessionUsable(cached.session)) {
        return { user: cached.user, session: cached.session, token: cached.token, cookies };
      }
    }
    const resolved = await resolveSession(store, token, new Date(), { allowRotation: emit });
    if (resolved.ok && resolved.value) {
      const { user, session } = resolved.value;
      if (session.rotated) cookies.push(sessionCookie(resolved.value.token, secureCookie));
      if (emit) {
        if (user.id.startsWith("gate_")) {
          if (!markerPresent) cookies.push(gateMarkerCookie(SESSION_TTL_SECONDS, secureCookie));
        } else if (markerPresent) {
          cookies.push(clearedGateMarkerCookie(secureCookie));
        }
      } else {
        sessionCacheSet(hashSessionToken(token), {
          user,
          session,
          token: resolved.value.token,
          cachedAt: Date.now(),
        });
      }
      return { user, session, token: resolved.value.token, cookies };
    }
    if (emit && token) cookies.push(clearedSessionCookie(secureCookie));
  }

  if (store && gateActive && options.materializeGate) {
    const identity = await gateIdentityFromHeaders(headers).catch(() => null);
    if (identity) {
      const info = gateIdentityUserInfo(identity);
      const materialized = await signInWithGateIdentity(store, {
        subject: info.id,
        email: info.email,
        emailVerified: info.emailVerified,
        name: info.name,
        ip: clientIpFromHeaders(headers),
        userAgent: headers.get("user-agent"),
      });
      if (materialized.ok) {
        if (emit) {
          cookies.push(sessionCookie(materialized.value.token, secureCookie));
          cookies.push(gateMarkerCookie(SESSION_TTL_SECONDS, secureCookie));
        }
        return {
          user: materialized.value.user,
          session: materialized.value.session,
          token: materialized.value.token,
          cookies,
        };
      }
    }
  } else if (emit && markerPresent && !gateActive) {
    cookies.push(clearedGateMarkerCookie(secureCookie));
  }
  return null;
}
