/**
 * Session tokens and the cookie that carries them — pure, dependency-light, and
 * the single place these rules exist.
 *
 * THE MODEL
 *   · the browser holds an OPAQUE, 256-bit random token (`mintSessionToken`);
 *   · the server stores only its SHA-256 (`hashSessionToken`) as the session's
 *     primary key, so a dump of the identity store yields no usable token;
 *   · a session expires (30 days, sliding on activity) and its token ROTATES
 *     once a day (`shouldRotateSession`), which bounds the value of a token that
 *     leaked out of a shared machine or a proxy log;
 *   · sign-out deletes the row, so a copied cookie dies immediately — there is
 *     no "still valid until expiry" window and no client-side state to trust.
 *
 * THE COOKIE
 *   `__Host-grok-auth.session_token` — the name the live-preview popup reads, so
 *   it is kept verbatim. `__Host-` means the browser itself refuses any copy that
 *   carries a `Domain` attribute, which stops a sibling tenant on a shared parent
 *   domain from planting a session cookie this app would then read. It requires
 *   Secure + Path=/ + no Domain, all of which are set here.
 */
import { createHash, randomBytes } from "node:crypto";

/** Session cookie name. Host-only, `__Host-` prefixed. */
export const SESSION_TOKEN_COOKIE = "__Host-grok-auth.session_token";

/**
 * Marker cookie for gate-materialized sessions (readable by the client). The
 * constant lives in the client-safe `./gate-session-marker` so the browser and
 * the server can never drift; re-exported here for the cookie serializers.
 */
import { GATE_SESSION_MARKER_COOKIE } from "./gate-session-marker";
export { GATE_SESSION_MARKER_COOKIE };

/** How long a session lives without activity. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** A token is rotated when the session has been alive this long since its last rotation. */
export const SESSION_ROTATION_SECONDS = 60 * 60 * 24;
/** Hard ceiling: a session is never extended past this age by activity alone. */
export const SESSION_ABSOLUTE_TTL_SECONDS = 60 * 60 * 24 * 90;

/**
 * Mint an opaque session token: 32 cryptographically random bytes, base64url.
 *
 * `randomBytes` is the platform CSPRNG — never `Math.random`, never a counter,
 * never anything derived from the user id.
 */
export function mintSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The only form of a session token that is ever persisted. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(String(token ?? ""), "utf8").digest("hex");
}

/** Stable, non-secret session id (for logs and the account page). */
export function newSessionId(): string {
  return randomBytes(16).toString("hex");
}

export type SessionCookieOptions = {
  /** HTTP only where the browser is a secure context; plain http in local dev. */
  secure?: boolean;
  maxAgeSeconds?: number;
  sameSite?: "Lax" | "Strict";
};

/**
 * Serialize the session cookie. `HttpOnly` is not optional: the token must never
 * be readable by script (an XSS would otherwise walk away with a session).
 */
export function sessionCookie(
  token: string,
  options: SessionCookieOptions = {},
): string {
  const secure = options.secure !== false;
  const maxAge = options.maxAgeSeconds ?? SESSION_TTL_SECONDS;
  return [
    `${SESSION_TOKEN_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    secure ? "Secure" : null,
    `SameSite=${options.sameSite ?? "Lax"}`,
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** Expire the session cookie (sign-out, rotation of a rejected token). */
export function clearedSessionCookie(options: { secure?: boolean } = {}): string {
  return sessionCookie("", { ...options, maxAgeSeconds: 0 });
}

/** Serialize the client-readable gate marker cookie. */
export function gateMarkerCookie(maxAgeSeconds: number, options: { secure?: boolean } = {}): string {
  return [
    `${GATE_SESSION_MARKER_COOKIE}=1`,
    "Path=/",
    options.secure === false ? null : "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join("; ");
}

/** Expire the gate marker cookie. */
export function clearedGateMarkerCookie(options: { secure?: boolean } = {}): string {
  return [
    `${GATE_SESSION_MARKER_COOKIE}=`,
    "Path=/",
    options.secure === false ? null : "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Read one cookie value out of a `Cookie:` header. Never throws. */
export function readCookieValue(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Extract the opaque session token from a request's cookies. */
export function sessionTokenFromCookieHeader(header: string | null | undefined): string | null {
  const value = readCookieValue(header, SESSION_TOKEN_COOKIE);
  return value && value.trim() ? value.trim() : null;
}

/** Extract `Authorization: Bearer <token>` (used by the embedded live preview). */
export function sessionTokenFromAuthorization(header: string | null | undefined): string | null {
  const value = String(header ?? "").trim();
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/** True when the session is past its expiry (or was revoked). */
export function isSessionUsable(
  session: { expiresAt: string; revokedAt?: string | null },
  now: Date = new Date(),
): boolean {
  if (session.revokedAt) return false;
  const expires = Date.parse(session.expiresAt);
  return Number.isFinite(expires) && expires > now.getTime();
}

/** True when the session has lived long enough to warrant a fresh token. */
export function shouldRotateSession(
  session: { createdAt: string; rotatedAt?: string | null },
  now: Date = new Date(),
): boolean {
  const anchor = Date.parse(session.rotatedAt ?? session.createdAt);
  if (!Number.isFinite(anchor)) return true;
  return now.getTime() - anchor >= SESSION_ROTATION_SECONDS * 1000;
}

/** True when the session has reached its absolute lifetime ceiling. */
export function isSessionBeyondAbsoluteLimit(
  session: { createdAt: string },
  now: Date = new Date(),
): boolean {
  const created = Date.parse(session.createdAt);
  if (!Number.isFinite(created)) return true;
  return now.getTime() - created >= SESSION_ABSOLUTE_TTL_SECONDS * 1000;
}

/** The expiry a session created now should carry. */
export function sessionExpiryFrom(now: Date = new Date()): string {
  return new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();
}

/**
 * User-Agent kept with a session for the visitor's own review.
 *
 * Truncated and never used as an authenticator — it is descriptive metadata, so
 * a spoofed value costs the attacker nothing and gains them nothing.
 */
export function normalizeUserAgent(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 200) : null;
}
