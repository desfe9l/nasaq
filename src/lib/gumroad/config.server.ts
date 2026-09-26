/**
 * Gumroad server configuration — env reads only, never values in Git.
 *
 * Every secret here is server-only and is NEVER logged, never returned to the
 * browser, and never written into audit rows. The vault card reports only
 * whether each variable is SET.
 */

import {
  DEFAULT_GUMROAD_PUBLIC_CONFIG,
  GUMROAD_PING_PATH,
  type GumroadPublicConfig,
} from "./mapping.ts";
import type { GumroadProductIdSource } from "./types.ts";

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

/** OAuth application access token (Gumroad → Settings → Advanced). */
export function gumroadAccessToken(): string | undefined {
  return env("GUMROAD_ACCESS_TOKEN");
}

export function gumroadApiConfigured(): boolean {
  return Boolean(gumroadAccessToken());
}

/**
 * The product's id, e.g. "32-nPainqpLj1B_WIwVlMw==". Optional but recommended:
 * products created after Jan 2023 verify licenses by product_id only.
 *
 * This is the *explicitly configured* value only. `resolveGumroadProductId()`
 * is what the runtime actually uses: it prefers this, and otherwise derives the
 * real id from the Gumroad API by matching the product permalink — so a
 * deployment that only sets `GUMROAD_ACCESS_TOKEN` still verifies by product id
 * instead of falling back to the weaker permalink form.
 */
export function gumroadProductId(): string | undefined {
  return env("GUMROAD_PRODUCT_ID");
}

/** How the product id in use was obtained — surfaced to the owner card. */
export type { GumroadProductIdSource };

/**
 * Resolve the product id the runtime should verify with.
 *
 * Order of trust:
 *   1. `GUMROAD_PRODUCT_ID` — an explicit value always wins (it can pin a
 *      product when a store hosts more than one).
 *   2. The Gumroad API, matched by the configured permalink — the only way to
 *      learn the real id when the operator has not pasted it.
 *   3. Unresolved — callers then use `product_permalink` instead, which older
 *      products still accept.
 *
 * The API result is memoised per process: a Gumroad store's product list is
 * static for practical purposes, and the ping handler must not pay a round trip
 * per notification. A failed lookup is NOT memoised, so a transient Gumroad
 * error does not poison the process for the next sale.
 */
let resolvedProductIdCache: { permalink: string; id: string } | null = null;

export async function resolveGumroadProductId(): Promise<{
  id: string | null;
  source: GumroadProductIdSource;
}> {
  const explicit = gumroadProductId();
  if (explicit) return { id: explicit, source: "env" };

  const permalink = gumroadProductPermalink();
  if (resolvedProductIdCache && resolvedProductIdCache.permalink === permalink) {
    return { id: resolvedProductIdCache.id, source: "api" };
  }
  if (!gumroadApiConfigured()) return { id: null, source: "unresolved" };

  try {
    const { fetchGumroadProductByPermalink } = await import("./api.server.ts");
    const product = await fetchGumroadProductByPermalink(permalink);
    if (product?.id) {
      resolvedProductIdCache = { permalink, id: product.id };
      return { id: product.id, source: "api" };
    }
  } catch {
    // Fall through to the permalink form rather than failing the whole sale.
  }
  return { id: null, source: "unresolved" };
}

/** Test seam: drop the memoised API lookup (never used by production paths). */
export function resetGumroadProductIdCache(): void {
  resolvedProductIdCache = null;
}

export function gumroadProductPermalink(): string {
  return env("GUMROAD_PRODUCT_PERMALINK") || DEFAULT_GUMROAD_PUBLIC_CONFIG.productPermalink;
}

export function gumroadStoreBaseUrl(): string {
  return env("GUMROAD_STORE_BASE_URL") || DEFAULT_GUMROAD_PUBLIC_CONFIG.storeBaseUrl;
}

/** Pin the exact tier names in case the product page renames them later. */
export function gumroadTierName(family: "individual" | "team"): string {
  return (
    env(family === "individual" ? "GUMROAD_TIER_INDIVIDUAL_NAME" : "GUMROAD_TIER_TEAM_NAME") ||
    DEFAULT_GUMROAD_PUBLIC_CONFIG.tierNames[family]
  );
}

export function gumroadPublicConfig(): GumroadPublicConfig {
  return {
    storeBaseUrl: gumroadStoreBaseUrl(),
    productPermalink: gumroadProductPermalink(),
    tierNames: {
      individual: gumroadTierName("individual"),
      team: gumroadTierName("team"),
    },
  };
}

/**
 * This deployment's public origin — used by owner diagnostics to send a test
 * ping to the LIVE production endpoint.
 */
export function nasaqPublicOrigin(): string {
  return (
    env("NASAQ_PUBLIC_URL") ||
    (env("VERCEL_ENV") && env("VERCEL_PROJECT_PRODUCTION_URL")
      ? `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}`
      : undefined) ||
    env("BETTER_AUTH_URL") ||
    ""
  ).replace(/\/+$/, "");
}

export function gumroadPingUrl(): string {
  return `${nasaqPublicOrigin()}${GUMROAD_PING_PATH}`;
}

/**
 * Names of the env vars the gateway still needs for a fully automated flow.
 *
 * `GUMROAD_ACCESS_TOKEN` is the only hard blocker: with it, the product id is
 * derived from the API by permalink (see `resolveGumroadProductId`), so a store
 * with a single published product needs nothing else. The product id is
 * reported separately as *recommended* — pinning it removes one API round trip
 * per process and disambiguates multi-product stores.
 */
export function missingGumroadVariables(): string[] {
  const missing: string[] = [];
  if (!gumroadApiConfigured()) missing.push("GUMROAD_ACCESS_TOKEN");
  return missing;
}

/** Recommended-but-not-blocking Gumroad env vars. */
export function recommendedGumroadVariables(): string[] {
  const recommended: string[] = [];
  if (!gumroadProductId()) recommended.push("GUMROAD_PRODUCT_ID");
  return recommended;
}
