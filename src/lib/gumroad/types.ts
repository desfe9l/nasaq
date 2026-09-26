/**
 * Gumroad gateway — shared, serializable types (client-safe).
 * No server imports here: these cross the createServerFn RPC boundary.
 */

export type GumroadReadyState = "Ready" | "Needs Setup" | "Missing" | "Failed";

/**
 * Where the product id in use came from. Single source of truth — the server
 * config module imports this so the two can never drift.
 */
export type GumroadProductIdSource = "env" | "api" | "unresolved";

export interface GumroadTierMappingStatus {
  planKey: string;
  tierName: string;
  recurrence: string;
  checkoutUrl: string;
  priceCents: number;
  keygenPolicyId: string | null;
  state: GumroadReadyState;
}

export interface GumroadGatewayStatus {
  mode: "Production";
  product: {
    permalink: string;
    storeBaseUrl: string;
    /** `GUMROAD_PRODUCT_ID` explicitly set in the environment. */
    productIdConfigured: boolean;
    /** The product id the runtime actually verifies with (never a secret). */
    productId: string | null;
    /** Where `productId` came from: env, the live API, or nowhere. */
    productIdSource: GumroadProductIdSource;
    /** How many products the token can see — >1 means the id must be pinned. */
    remoteProductCount: number | null;
    publicPageUrl: string;
    remoteName: string | null;
    remotePublished: boolean | null;
    remoteChecked: boolean;
    state: GumroadReadyState;
  };
  api: {
    configured: boolean;
    reachable: boolean | null;
    detail: string;
    state: GumroadReadyState;
  };
  ping: {
    endpointUrl: string;
    state: GumroadReadyState;
    lastPingAt: string | null;
    lastPingStatus: string | null;
    lastPingNote: string | null;
    totals: { received: number; applied: number; unverified: number; rejected: number };
  };
  /** Buyer → NASAQ account binding, reported separately from raw counts. */
  binding: {
    total: number;
    bound: number;
    pendingClaim: number;
    unboundEmails: number;
    state: GumroadReadyState;
  };
  tierMapping: GumroadTierMappingStatus[];
  keygenMapping: { planKey: string; policyId: string | null; configured: boolean }[];
  subscriptions: { total: number; active: number; pendingClaim: number; unboundEmails: number };
  /** Blockers — the flow cannot run without these. */
  missingVariables: string[];
  /** Set-but-not-required: the flow runs, these only make it sturdier. */
  recommendedVariables: string[];
  generatedAt: string;
}

export type GumroadPingTestResult =
  | { ok: true; httpStatus: number; response: Record<string, string | number | boolean | null>; endpointUrl: string }
  | { ok: false; error: string; endpointUrl: string };

export type GumroadVerificationTestResult = {
  ok: boolean;
  detail: string;
  apiConfigured: boolean;
};

export type GumroadSyncResult =
  | { ok: true; detail: string; subscriberStatus: string | null }
  | { ok: false; error: string };

export interface GumroadCheckoutLink {
  planKey: string;
  url: string;
  priceCents: number;
}
