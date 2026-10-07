/**
 * The WHOLE `/api/auth/*` HTTP surface — first-party, one router.
 *
 * Routes (the same paths the client, the popup and `scripts/auth-e2e.mjs` have
 * always used):
 *
 *   GET  /api/auth/ok                  liveness probe
 *   GET  /api/auth/get-session         the session JSON, or `null`
 *   POST /api/auth/sign-up/email       create an account and sign it in
 *   POST /api/auth/sign-in/email       verify a password and sign in
 *   POST /api/auth/sign-out            revoke the session, clear the cookie
 *   POST /api/auth/sign-in/social      begin Google sign-in → `{ url }`
 *   GET  /api/auth/callback/google     finish Google sign-in → 302
 *
 * Why it is written this way:
 *   · ONE place decides what a failure looks like, so the sign-in page can keep
 *     translating a stable `code` into Arabic (see `error-messages.ts`);
 *   · credentialed POSTs are origin-checked (`Origin` + `Sec-Fetch-Site`), which
 *     is what stops a hostile page from signing a visitor into the attacker's
 *     account;
 *   · cookies are set HERE, explicitly, instead of through a framework cookie
 *     bag — a session that the browser never receives is indistinguishable from
 *     "sign-in silently does nothing";
 *   · the handler never throws: storage trouble is a 503 with an actionable
 *     code, and a missing configuration answers the same way on every request
 *     instead of crashing the module graph at import time.
 */
import { authBaseURL, authTrustedOrigins } from "./config";
import {
  clearedOAuthStateCookie,
  createOAuthState,
  decodeOAuthState,
  encodeOAuthState,
  exchangeGoogleCode,
  GOOGLE_OAUTH_STATE_COOKIE,
  GOOGLE_PROVIDER_ID,
  googleAuthConfigured,
  googleAuthorizeUrl,
  googleRedirectUri,
  internalPath,
  oauthStateCookie,
  stateMatches,
} from "./google.server";
import { clientIpFromHeaders } from "./request-ip";
import { resolveRequestSession } from "./request-session.server";
import {
  rotateSession,
  signInWithExternalIdentity,
  signInWithPassword,
  signOutSession,
  signUpWithPassword,
  storeFailure,
  type AuthFailure,
  type PublicSession,
  type PublicUser,
  type SessionResult,
} from "./service.server";
import {
  clearedGateMarkerCookie,
  clearedSessionCookie,
  readCookieValue,
  sessionCookie,
  sessionTokenFromAuthorization,
  SESSION_TOKEN_COOKIE,
} from "./session";
import { getAuthStore } from "./store/index.server";
import { GATE_SESSION_MARKER_COOKIE } from "./gate-session-marker";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" } as const;

/** The marker `UserButton` reads to hide sign-out for gate-materialized sessions. */
function hasGateMarker(request: Request): boolean {
  return Boolean(readCookieValue(request.headers.get("cookie"), GATE_SESSION_MARKER_COOKIE));
}

function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers(JSON_HEADERS);
  if (status >= 400) headers.set("cache-control", "no-store");
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function failureResponse(failure: AuthFailure): Response {
  const headers = new Headers(JSON_HEADERS);
  headers.set("cache-control", "no-store");
  if (failure.retryAfterSeconds) headers.set("retry-after", String(failure.retryAfterSeconds));
  return new Response(
    JSON.stringify({
      code: failure.code,
      message: failure.message,
      ...(failure.retryAfterSeconds ? { retryAfter: failure.retryAfterSeconds } : {}),
    }),
    { status: failure.status, headers },
  );
}

/** Session JSON in the shape the client has always consumed. */
function sessionBody(result: SessionResult): Record<string, unknown> {
  return {
    token: result.token,
    user: result.user,
    session: {
      id: result.session.id,
      userId: result.session.userId,
      createdAt: result.session.createdAt,
      expiresAt: result.session.expiresAt,
      token: result.token,
    },
  };
}

function getSessionBody(user: PublicUser, session: PublicSession, token: string): Record<string, unknown> {
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified === true,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    session: {
      id: session.id,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      token,
    },
  };
}

