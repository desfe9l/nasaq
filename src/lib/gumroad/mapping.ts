/**
 * Gumroad ⇄ NASAQ tier mapping — the pure, client-safe half of the Gumroad
 * gateway.
 *
 * The live product is a **membership** with two tiers (option category "Tier"),
 * each selling two recurrences:
 *
 *   https://nasaqar.gumroad.com/l/auaewk
 *     نَسَق | فردي → Monthly 79 SAR / Quarterly 199 SAR
 *     نَسَق | فريق → Monthly 199 SAR / Quarterly 499 SAR
 *
 * A ping carries the tier as `variants` (e.g. {"Tier": "نَسَق | فردي"}) and the
 * billing period separately as `recurrence` — so the NASAQ plan key is derived
 * from BOTH, then cross-checked against the catalog price. Nothing here trusts
 * display names alone when an ID exists: the server-side config carries the
 * product id/permalink and both tier names can be pinned via env, and every
 * sale is re-verified against the Gumroad API before any fulfillment.
 */

export const GUMROAD_PRODUCT_PERMALINK = "auaewk";
export const GUMROAD_STORE_BASE_URL = "https://nasaqar.gumroad.com";
export const GUMROAD_TIER_INDIVIDUAL_NAME = "نَسَق | فردي";
export const GUMROAD_TIER_TEAM_NAME = "نَسَق | فريق";
export const GUMROAD_PING_PATH = "/api/webhooks/gumroad";

/** Prices in the product currency's minor units (halalas), copied from Gumroad. */
export const GUMROAD_PLAN_PRICE_CENTS = {
  "individual-monthly": 7_900,
  "individual-quarterly": 19_900,
  "team-monthly": 19_900,
  "team-quarterly": 49_900,
} as const;

export type GumroadPlanKey = keyof typeof GUMROAD_PLAN_PRICE_CENTS;
export type GumroadTierFamily = "individual" | "team";
export type GumroadRecurrence = "monthly" | "quarterly";

export function isGumroadPlanKey(key: string): key is GumroadPlanKey {
  return Object.prototype.hasOwnProperty.call(GUMROAD_PLAN_PRICE_CENTS, key);
}

/** The four purchasable Gumroad plans, in display order. */
export function listGumroadPlanKeys(): GumroadPlanKey[] {
  return [
    "individual-monthly",
    "individual-quarterly",
    "team-monthly",
    "team-quarterly",
  ];
}

/** Collapse Unicode/width/space noise so Arabic tier names compare stably. */
export function normalizeGumroadTierName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface GumroadPublicConfig {
  readonly storeBaseUrl: string;
  readonly productPermalink: string;
  readonly tierNames: Readonly<Record<GumroadTierFamily, string>>;
}

export const DEFAULT_GUMROAD_PUBLIC_CONFIG: GumroadPublicConfig = {
  storeBaseUrl: GUMROAD_STORE_BASE_URL,
  productPermalink: GUMROAD_PRODUCT_PERMALINK,
  tierNames: {
    individual: GUMROAD_TIER_INDIVIDUAL_NAME,
    team: GUMROAD_TIER_TEAM_NAME,
  },
};

/**
 * Which NASAQ plan a (tier, recurrence) pair maps to.
 *
 * Accepts the variants payload in every shape Gumroad uses: a map
 * ({"Tier": "نَسَق | فردي"}), a formatted string ("Tier: نَسَق | فردي"), or a
 * bare tier name. Unknown pairs return null — never a guessed plan.
 */
export function resolveGumroadPlanKey(input: {
  variants?: Record<string, string> | string | null;
  tierName?: string | null;
  recurrence?: string | null;
  config?: GumroadPublicConfig;
}): GumroadPlanKey | null {
  const config = input.config ?? DEFAULT_GUMROAD_PUBLIC_CONFIG;
  const tier =
    extractTierName(input.variants) ??
    (input.tierName ? normalizeGumroadTierName(input.tierName) : null);
  if (!tier) return null;
  const family = matchGumroadTierFamily(tier, config);
  if (!family) return null;
  const recurrence = normalizeGumroadRecurrence(input.recurrence);
  if (!recurrence) return null;
  return `${family}-${recurrence}`;
}

/** Match a tier name against the two configured tiers, tolerating renames. */
export function matchGumroadTierFamily(
  tierName: string,
  config: GumroadPublicConfig = DEFAULT_GUMROAD_PUBLIC_CONFIG,
): GumroadTierFamily | null {
  const normalized = normalizeGumroadTierName(tierName);
  if (!normalized) return null;
  for (const family of ["individual", "team"] as const) {
    const candidates = [
      config.tierNames[family],
      family === "individual" ? GUMROAD_TIER_INDIVIDUAL_NAME : GUMROAD_TIER_TEAM_NAME,
    ];
    for (const candidate of candidates) {
      const normalizedCandidate = normalizeGumroadTierName(candidate);
      if (normalizedCandidate && normalizedCandidate === normalized) return family;
    }
  }
  // Last-resort alias matching for minor display variations of the same tiers.
  if (/فردي|individual|pro/i.test(normalized)) return "individual";
  if (/فريق|team/i.test(normalized)) return "team";
  return null;
}

export function normalizeGumroadRecurrence(value: string | null | undefined): GumroadRecurrence | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "monthly" || normalized === "every_30_days") return "monthly";
  if (normalized === "quarterly" || normalized === "every_3_months") return "quarterly";
  return null;
}

function extractTierName(variants: Record<string, string> | string | null | undefined): string | null {
  if (!variants) return null;
  if (typeof variants === "string") {
    // "Tier: نَسَق | فردي" or a bare tier name.
    const withoutCategory = variants.includes(":")
      ? variants.slice(variants.indexOf(":") + 1)
      : variants;
    const value = withoutCategory.trim();
    return value ? normalizeGumroadTierName(value) : null;
  }
  const entries = Object.values(variants)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => normalizeGumroadTierName(value));
  for (const value of entries) {
    if (matchGumroadTierFamily(value)) return value;
  }
  return entries[0] ?? null;
}

/**
 * Deep link that opens Gumroad's payment form with the correct tier AND
 * recurrence preselected (Gumroad help article 144: tier first, then the
 * frequency flag, then `wanted=true`). Monthly is the product default.
 */
export function gumroadCheckoutUrl(
  planKey: GumroadPlanKey,
  config: GumroadPublicConfig = DEFAULT_GUMROAD_PUBLIC_CONFIG,
): string {
  const family: GumroadTierFamily = planKey.startsWith("team-") ? "team" : "individual";
  const recurrence: GumroadRecurrence = planKey.endsWith("-quarterly") ? "quarterly" : "monthly";
  const tierParam = encodeURIComponent(config.tierNames[family]);
  const base = `${config.storeBaseUrl.replace(/\/+$/, "")}/l/${config.productPermalink}`;
  return `${base}?tier=${tierParam}&${recurrence}=true&wanted=true`;
}

/** True when a verified sale's amount matches the NASAQ catalog price exactly. */
export function gumroadPriceMatches(
  planKey: GumroadPlanKey,
  amountCents: number | null,
  currency: string | null | undefined,
): boolean {
  // Gumroad re-denominates buyer-facing charges; only enforce the strict price
  // check when the sale is denominated in the seller's currency (SAR).
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents)) return true;
  if (currency && currency.trim().toLowerCase() !== "sar") return true;
  return Math.abs(GUMROAD_PLAN_PRICE_CENTS[planKey] - Math.round(amountCents)) <= 1;
}
