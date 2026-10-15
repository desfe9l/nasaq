/**
 * What the account surfaces print about a subscription — derived once, here.
 *
 * The identity card, the editor's account area and `/account` all answer the
 * same four questions: WHICH package is on this account, since WHEN, until
 * WHEN, and HOW MUCH of it is left. Three copies of that wording drift (one
 * says «منتهي», another «انتهت المدة», the third forgets the trial), and three
 * copies of the day maths disagree at midnight and on the last day of a period.
 *
 * So the rules live in this module and take exactly what the licence layer
 * already resolved from the server (`useLicense` → `getLicenseStatusFn`).
 * Nothing here decides access; it names the state, and it names it in a shape
 * the UI can render without arithmetic:
 *
 *   • `fields` is ALWAYS four rows, in a fixed order, even for a lifetime plan,
 *     an administrator or a fully unlicensed account (the value is then
 *     `«—»` or «بدون نهاية»). A section that gains or loses a row when data
 *     arrives is a section that visibly jumps — the account card must not.
 *   • `daysRemaining` is a count of CALENDAR days, never a ticking clock, so a
 *     re-render cannot make the number shimmer.
 *   • `elapsedPercent` is the same maths as a progress meter (0 = just
 *     activated, 100 = the period is consumed), clamped so a clock skew can
 *     never draw a bar past its track.
 */

import { LICENSE_TYPE_LABELS, type LicenseInfo } from "../license/types";
import { formatExpiry } from "../license/summary";

/** The empty value every field falls back to — a dash, never a blank row. */
export const SUBSCRIPTION_EMPTY_VALUE = "—";

/** A plan with no expiry date prints this instead of losing its row. */
export const SUBSCRIPTION_OPEN_ENDED = "بدون نهاية";

/** The row keys, in the order the account surfaces print them. */
export const SUBSCRIPTION_FIELD_KEYS = ["plan", "activatedAt", "expiresAt", "remaining"] as const;

export type SubscriptionFieldKey = (typeof SUBSCRIPTION_FIELD_KEYS)[number];

/**
 * The states an account can actually be in. `LIFETIME` and the admin/owner
 * rows are separate from `ACTIVE` because they have no countdown to show.
 */
export type SubscriptionPhase =
  | "LOADING"
  | "OWNER"
  | "ADMIN"
  | "TRIAL"
  | "ACTIVE"
  | "LIFETIME"
  | "FREE"
  | "EXPIRED"
  | "REVOKED"
  | "SUSPENDED";

/** Colour family the surfaces map onto their own tokens. */
export type SubscriptionTone = "loading" | "licensed" | "trial" | "free" | "lapsed" | "restricted";

/** How the meter row is drawn; all three occupy the SAME box. */
export type SubscriptionMeter = "countdown" | "open" | "none";

export type SubscriptionField = {
  key: SubscriptionFieldKey;
  /** Arabic row label («تاريخ التفعيل»). */
  label: string;
  /** Ready-to-print value. Never empty, so the row never collapses. */
  value: string;
  /** A qualification under the value, or `null` when the value says it all. */
  hint: string | null;
};

export type SubscriptionDetail = {
  phase: SubscriptionPhase;
  tone: SubscriptionTone;
  /** «الباقة الحالية» value: احترافي (PRO) / تجربة مجانية / حساب مالك… */
  planLabel: string;
  /** The state of that package: نشطة / منتهية / تجريبية / وصول إداري… */
  statusLabel: string;
  /** One honest line about what the state means for the work on screen. */
  note: string;
  fields: SubscriptionField[];
  /** Whole calendar days left, negative once the period has run out, `null` when there is no expiry. */
  daysRemaining: number | null;
  /** Pre-rendered countdown text (so no surface does Arabic plural maths). */
  daysLabel: string | null;
  /** Percentage of the period already consumed, 0–100; `null` when unmeasurable. */
  elapsedPercent: number | null;
  meter: SubscriptionMeter;
  /** True when the account is a platform administrator/owner: full access, no plan to renew. */
  isAdmin: boolean;
  isOwner: boolean;
  /** The masked key fragment, when the licence has one. */
  keyPrefix: string | null;
};