/**
 * Origin policy for credentialed POSTs.
 *
 * `Origin` is checked against this deployment's own origin and the trusted
 * origin list (wildcards included); a browser request that carries no `Origin`
 * but a cross-site `Sec-Fetch-Site` is refused too. Requests with neither
 * header are non-browser clients (the e2e script, curl, server-to-server) and
 * are allowed — they cannot be tricked into carrying a victim's cookie.
 */
export function requestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin) {
    let candidate: string;
    try {
      candidate = new URL(origin).origin;
    } catch {
      return false;
    }
    if (candidate === new URL(request.url).origin) return true;
    return authTrustedOrigins(process.env).some((pattern) => originPatternMatches(pattern, candidate));
  }
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  return true;
}

/** Match a trusted-origin entry (`*` allowed in the host) against an origin. */
export function originPatternMatches(pattern: string, candidate: string): boolean {
  if (!pattern.includes("*")) return pattern === candidate;
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[A-Za-z0-9.-]*");
  try {
    return new RegExp(`^${escaped}$`).test(candidate);
  } catch {
    return false;
  }
}

type JsonBody = Record<string, unknown>;

async function readJson(request: Request): Promise<JsonBody> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === "object" ? (body as JsonBody) : {};
  } catch {
    return {};
  }
}

/** The store, or the typed failure that becomes a 503. */
async function requireStore() {
  const store = await getAuthStore();
  if (!store) throw new AuthStoreFailure();
  return store;
}

class AuthStoreFailure extends Error {}

function handleUnexpected(error: unknown): Response {
  if (error instanceof AuthStoreFailure) {
    return failureResponse({
      code: "AUTH_STORE_UNAVAILABLE",
      status: 503,
      message:
        "خدمة الحسابات غير متاحة مؤقتًا على هذه النسخة. تواصل مع إدارة المنصة إذا تكرر الأمر.",
    });
  }
  const outcome = storeFailure(error);
  if (outcome.ok) {
    return json({ code: "AUTH_INTERNAL_ERROR" }, 500);
  }
  console.error("[auth] request failed:", error);
  return failureResponse(outcome.failure);
}

/** The live token for this request: bearer (preview) first, then the cookie. */
function tokenOf(request: Request): string | null {
  return (
    sessionTokenFromAuthorization(request.headers.get("authorization")) ??
    readCookieValue(request.headers.get("cookie"), SESSION_TOKEN_COOKIE)
  );
}

