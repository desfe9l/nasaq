/**
 * Google sign-in — OPTIONAL, and optional in the strict sense: when
 * `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are absent the flow is simply not
 * offered, and every other way into an account keeps working. Email + password
 * is the primary path and never depends on this file.
 *
 * Implemented directly against Google's documented endpoints (authorization
 * code + PKCE S256 + `state`) rather than a provider SDK: it is a few hundred
 * lines of `fetch`, it keeps the session model unchanged (a Google sign-in ends
 * in exactly the same first-party session as a password one), and it keeps the
 * serverless bundle lean.
 *
 * Server-only (`.server.ts`): it reads the client secret.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/callback/google";
export const GOOGLE_PROVIDER_ID = "google" as const;

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** Short-lived, HttpOnly, first-party cookie carrying state + PKCE verifier. */
export const GOOGLE_OAUTH_STATE_COOKIE = "__Host-nasaq-oauth-state";

/** How long a started sign-in may take to come back. */
export const OAUTH_STATE_TTL_SECONDS = 600;

type EnvLike = Record<string, string | undefined>;

function read(env: EnvLike, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

/** Google is offered only when BOTH values are present. */
export function googleAuthConfigured(env: EnvLike = process.env): boolean {
  return Boolean(read(env, "GOOGLE_CLIENT_ID") && read(env, "GOOGLE_CLIENT_SECRET"));
}

export type OAuthState = {
  /** Anti-CSRF nonce, echoed by Google. */
  state: string;
  /** PKCE verifier; only its SHA-256 leaves the server. */
  verifier: string;
  /** Where to continue after success (site-internal path only). */
  callbackURL: string;
  /** Where to send the visitor after a refusal (site-internal path only). */
  errorCallbackURL: string;
};

/** A site-internal path, or the fallback. Never an open redirect. */
export function internalPath(value: unknown, fallback: string): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  return candidate;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function randomToken(bytes: number): string {
  return base64url(randomBytes(bytes));
}

/** PKCE S256 challenge for a verifier. */
export function codeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "utf8").digest());
}

export function createOAuthState(input: {
  callbackURL?: unknown;
  errorCallbackURL?: unknown;
}): OAuthState {
  return {
    state: randomToken(24),
    verifier: randomToken(48),
    callbackURL: internalPath(input.callbackURL, "/"),
    errorCallbackURL: internalPath(input.errorCallbackURL, "/login?oauth=error"),
  };
}

export function encodeOAuthState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

export function decodeOAuthState(value: string | null | undefined): OAuthState | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<OAuthState>;
    if (!parsed?.state || !parsed?.verifier) return null;
    return {
      state: String(parsed.state),
      verifier: String(parsed.verifier),
      callbackURL: internalPath(parsed.callbackURL, "/"),
      errorCallbackURL: internalPath(parsed.errorCallbackURL, "/login?oauth=error"),
    };
  } catch {
    return null;
  }
}

export function oauthStateCookie(value: string): string {
  return [
    `${GOOGLE_OAUTH_STATE_COOKIE}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${OAUTH_STATE_TTL_SECONDS}`,
  ].join("; ");
}

export function clearedOAuthStateCookie(): string {
  return `${GOOGLE_OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/** Constant-time comparison for the returned `state`. */
export function stateMatches(expected: string, actual: string | null | undefined): boolean {
  const left = Buffer.from(String(expected ?? ""), "utf8");
  const right = Buffer.from(String(actual ?? ""), "utf8");
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** The URL the browser is sent to. `prompt=select_account` keeps switching honest. */
export function googleAuthorizeUrl(input: {
  env?: EnvLike;
  redirectUri: string;
  state: OAuthState;
  loginHint?: string | null;
}): string | null {
  const env = input.env ?? process.env;
  const clientId = read(env, "GOOGLE_CLIENT_ID");
  if (!clientId) return null;
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state.state);
  url.searchParams.set("code_challenge", codeChallenge(input.state.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

export type GoogleProfile = {
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
};

export type GoogleExchangeResult =
  | { ok: true; profile: GoogleProfile }
  | { ok: false; error: "not_configured" | "provider_unreachable" | "token_rejected" | "profile_incomplete" };

/**
 * Exchange an authorization code for tokens, then read the profile.
 *
 * `fetchImpl` is injectable so the flow is testable without Google. Every
 * failure mode returns a stable, non-leaking error code — a provider outage must
 * never surface as a stack trace on the sign-in page.
 */
export async function exchangeGoogleCode(input: {
  code: string;
  verifier: string;
  redirectUri: string;
  env?: EnvLike;
  fetchImpl?: typeof fetch;
}): Promise<GoogleExchangeResult> {
  const env = input.env ?? process.env;
  const clientId = read(env, "GOOGLE_CLIENT_ID");
  const clientSecret = read(env, "GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return { ok: false, error: "not_configured" };
  const doFetch = input.fetchImpl ?? fetch;

  let tokenResponse: Response;
  try {
    tokenResponse = await doFetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: input.code,
        code_verifier: input.verifier,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri,
      }),
    });
  } catch {
    return { ok: false, error: "provider_unreachable" };
  }
  if (!tokenResponse.ok) return { ok: false, error: "token_rejected" };
  const tokens = (await tokenResponse.json().catch(() => null)) as {
    access_token?: string;
  } | null;
  if (!tokens?.access_token) return { ok: false, error: "token_rejected" };

  let profileResponse: Response;
  try {
    profileResponse = await doFetch(USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: "application/json" },
    });
  } catch {
    return { ok: false, error: "provider_unreachable" };
  }
  if (!profileResponse.ok) return { ok: false, error: "provider_unreachable" };
  const info = (await profileResponse.json().catch(() => null)) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  } | null;
  const email = String(info?.email ?? "").trim().toLowerCase();
  if (!info?.sub || !email) return { ok: false, error: "profile_incomplete" };
  return {
    ok: true,
    profile: {
      subject: String(info.sub),
      email,
      emailVerified: info.email_verified === true,
      name: info.name?.trim() || null,
      image: info.picture?.trim() || null,
    },
  };
}

/** The redirect URI that must be registered with Google. */
export function googleRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${GOOGLE_OAUTH_CALLBACK_PATH}`;
}