/** The licence answer, exactly as `useLicense` holds it. Read, never re-decided. */
export type SubscriptionInput = {
  isLoading: boolean;
  hasLicense: boolean;
  isAdmin: boolean;
  isOwner?: boolean;
  isSuspended?: boolean;
  license: LicenseInfo | null;
  trial?: { startedAt: string; expiresAt: string } | null;
  /** The session's account creation date — the activation date an admin has. */
  accountCreatedAt?: string | null;
};

const MS_PER_DAY = 86_400_000;

/** Whole local calendar days between two moments (DST-safe: day numbers, not ms/24). */
function dayNumber(ms: number): number {
  const date = new Date(ms);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

/** Parse an ISO stamp, or `null` for anything a record-keeping bug produced. */
function stamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whole days from `now` until `iso` — negative after it has passed, `0` on the
 * final day itself. A count of DAYS, so the value only moves at midnight and
 * never on a re-render.
 */
export function daysRemainingUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  const ms = stamp(iso);
  if (ms === null) return null;
  return dayNumber(ms) - dayNumber(now);
}

/**
 * How much of the activation → expiry period is already consumed (0–100).
 *
 * `null` when there is no measurable period (no start, no end, or a start that
 * the record put after its own end) so the UI prints the "no meter" state
 * rather than a nonsense bar.
 */
