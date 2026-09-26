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
 * Deep link that opens Gumroad's checkout with the correct tier AND recurrence
 * already selected — and without a stop on the public product page.
 *
 * The parameter names are Gumroad's, not ours:
 *   · `variant=<tier name>` — the seller's product page resolves this to the
 *     tier's option id server-side (links_controller: `params[:option] ||=
 *     params[:variant] && product.options.find { |o| o[:name] == params[:variant] }`)
 *     and then redirects into the checkout.
 *   · `monthly=true` / `quarterly=true` — translated into the membership's
 *     recurrence (`params[:recurrence] ||= r if params[r] == "true"`).
 *   · `wanted=true` — required for that resolution to run; it is what sends the
 *     buyer straight to the payment form.
 *
 * VERIFIED against the live product (2026-09-26), by reading the price the
 * checkout actually renders:
 *   variant=نَسَق | فردي & monthly=true   & wanted=true → US$21.06 Monthly   (79 SAR)
 *   variant=نَسَق | فردي & quarterly=true & wanted=true → US$53.06 Quarterly (199 SAR)
 *   variant=نَسَق | فريق & monthly=true   & wanted=true → US$53.06 Monthly   (199 SAR)
 *   variant=نَسَق | فريق & quarterly=true & wanted=true → US$133.07 Quarterly (499 SAR)
 *
 * `tier=` — which this function used before — is NOT read by Gumroad; it fell
 * back to the default tier, so every team button opened the individual price.
 * Do not reintroduce it.
 */
export function gumroadCheckoutUrl(
  planKey: GumroadPlanKey,
  config: GumroadPublicConfig = DEFAULT_GUMROAD_PUBLIC_CONFIG,
  options: { email?: string | null } = {},
): string {
  const family: GumroadTierFamily = planKey.startsWith("team-") ? "team" : "individual";
  const recurrence: GumroadRecurrence = planKey.endsWith("-quarterly") ? "quarterly" : "monthly";
  const tierParam = encodeURIComponent(config.tierNames[family]);
  const base = `${config.storeBaseUrl.replace(/\/+$/, "")}/l/${config.productPermalink}`;
  const url = `${base}?variant=${tierParam}&${recurrence}=true&wanted=true`;
  return withGumroadPrefilledEmail(url, options.email);
}

/**
 * Add Gumroad's documented `email=` autofill (help article 270) so the buyer
 * checks out with the same address their NASAQ account uses — that address is
 * what binds the membership to the account, so a typo here costs a support
 * round trip. An empty/blank email leaves the URL untouched.
 */
export function withGumroadPrefilledEmail(url: string, email: string | null | undefined): string {
  const value = email?.trim();
  if (!value || !value.includes("@")) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}email=${encodeURIComponent(value)}`;
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
