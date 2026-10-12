/**
 * Cross-domain session handoff — the ONE bridge between nasaq.team and
 * nasaq.work (and the legacy production host).
 *
 * WHY THIS EXISTS
 * ---------------
 * Sessions are `__Host-` cookies: host-only, Secure, Path=/. A cookie set on
 * `www.nasaq.team` is NEVER sent to `nasaq.work` — the two are different
 * registrable domains, and widening the cookie with a Domain attribute is both
 * impossible across registrable domains and forbidden by the `__Host-` prefix.
 * Before this module existed, every host-routing redirect between the two
 * surfaces (and every OAuth callback) dropped the visitor's authentication on
 * the floor: sign in on one domain, arrive signed out on the other.
 *
 * THE MECHANISM
 * -------------
 *   1. The departure side (a cross-origin host redirect, a completed sign-in)
 *      mints a 256-bit random code, stores ONLY its SHA-256 together with the
 *      user id and a 60-second expiry, and sends the browser to
 *      `https://<arrival>/api/auth/handoff?code=…&return=…`.
 *   2. The arrival endpoint (`http.server.ts`) consumes the code (single use,
 *      enforced by the store), verifies the account still exists, issues a
 *      regular first-party session on ITS host, and redirects to `return`.
 *
 * SECURITY PROPERTIES
 * -------------------
 *   · the code is single-use and lives 60 seconds — a leaked URL dies fast and
 *     cannot be replayed;
 *   · only the SHA-256 of the code is persisted, so a store dump yields no
 *     working codes (same rule as session tokens);
 *   · the code is never minted for a signed-out visitor, and the arrival side
 *     trusts ONLY the consumed store record — nothing in the URL besides the
 *     code itself is authoritative;
 *   · `return` is validated here (`handoffReturnTarget`): a site-internal path
 *     or an absolute URL on one of this product's own origins. It can never
 *     point the post-sign-in redirect at a foreign site.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  LEGACY_PRODUCTION_HOST,
  PRODUCT_AUTH_ORIGINS,
  PUBLIC_CANONICAL_HOST,
  PUBLIC_ALIAS_HOST,
  WORKSPACE_ALIAS_HOST,
  WORKSPACE_CANONICAL_HOST,
  WORKSPACE_ORIGIN,
  PUBLIC_ORIGIN,
  LEGACY_PRODUCTION_ORIGIN,
  parseHostHeader,
} from "../host-routing";
import type { AuthStore } from "./store/types";

/** How long a minted handoff code stays valid. */
export const HANDOFF_TTL_SECONDS = 60;

/** SHA-256 hex — the only form of a handoff code that is ever stored. */
export function hashHandoffCode(code: string): string {
  return createHash("sha256").update(String(code ?? ""), "utf8").digest("hex");
}

/**
 * Mint a one-time handoff code for `userId`. Returns the cleartext code (goes
 * into the redirect URL and NOWHERE else) or `null` when the store rejected
 * the write — callers then proceed WITHOUT a handoff (the visitor simply
 * signs in again on the other domain; sign-in is never blocked by this).
 */
export async function createHandoffCode(
  store: AuthStore,
  userId: string,
  now: Date = new Date(),
): Promise<string | null> {
  try {
    const code = randomBytes(32).toString("base64url");
    await store.createSessionHandoff({
      codeHash: hashHandoffCode(code),
      userId,
      expiresAt: new Date(now.getTime() + HANDOFF_TTL_SECONDS * 1000).toISOString(),
    });
    return code;
  } catch {
    return null;
  }
}

/**
 * Exchange a handoff code for the account it was minted for. Single-use and
 * TTL-enforced by the store; returns `null` for unknown, consumed, malformed
 * or expired codes — the caller treats every one of those the same way:
 * continue without a session.
 */
export async function consumeHandoffCode(
  store: AuthStore,
  code: string | null | undefined,
): Promise<string | null> {
  const trimmed = String(code ?? "").trim();
  if (!trimmed || trimmed.length > 128) return null;
  try {
    const consumed = await store.consumeSessionHandoff(hashHandoffCode(trimmed));
    return consumed?.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * The sibling canonical origin for a host — where the SSO relay points.
 *
 *   · public hosts (.team)   → the workspace origin (nasaq.work)
 *   · workspace hosts (.work) → the public origin (www.nasaq.team)
 *   · the legacy vercel.app host → the workspace origin (the member surface
 *     is where its sessions matter most); preview/local hosts → null (they
 *     have no sibling and must never be woven into a cross-domain relay).
 */
export function siblingOriginFor(hostname: string | null | undefined): string | null {
  const host = parseHostHeader(hostname ?? "")?.hostname ?? "";
  if (!host) return null;
  if (host === PUBLIC_CANONICAL_HOST || host === PUBLIC_ALIAS_HOST) {
    return WORKSPACE_ORIGIN;
  }
  if (host === WORKSPACE_CANONICAL_HOST || host === WORKSPACE_ALIAS_HOST) {
    return PUBLIC_ORIGIN;
  }
  if (host === LEGACY_PRODUCTION_HOST) return WORKSPACE_ORIGIN;
  return null;
}

/** The host's own canonical origin when it is one of the product hosts. */
export function productOriginFor(hostname: string | null | undefined): string | null {
  const host = parseHostHeader(hostname ?? "")?.hostname ?? "";
  if (!host) return null;
  if (host === PUBLIC_CANONICAL_HOST || host === PUBLIC_ALIAS_HOST) {
    return PUBLIC_ORIGIN;
  }
  if (host === WORKSPACE_CANONICAL_HOST || host === WORKSPACE_ALIAS_HOST) {
    return WORKSPACE_ORIGIN;
  }
  if (host === LEGACY_PRODUCTION_HOST) return LEGACY_PRODUCTION_ORIGIN;
  return null;
}

/**
 * Where the handoff endpoint may send the browser AFTER issuing the session.
 *
 * Accepts a site-internal path (resolved against the endpoint's own origin)
 * or an absolute URL whose origin is one of this product's own origins —
 * nothing else. Any other input falls back to `fallback` (never an echo of
 * attacker-controlled input, never an open redirect).
 */
export function handoffReturnTarget(
  value: string | null | undefined,
  currentOrigin: string,
  fallback = "/",
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    try {
      return new URL(raw, currentOrigin).href;
    } catch {
      return fallback;
    }
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fallback;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
  const allowed =
    url.origin === currentOrigin ||
    (PRODUCT_AUTH_ORIGINS as readonly string[]).includes(url.origin);
  return allowed ? url.href : fallback;
}
