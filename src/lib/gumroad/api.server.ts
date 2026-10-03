/**
 * Gumroad REST API client (https://api.gumroad.com/v2) — server-only.
 *
 * Two independent server-side verification paths, so a missing OAuth token
 * degrades the gateway to "needs setup" instead of breaking it:
 *
 *  1. `fetchGumroadSale` — GET /sales/:id with the owner's access token. The
 *     strongest proof (authoritative refund/chargeback/subscription flags).
 *  2. `verifyGumroadLicense` — POST /licenses/verify. Tokenless by design
 *     (Gumroad documents this endpoint as open); it proves a license key really
 *     was sold by THIS product, which is exactly the claim a ping makes.
 *
 * Plus one read-only owner diagnostic: `fetchGumroadUser` — GET /user, which
 * proves the access token itself is live and shows which account it belongs to.
 * Personal tokens (Settings → Advanced → Applications → Generate access token)
 * are all NASAQ ever needs; no client id, secret or per-user OAuth flow exists
 * anywhere in this codebase.
 *
 * The access token never appears in thrown errors, logs or return values.
 */

import {
  gumroadAccessToken,
  gumroadApiConfigured,
  gumroadProductPermalink,
  resolveGumroadProductId,
} from "./config.server.ts";

const API_ORIGIN = "https://api.gumroad.com/v2";

export class GumroadApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GumroadApiError";
    this.status = status;
  }
}

function requireToken(): string {
  const token = gumroadAccessToken();
  if (!token) throw new GumroadApiError("GUMROAD_ACCESS_TOKEN is not configured", 401);
  return token;
}

async function apiFetch(
  path: string,
  init: { method?: "GET" | "POST" | "PUT"; params?: Record<string, string> } = {},
): Promise<{ status: number; payload: Record<string, unknown> | null }> {
  const method = init.method ?? "GET";
  const url = new URL(`${API_ORIGIN}${path}`);
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(init.params ?? {})) {
    if (method === "GET") url.searchParams.set(key, value);
    else body.set(key, value);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: method === "GET" ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: method === "GET" ? undefined : body,
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    throw new GumroadApiError(
      error instanceof Error ? `Gumroad API unreachable: ${error.name}` : "Gumroad API unreachable",
      0,
    );
  }
  const text = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

/** Normalized subset of a Gumroad sale this pipeline reasons about. */
export interface GumroadSaleView {
  saleId: string;
  productId: string;
  productPermalink: string | null;
  email: string;
  priceCents: number | null;
  currency: string | null;
  refunded: boolean;
  chargedback: boolean;
  disputed: boolean;
  disputeWon: boolean;
  paid: boolean;
  subscriptionId: string | null;
  recurringCharge: boolean;
  recurrence: string | null;
  variants: Record<string, string> | null;
  licenseKey: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function variantsFrom(value: unknown): Record<string, string> | null {
  if (typeof value === "string" && value.trim()) return { Tier: value };
  const record = asRecord(value);
  if (!record) return null;
  const entries = Object.entries(record)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, val]) => [key, val] as [string, string]);
  return entries.length ? Object.fromEntries(entries) : null;
}

function saleFromRecord(record: Record<string, unknown>): GumroadSaleView | null {
  const saleId = asString(record.id) ?? asString(record.sale_id);
  const productId = asString(record.product_id);
  const email = asString(record.email) ?? asString(record.purchase_email);
  if (!saleId || !productId || !email) return null;
  const price = record.price;
  return {
    saleId,
    productId,
    productPermalink: asString(record.product_permalink),
    email,
    priceCents: typeof price === "number" ? Math.round(price) : typeof price === "string" && price.trim() && Number.isFinite(Number(price)) ? Math.round(Number(price)) : null,
    currency: asString(record.currency),
    refunded: asBool(record.refunded),
    chargedback: asBool(record.chargedback),
    disputed: asBool(record.disputed),
    disputeWon: asBool(record.dispute_won),
    paid: record.paid === undefined ? true : asBool(record.paid),
    subscriptionId: asString(record.subscription_id),
    recurringCharge: asBool(record.is_recurring_billing) || asBool(record.recurring_charge),
    recurrence: asString(record.recurrence) ?? asString(record.subscription_duration),
    variants: variantsFrom(record.variants),
    licenseKey: asString(record.license_key),
  };
}

/** Path 1: fetch the authoritative sale by id (view_sales scope). */
export async function fetchGumroadSale(saleId: string): Promise<GumroadSaleView | null> {
  const token = requireToken();
  const { status, payload } = await apiFetch(`/sales/${encodeURIComponent(saleId)}`, {
    params: { access_token: token },
  });
  if (status === 404) return null;
  if (status === 401) throw new GumroadApiError("Gumroad rejected the access token", 401);
  if (status >= 400) throw new GumroadApiError("Gumroad API request failed", status);
  const sale = asRecord(payload?.sale);
  return sale ? saleFromRecord(sale) : null;
}

