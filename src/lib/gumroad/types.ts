/**
 * Gumroad gateway — shared, serializable types (client-safe).
 * No server imports here: these cross the createServerFn RPC boundary.
 */

export type GumroadReadyState = "Ready" | "Needs Setup" | "Missing" | "Failed";

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
    productIdConfigured: boolean;
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
  tierMapping: GumroadTierMappingStatus[];
  keygenMapping: { planKey: string; policyId: string | null; configured: boolean }[];
  subscriptions: { total: number; active: number; pendingClaim: number; unboundEmails: number };
  missingVariables: string[];
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