export function elapsedPercentOf(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  now: number = Date.now(),
): number | null {
  const start = stamp(startIso);
  const end = stamp(endIso);
  if (start === null || end === null || end <= start) return null;
  const percent = ((now - start) / (end - start)) * 100;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

/** Arabic countdown text, pluralised by the small numbers that matter here. */
export function daysRemainingLabel(days: number | null): string | null {
  if (days === null) return null;
  if (days > 0 && days <= 2) return days === 1 ? "يوم واحد متبقٍ" : "يومان متبقيان";
  if (days > 2) return `${days} أيام متبقية`;
  if (days === 0) return "ينتهي اليوم";
  return `انتهت المدة منذ ${Math.abs(days)} يومًا`;
}

/** One field row, with the dash fallback applied in one place. */
function field(
  key: SubscriptionFieldKey,
  label: string,
  value: string | null,
  hint: string | null = null,
): SubscriptionField {
  return { key, label, value: value && value.trim() ? value : SUBSCRIPTION_EMPTY_VALUE, hint };
}

/** The four rows every surface prints — always four, always in this order. */
function fields(
  plan: string,
  activated: string | null,
  expires: string | null,
  remaining: string | null,
  hints: Partial<Record<SubscriptionFieldKey, string | null>> = {},
) {
  return [
    field("plan", "الباقة الحالية", plan, hints.plan ?? null),
    field("activatedAt", "تاريخ التفعيل", activated, hints.activatedAt ?? null),
    field("expiresAt", "تاريخ الانتهاء", expires, hints.expiresAt ?? null),
    field("remaining", "المتبقي", remaining, hints.remaining ?? null),
  ];
}

/** The skeleton every surface paints while the server answer is not in yet. */
export const SUBSCRIPTION_LOADING: SubscriptionDetail = {
  phase: "LOADING",
  tone: "loading",
  planLabel: "جارٍ التحقق",
  statusLabel: "جارٍ التحقق",
  note: "قيد القراءة من الخادم — تُعرض البيانات بعد التحقق مباشرة.",
  fields: fields("جارٍ التحقق", null, null, null),
  daysRemaining: null,
  daysLabel: null,
  elapsedPercent: null,
  meter: "none",
  isAdmin: false,
  isOwner: false,
  keyPrefix: null,
};

/**
 * The full account/subscription view for one licence answer.
 *
 * Precedence mirrors the server's own (`licenseStateFromStatus`): a verified
 * administrator or owner first, then the introductory trial, then the licence
 * row, then the lapsed/free view. A suspended account is reported as suspended
 * whatever its licence row says, because that is what the server decided.
 */
export function subscriptionDetail(
  input: SubscriptionInput,
  options: { now?: number } = {},
): SubscriptionDetail {
  const now = options.now ?? Date.now();
  if (input.isLoading) return SUBSCRIPTION_LOADING;

  const accountCreatedAt = input.accountCreatedAt ?? null;
  const license = input.license ?? null;

  if (input.isOwner || input.isAdmin) {
    const isOwner = Boolean(input.isOwner);
    const activated = formatExpiry(license?.activatedAt ?? accountCreatedAt);
    return {
      phase: isOwner ? "OWNER" : "ADMIN",
      tone: "licensed",
      planLabel: isOwner ? "حساب المالك الرئيسي" : "حساب إداري",
      statusLabel: isOwner ? "مالك — وصول كامل" : "وصول إداري كامل",
      note: isOwner
        ? "هذا الحساب يدير المنصة من لوحة الإدارة: الاشتراكات والتراخيص ومحتوى الموقع."
        : "هذا الحساب معتمد كمدير، لذلك يتجاوز فحص الاشتراك ويحصل على كامل الصلاحيات.",
      fields: fields(
        isOwner ? "منصة نَسَق — وصول كامل" : "إداري — وصول كامل",
        activated,
        SUBSCRIPTION_OPEN_ENDED,
        null,
        {
          remaining: isOwner ? "إدارة الاشتراكات من لوحة الإدارة" : "بلا تاريخ انتهاء",
          expiresAt: "صلاحية إدارية موثّقة",
        },
      ),
      daysRemaining: null,
      daysLabel: null,
      elapsedPercent: null,
      meter: "open",
      isAdmin: true,
      isOwner,
      keyPrefix: license?.keyPrefix ?? null,
    };
  }

  if (input.isSuspended) {
    return {
      phase: "SUSPENDED",
      tone: "restricted",
      planLabel: license ? LICENSE_TYPE_LABELS[license.type] : "حساب موقوف",
      statusLabel: "موقوف",
      note: "أوقفت الإدارة هذا الحساب؛ المزايا المدفوعة مقفلة حتى تُستعاد الحالة.",
      fields: fields(
        license ? LICENSE_TYPE_LABELS[license.type] : "حساب موقوف",
        formatExpiry(license?.activatedAt ?? accountCreatedAt),
        formatExpiry(license?.expiresAt ?? null),
        null,
        { remaining: "بانتظار قرار الإدارة" },
      ),
      daysRemaining: null,
      daysLabel: null,
      elapsedPercent: null,
      meter: "none",
      isAdmin: false,
      isOwner: false,
      keyPrefix: license?.keyPrefix ?? null,
    };
  }

  if (input.trial) {
    const days = daysRemainingUntil(input.trial.expiresAt, now);
    const expired = days !== null && days < 0;
    return {
      phase: expired ? "EXPIRED" : "TRIAL",
      tone: expired ? "lapsed" : "trial",
      planLabel: "تجربة مجانية",
      statusLabel: expired ? "انتهت التجربة" : "تجريبية",
      note: expired
        ? "انتهت الفترة التجريبية. المزايا المدفوعة مقفلة، ومشاريعك محفوظة."
        : "كل مزايا الباقة المدفوعة متاحة طوال الفترة التجريبية.",
      fields: fields(
        "تجربة مجانية",
        formatExpiry(input.trial.startedAt),
        formatExpiry(input.trial.expiresAt),
        daysRemainingLabel(days),
        expired ? { remaining: "انتهت الفترة" } : {},
      ),
      daysRemaining: days,
      daysLabel: daysRemainingLabel(days),
      elapsedPercent: elapsedPercentOf(input.trial.startedAt, input.trial.expiresAt, now),
      meter: expired ? "none" : "countdown",
      isAdmin: false,
      isOwner: false,
      keyPrefix: null,
    };
  }

  if (input.hasLicense && license) {
    const lifetime = license.type === "LIFETIME" || !license.expiresAt;
    const days = lifetime ? null : daysRemainingUntil(license.expiresAt, now);
    /*
     * The server still calls this row ACTIVE while its stored expiry sits in
     * the past (a renewal recorded, a revalidation pending). The row prints the
     * server's answer AND the truth about the date, instead of claiming "5 days
     * left" or silently hiding the meter.
     */
    const overdue = days !== null && days < 0;
    return {
      phase: lifetime ? "LIFETIME" : "ACTIVE",
      tone: overdue ? "lapsed" : "licensed",
      planLabel: LICENSE_TYPE_LABELS[license.type],
      statusLabel: lifetime ? "نشطة — مدى الحياة" : overdue ? "نشطة — تجاوزت تاريخ الانتهاء" : "نشطة",
      note: lifetime
        ? "ترخيص دائم: لا تاريخ انتهاء، وكل مزايا الباقة متاحة على هذا الحساب."
        : overdue
          ? "الخادم يعامل هذه الباقة كمُفعّلة؛ سيُحدَّث تاريخ الانتهاء عند إعادة التحقق."
          : "الباقة مُفعّلة، وكل ما تفتحه الباقة متاح الآن.",
      fields: fields(
        LICENSE_TYPE_LABELS[license.type],
        formatExpiry(license.activatedAt ?? license.createdAt),
        lifetime ? SUBSCRIPTION_OPEN_ENDED : formatExpiry(license.expiresAt),
        lifetime ? "وصول دائم" : overdue ? "بانتظار إعادة التحقق" : daysRemainingLabel(days),
        { plan: billingLabel(license) },
      ),
      daysRemaining: days,
      daysLabel: lifetime ? null : daysRemainingLabel(days),
      elapsedPercent: lifetime
        ? null
        : elapsedPercentOf(license.activatedAt ?? license.createdAt, license.expiresAt, now),
      meter: lifetime ? "open" : "countdown",
      isAdmin: false,
      isOwner: false,
      keyPrefix: license.keyPrefix || null,
    };
  }

  /* Nothing active. A lapsed row stays visible so the account knows WHY the
     paid features are locked — and never unlocks anything by doing so. */
  if (license?.status === "REVOKED" || license?.status === "EXPIRED") {
    const revoked = license.status === "REVOKED";
    const days = daysRemainingUntil(license.expiresAt, now);
    return {
      phase: revoked ? "REVOKED" : "EXPIRED",
      tone: "lapsed",
      planLabel: LICENSE_TYPE_LABELS[license.type],
      statusLabel: revoked ? "ملغاة" : "منتهية",
      note: revoked
        ? "أُلغي هذا الترخيص. المزايا المدفوعة مقفلة؛ تواصل مع الإدارة للمراجعة."
        : "انتهت مدة الباقة. مشاريعك وتصاميمك محفوظة، والتجديد يعيد فتح المزايا.",
      fields: fields(
        LICENSE_TYPE_LABELS[license.type],
        formatExpiry(license.activatedAt ?? license.createdAt),
        formatExpiry(license.expiresAt),
        revoked ? "ملغى من الإدارة" : daysRemainingLabel(days),
        revoked ? { expiresAt: "أُلغيت قبل هذا التاريخ" } : {},
      ),
      daysRemaining: revoked ? null : days,
      daysLabel: revoked ? null : daysRemainingLabel(days),
      elapsedPercent: revoked ? null : 100,
      meter: revoked ? "none" : "countdown",
      isAdmin: false,
      isOwner: false,
      keyPrefix: license.keyPrefix || null,
    };
  }

  return {
    phase: "FREE",
    tone: "free",
    planLabel: "حساب مجاني",
    statusLabel: "بدون باقة",
    note: "المحرر والتصدير الأساسي متاحان؛ الباقة تفتح القوالب المتميزة والتصدير المتقدم.",
    fields: fields(
      "حساب مجاني",
      formatExpiry(accountCreatedAt),
      null,
      null,
      {
        activatedAt: "تاريخ إنشاء الحساب",
        expiresAt: "بلا انتهاء — بدون باقة",
        remaining: "اختر باقة لبدء الفترة",
      },
    ),
    daysRemaining: null,
    daysLabel: null,
    elapsedPercent: null,
    meter: "none",
    isAdmin: false,
    isOwner: false,
    keyPrefix: null,
  };
}

/** «فردي · شهري» — the billing shape, when the licence carries one. */
function billingLabel(license: LicenseInfo): string | null {
  if (!license.plan) return null;
  const scope = license.plan.startsWith("team-") ? "فريق" : "فردي";
  const period =
    license.billing === "quarterly" ? "كل 3 أشهر" : license.billing === "annual" ? "سنوي" : "شهري";
  return `${scope} · ${period}`;
}