/**
 * The Gumroad account an access token belongs to — public, non-secret fields.
 *
 * A token pasted from the application's Edit page is only *assumed* to be live
 * until Gumroad itself answers. This call is that answer: it separates "the
 * token was revoked / mistyped (401)" from "the token works but this product is
 * not in the store", two failures that otherwise look identical in the vault.
 */
export interface GumroadAccountView {
  name: string | null;
  profileUrl: string | null;
}

/** Owner diagnostic: prove the access token is live by reading its account. */
export async function fetchGumroadUser(): Promise<GumroadAccountView> {
  const token = requireToken();
  const { status, payload } = await apiFetch("/user", { params: { access_token: token } });
  if (status === 401 || status === 403) {
    throw new GumroadApiError("Gumroad rejected the access token", 401);
  }
  if (status >= 400) throw new GumroadApiError("Gumroad API request failed", status);
  const user = asRecord(payload?.user) ?? asRecord(payload);
  return {
    name: user ? asString(user.name) : null,
    profileUrl: user ? (asString(user.url) ?? asString(user.profile_url)) : null,
  };
}

/**
 * Path 2: tokenless license verification. `purchase` echoes the original sale
 * including refunded/chargeback/subscription state for membership products.
 *
 * Verification is bound to the real product: the explicit `GUMROAD_PRODUCT_ID`
 * when set, otherwise the id resolved from the Gumroad API by permalink. Only
 * when neither is available do we fall back to `product_permalink`, which
 * products created before Jan 2023 still accept.
 */
export async function verifyGumroadLicense(
  licenseKey: string,
): Promise<{ uses: number | null; purchase: GumroadSaleView } | null> {
  const { id: productId } = await resolveGumroadProductId();
  const permalink = gumroadProductPermalink();
  // Products created on/after Jan 9 2023 MUST verify by product_id; older ones
  // accept the permalink. Prefer the id, fall back to the permalink.
  const params: Record<string, string> = {
    license_key: licenseKey,
    increment_uses_count: "false",
  };
  if (productId) params.product_id = productId;
  else params.product_permalink = permalink;
  const { status, payload } = await apiFetch("/licenses/verify", { method: "POST", params });
  if (status === 404 || status === 400) return null;
  if (status >= 400) throw new GumroadApiError("Gumroad license verification failed", status);
  if (payload?.success !== true) return null;
  const purchase = asRecord(payload.purchase);
  const sale = purchase ? saleFromRecord(purchase) : null;
  if (!sale) return null;
  return { uses: typeof payload.uses === "number" ? payload.uses : null, purchase: sale };
}

/** All license-verification fields both paths agree on. */
export type GumroadVerificationResult =
  | { via: "api" | "license"; sale: GumroadSaleView }
  | { via: "none"; reason: string };

/**
 * Production verifier: prefer the authenticated API, fall back to the
 * tokenless license check when the ping carries a license key. Test pings are
 * never passed here — they carry no real money and are answered earlier.
 *
 * Both paths are additionally pinned to THIS product: a sale that belongs to a
 * different Gumroad product can never fulfill a NASAQ plan, whatever the ping
 * body claimed.
 */
export async function verifyGumroadSale(input: {
  saleId: string | null;
  licenseKey: string | null;
}): Promise<GumroadVerificationResult> {
  const { id: expectedProductId } = await resolveGumroadProductId();
  if (gumroadApiConfigured() && input.saleId) {
    const sale = await fetchGumroadSale(input.saleId);
    if (sale) {
      if (expectedProductId && sale.productId && sale.productId !== expectedProductId) {
        return { via: "none", reason: "product_mismatch" };
      }
      return { via: "api", sale };
    }
    if (!input.licenseKey) return { via: "none", reason: "sale_not_found" };
  }
  if (input.licenseKey) {
    const verified = await verifyGumroadLicense(input.licenseKey);
    if (verified) {
      if (expectedProductId && verified.purchase.productId && verified.purchase.productId !== expectedProductId) {
        return { via: "none", reason: "product_mismatch" };
      }
      return { via: "license", sale: verified.purchase };
    }
    return { via: "none", reason: "license_not_verified" };
  }
  return { via: "none", reason: gumroadApiConfigured() ? "sale_not_found" : "verification_unavailable" };
}

export interface GumroadSubscriberView {
  id: string;
  email: string;
  productId: string;
  status: string;
  recurrence: string | null;
  createdAt: string | null;
  cancelledAt: string | null;
  failedAt: string | null;
  endedAt: string | null;
  variants: Record<string, string> | null;
  chargeOccurrenceCount: number | null;
  licenseKey: string | null;
}