/** Public request context attached to sessions (descriptive only). */
function contextOf(request: Request) {
  return {
    ip: clientIpFromHeaders(request.headers),
    userAgent: request.headers.get("user-agent"),
  };
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/auth/, "") || "/";
  const method = request.method.toUpperCase();

  try {
    if (path === "/ok" || path === "/") return json({ ok: true });

    if (method !== "GET" && method !== "HEAD" && !requestOriginAllowed(request)) {
      return failureResponse({
        code: "INVALID_ORIGIN",
        status: 403,
        message: "رُفض الطلب لأسباب أمنية (نطاق غير موثوق).",
      });
    }

    if (path === "/sign-up/email" && method === "POST") {
      const body = await readJson(request);
      const store = await requireStore();
      const result = await signUpWithPassword(store, { ...body, ...contextOf(request) });
      if (!result.ok) return failureResponse(result.failure);
      return json(sessionBody(result.value), 200, [sessionCookie(result.value.token)]);
    }

    if (path === "/sign-in/email" && method === "POST") {
      const body = await readJson(request);
      const store = await requireStore();
      const result = await signInWithPassword(store, { ...body, ...contextOf(request) });
      if (!result.ok) return failureResponse(result.failure);
      return json(sessionBody(result.value), 200, [sessionCookie(result.value.token)]);
    }

    if (path === "/sign-out" && method === "POST") {
      const token = tokenOf(request);
      if (token) {
        const store = await requireStore();
        await signOutSession(store, token);
      }
      return json({ success: true }, 200, [
        clearedSessionCookie(),
        ...(hasGateMarker(request) ? [clearedGateMarkerCookie()] : []),
      ]);
    }

    if (path === "/session/refresh" && method === "POST") {
      const token = tokenOf(request);
      if (!token) return json(null);
      const store = await requireStore();
      const rotated = await rotateSession(store, token);
      if (!rotated.ok) return failureResponse(rotated.failure);
      if (!rotated.value) {
        return json(null, 200, [clearedSessionCookie()]);
      }
      return json(sessionBody(rotated.value), 200, [sessionCookie(rotated.value.token)]);
    }

    if (path === "/get-session" || path === "/session") {
      if (method !== "GET" && method !== "HEAD") {
        return failureResponse({
          code: "VALIDATION_ERROR",
          status: 405,
          message: "طريقة غير مدعومة.",
        });
      }
      /*
       * Identity resolution is delegated to the ONE resolver every server
       * surface uses. It reads bearer → cookie → VERIFIED gate identity, and
       * `materializeGate` is enabled here (and only here) because this is the
       * endpoint that can hand the visitor the resulting cookie. Everything it
       * decides to set — rotation, gate marker, a stale-token clear — comes back
       * as `cookies` and is attached to this response.
       */
      const resolved = await resolveRequestSession(request.headers, { materializeGate: true });
      if (!resolved) return json(null);
      return json(
        getSessionBody(resolved.user, resolved.session, resolved.token),
        200,
        resolved.cookies,
      );
    }

    if (path === "/sign-in/social" && method === "POST") {
      const body = await readJson(request);
      const provider = String(body.provider ?? "");
      if (provider !== GOOGLE_PROVIDER_ID || !googleAuthConfigured()) {
        return failureResponse({
          code: "PROVIDER_NOT_FOUND",
          status: 400,
          message: "طريقة تسجيل الدخول المطلوبة غير مفعّلة على هذه النسخة.",
        });
      }
      const origin = authBaseURL(process.env) ?? url.origin;
      const state = createOAuthState({
        callbackURL: body.callbackURL,
        errorCallbackURL: body.errorCallbackURL,
      });
      const authorizeUrl = googleAuthorizeUrl({
        redirectUri: googleRedirectUri(origin),
        state,
      });
      if (!authorizeUrl) {
        return failureResponse({
          code: "PROVIDER_NOT_FOUND",
          status: 400,
          message: "طريقة تسجيل الدخول المطلوبة غير مفعّلة على هذه النسخة.",
        });
      }
      return json({ url: authorizeUrl, redirect: false }, 200, [
        oauthStateCookie(encodeOAuthState(state)),
      ]);
    }

    if (path === "/callback/google" && method === "GET") {
      const state = decodeOAuthState(
        readCookieValue(request.headers.get("cookie"), GOOGLE_OAUTH_STATE_COOKIE),
      );
      const errorTarget = internalPath(state?.errorCallbackURL, "/login?oauth=error");
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (!state || !code || !stateMatches(state.state, returnedState)) {
        return redirectWith(errorTarget, [clearedOAuthStateCookie()]);
      }
      const origin = authBaseURL(process.env) ?? url.origin;
      const exchanged = await exchangeGoogleCode({
        code,
        verifier: state.verifier,
        redirectUri: googleRedirectUri(origin),
      });
      if (!exchanged.ok) {
        console.error("[auth] Google sign-in failed:", exchanged.error);
        return redirectWith(errorTarget, [clearedOAuthStateCookie()]);
      }
      const store = await requireStore();
      const result = await signInWithExternalIdentity(
        store,
        {
          providerId: GOOGLE_PROVIDER_ID,
          subject: exchanged.profile.subject,
          email: exchanged.profile.email,
          emailVerified: exchanged.profile.emailVerified,
          name: exchanged.profile.name,
          image: exchanged.profile.image,
          ...contextOf(request),
        },
      );
      if (!result.ok) {
        console.error("[auth] Google sign-in could not start a session:", result.failure.code);
        return redirectWith(errorTarget, [clearedOAuthStateCookie()]);
      }
      return redirectWith(internalPath(state.callbackURL, "/"), [
        clearedOAuthStateCookie(),
        sessionCookie(result.value.token),
      ]);
    }

    return failureResponse({
      code: "NOT_FOUND",
      status: 404,
      message: "المسار المطلوب غير موجود.",
    });
  } catch (error) {
    return handleUnexpected(error);
  }
}

/** 302 with cookies — how a top-level navigation (the OAuth callback) answers. */
function redirectWith(location: string, cookies: string[]): Response {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}
