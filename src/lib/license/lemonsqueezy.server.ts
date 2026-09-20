import type { LicensePlan } from "./types";
import { keyPrefix } from "./key";
import { billingForPlan, planForVariantId, type VariantPlanMap } from "./variant";

export interface LemonLicenseVerification {
  key: string;
  plan: LicensePlan;
  variantId: string;
  status: "active" | "inactive" | "expired" | "disabled";
  expiresAt: string | null;
  activationCount: number;
  maxActivations: number | null;
  instanceId?: string;
  metadata: Record<string, string>;
}

export interface LemonLicenseMeta {
  store_id?: number | string;
  product_id?: number | string;
  variant_id?: number | string;
  order_id?: number | string;
  order_item_id?: number | string;
  customer_id?: number | string;
  customer_name?: string;
  customer_email?: string;
}

type LemonResponse = {
  activated?: boolean;
  valid?: boolean;
  error?: string | null;
  license_key?: {
    status?: string;
    expires_at?: string | null;
    activation_usage?: number;
    activation_limit?: number | null;
  };
  meta?: {
    store_id?: number | string;
    product_id?: number | string;
    variant_id?: number | string;
    order_id?: number | string;
    order_item_id?: number | string;
    customer_id?: number | string;
    customer_name?: string;
    customer_email?: string;
  };
  instance?: { id?: string } | null;
  data?: {
    attributes?: LemonResponse["license_key"];
    meta?: LemonResponse["meta"];
  };
};

function env(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value || undefined;
}

function configuredVariants(): Array<{ plan: LicensePlan; id: string }> {
  const entries: Array<[LicensePlan, string]> = [
    ["individual-monthly", "LEMONSQUEEZY_INDIVIDUAL_MONTHLY_VARIANT_ID"],
    ["individual-quarterly", "LEMONSQUEEZY_INDIVIDUAL_QUARTERLY_VARIANT_ID"],
    ["team-monthly", "LEMONSQUEEZY_TEAM_MONTHLY_VARIANT_ID"],
    ["team-quarterly", "LEMONSQUEEZY_TEAM_QUARTERLY_VARIANT_ID"],
  ];
  return entries.flatMap(([plan, key]) => {
    const id = env(key);
    return id ? [{ plan, id }] : [];
  });
}

function configuredVariantMap(): VariantPlanMap {
  return Object.fromEntries(configuredVariants().map(({ plan, id }) => [plan, id])) as VariantPlanMap;
}

function readResponse(response: LemonResponse): { license: NonNullable<LemonResponse["license_key"]>; meta: NonNullable<LemonResponse["meta"]>; instance?: LemonResponse["instance"] } | null {
  const license = response.license_key || response.data?.attributes;
  const meta = response.meta || response.data?.meta;
  if (!license || !meta) return null;
  return { license, meta, instance: response.instance };
}

export function planForVariant(variantId: string): { plan: LicensePlan; id: string } | null {
  return planForVariantId(variantId, configuredVariantMap());
}

export function verifyLemonMetadata(meta: LemonLicenseMeta): { plan: LicensePlan; variantId: string } | null {
  const storeId = env("LEMONSQUEEZY_STORE_ID");
  const productId = env("LEMONSQUEEZY_PRODUCT_ID");
  const variantId = String(meta.variant_id || "");
  if (!storeId || !productId || !variantId) return null;
  if (String(meta.store_id) !== storeId || String(meta.product_id) !== productId) return null;
  const variant = planForVariant(variantId);
  return variant ? { plan: variant.plan, variantId: variant.id } : null;
}

async function requestLicense(action: "activate" | "validate", key: string, instanceId?: string): Promise<LemonLicenseVerification> {
  const form = new URLSearchParams({ license_key: key.trim() });
  if (action === "activate") form.set("instance_name", `NASAQ-${keyPrefix(key)}`);
  if (action === "validate" && instanceId) form.set("instance_id", instanceId);
  const response = await fetch(`https://api.lemonsqueezy.com/v1/licenses/${action}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const payload = (await response.json()) as LemonResponse;
  if (!response.ok) throw new Error("Lemon Squeezy license request failed");
  if ((action === "activate" && payload.activated !== true) || (action === "validate" && payload.valid !== true)) {
    throw new Error(payload.error || "Lemon Squeezy license is invalid");
  }

  const parsed = readResponse(payload);
  if (!parsed) throw new Error("Lemon Squeezy license response was incomplete");
  const verified = verifyLemonMetadata(parsed.meta);
  if (!verified) throw new Error("Lemon Squeezy license metadata did not match NASAQ configuration");

  return {
    key: key.trim(),
    plan: verified.plan,
    variantId: verified.variantId,
    status: "active",
    expiresAt: parsed.license.expires_at || null,
    activationCount: Number(parsed.license.activation_usage || 0),
    maxActivations: parsed.license.activation_limit == null ? null : Number(parsed.license.activation_limit),
    metadata: {
      source: "lemonsqueezy",
      plan: verified.plan,
      billing: billingForPlan(verified.plan),
      variantId: verified.variantId,
      storeId: String(parsed.meta.store_id),
      productId: String(parsed.meta.product_id),
      orderId: String(parsed.meta.order_id || ""),
      orderItemId: String(parsed.meta.order_item_id || ""),
      customerId: String(parsed.meta.customer_id || ""),
      customerEmail: String(parsed.meta.customer_email || ""),
      customerName: String(parsed.meta.customer_name || ""),
      instanceId: parsed.instance?.id || "",
    },
  };
}

export function isLemonSqueezyConfigured(): boolean {
  return Boolean(env("LEMONSQUEEZY_STORE_ID") && env("LEMONSQUEEZY_PRODUCT_ID") && configuredVariants().length);
}

export function activateLemonLicense(key: string): Promise<LemonLicenseVerification> {
  return requestLicense("activate", key);
}

export function validateLemonLicense(key: string, instanceId?: string): Promise<LemonLicenseVerification> {
  return requestLicense("validate", key, instanceId);
}

export async function deactivateLemonLicense(key: string, instanceId: string): Promise<void> {
  const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/deactivate", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ license_key: key.trim(), instance_id: instanceId }),
  });
  const payload = (await response.json().catch(() => null)) as { deactivated?: boolean; error?: string } | null;
  if (!response.ok || payload?.deactivated !== true) throw new Error("Lemon Squeezy license deactivation failed");
}