function subscriberFromRecord(record: Record<string, unknown>): GumroadSubscriberView | null {
  const id = asString(record.id);
  const email = asString(record.email) ?? asString(record.user_email);
  if (!id || !email) return null;
  return {
    id,
    email,
    productId: asString(record.product_id) ?? "",
    status: asString(record.status) ?? "alive",
    recurrence: asString(record.recurrence),
    createdAt: asString(record.created_at),
    cancelledAt: asString(record.cancelled_at),
    failedAt: asString(record.failed_at),
    endedAt: asString(record.ended_at),
    variants: variantsFrom(record.variants),
    chargeOccurrenceCount: typeof record.charge_occurrence_count === "number" ? record.charge_occurrence_count : null,
    licenseKey: asString(record.license_key),
  };
}

/** Look up a membership subscriber by buyer email (owner-triggered sync only). */
export async function findGumroadSubscriberByEmail(email: string): Promise<GumroadSubscriberView | null> {
  const token = requireToken();
  // The product id is resolved (env → API by permalink) rather than required:
  // a deployment that only sets the access token can still sync subscribers.
  const { id: productId } = await resolveGumroadProductId();
  if (!productId) throw new GumroadApiError("Gumroad product id could not be resolved", 401);
  const { status, payload } = await apiFetch(
    `/products/${encodeURIComponent(productId)}/subscribers`,
    { params: { access_token: token, email, paginated: "true" } },
  );
  if (status === 404) return null;
  if (status === 401) throw new GumroadApiError("Gumroad rejected the access token", 401);
  if (status >= 400) throw new GumroadApiError("Gumroad API request failed", status);
  const subscribers = Array.isArray(payload?.subscribers) ? payload.subscribers : [];
  for (const entry of subscribers) {
    const record = asRecord(entry);
    const subscriber = record ? subscriberFromRecord(record) : null;
    if (subscriber && subscriber.email.toLowerCase() === email.trim().toLowerCase()) return subscriber;
  }
  return null;
}

export interface GumroadProductView {
  id: string;
  name: string | null;
  permalink: string | null;
  published: boolean | null;
  priceCents: number | null;
  currency: string | null;
}

/**
 * Last path segment of a Gumroad product URL — the value a buyer sees and the
 * one an operator copies into `GUMROAD_PRODUCT_PERMALINK`.
 */
function permalinkFromUrl(value: unknown): string | null {
  const url = asString(value);
  if (!url) return null;
  const withoutQuery = url.split("?")[0]?.replace(/\/+$/, "") ?? "";
  const segment = withoutQuery.split("/").filter(Boolean).pop();
  return segment ? segment.toLowerCase() : null;
}

/** Product status for the owner vault card (read-only diagnostic). */
export async function fetchGumroadProductByPermalink(
  permalink: string,
): Promise<GumroadProductView | null> {
  const token = requireToken();
  const { status, payload } = await apiFetch("/products", { params: { access_token: token } });
  if (status === 401) throw new GumroadApiError("Gumroad rejected the access token", 401);
  if (status >= 400) throw new GumroadApiError("Gumroad API request failed", status);
  const wanted = permalink.trim().toLowerCase();
  const products = Array.isArray(payload?.products) ? payload.products : [];
  for (const entry of products) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = asString(record.id);
    // Gumroad has used several field names for the same idea; a product matches
    // when ANY of them equals the configured permalink. Matching loosely here
    // is what lets a store rename a custom permalink without breaking
    // product-id resolution.
    const candidates = [
      asString(record.permalink),
      asString(record.custom_permalink),
      permalinkFromUrl(record.url),
      permalinkFromUrl(record.short_url),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase());
    if (!id || !candidates.includes(wanted)) continue;
    return {
      id,
      name: asString(record.name),
      permalink: asString(record.permalink) ?? asString(record.custom_permalink) ?? wanted,
      published: typeof record.published === "boolean" ? record.published : null,
      priceCents: typeof record.price_cents === "number" ? record.price_cents : null,
      currency: asString(record.currency_code),
    };
  }
  return null;
}

/**
 * Every product the token can see, normalised. Used by the owner card to prove
 * which real product id the integration is bound to (and to warn when a store
 * hosts several products, where an explicit `GUMROAD_PRODUCT_ID` is required).
 */
export async function listGumroadProducts(): Promise<GumroadProductView[]> {
  const token = requireToken();
  const { status, payload } = await apiFetch("/products", { params: { access_token: token } });
  if (status === 401) throw new GumroadApiError("Gumroad rejected the access token", 401);
  if (status >= 400) throw new GumroadApiError("Gumroad API request failed", status);
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const views: GumroadProductView[] = [];
  for (const entry of products) {
    const record = asRecord(entry);
    if (!record) continue;
    const id = asString(record.id);
    if (!id) continue;
    views.push({
      id,
      name: asString(record.name),
      permalink: asString(record.permalink) ?? asString(record.custom_permalink) ?? null,
      published: typeof record.published === "boolean" ? record.published : null,
      priceCents: typeof record.price_cents === "number" ? record.price_cents : null,
      currency: asString(record.currency_code),
    });
  }
  return views;
}
