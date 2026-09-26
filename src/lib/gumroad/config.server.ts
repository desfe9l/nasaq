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
 */
export function gumroadProductId(): string | undefined {
  return env("GUMROAD_PRODUCT_ID");
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
 * ping to the LIVE production endpoint. Reuses the origin the Paylink module
 * already configured so no new required variable is introduced.
 */
export function nasaqPublicOrigin(): string {
  return (
    env("NASAQ_PUBLIC_URL") ||
    env("PAYLINK_PUBLIC_URL") ||
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

/** Names of the env vars the gateway still needs for a fully automated flow. */
export function missingGumroadVariables(): string[] {
  const missing: string[] = [];
  if (!gumroadApiConfigured()) missing.push("GUMROAD_ACCESS_TOKEN");
  if (!gumroadProductId()) missing.push("GUMROAD_PRODUCT_ID");
  return missing;
}
