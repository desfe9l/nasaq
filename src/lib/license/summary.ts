/**
 * One wording for "what is this account's licence state?"
 *
 * The editor settings panel, the account chip and the licence page must not
 * describe the same verified state in three ways. The input is exactly what
 * `useLicense` already resolved from the server (`getLicenseStatusFn`) — nothing
 * here re-decides access, it only names the state and its consequence.
 *
 * Import-free so the node test runner can exercise it.
 */

import { LICENSE_TYPE_LABELS, type LicenseInfo } from "./types";

export type LicenseSummaryTone = "licensed" | "free" | "suspended" | "loading";

export type LicenseSummaryInput = {
  isLoading: boolean;
  isAdmin: boolean;
  isSuspended?: boolean;
  hasLicense: boolean;
  license: LicenseInfo | null;
};

export type LicenseSummary = {
  /** The state itself — «احترافي (PRO)», «مجاني», «موقوف بقرار الإدارة»… */
  label: string;
  /** What it means for the work on screen, or `null` when the label says it all. */
  detail: string | null;
  tone: LicenseSummaryTone;
};

/** The paid-feature line an unlicensed/expired/revoked account is told. */
export const RESTRICTED_NOTE =
  "المزايا المدفوعة مقفلة على هذا الحساب — التحرير والتصدير الأساسي متاحان.";

const ARABIC_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

/** Compact Gregorian date, stable in every runtime (no locale dependency). */
export function formatExpiry(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getDate()} ${ARABIC_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function licenseSummary(input: LicenseSummaryInput): LicenseSummary {
  if (input.isLoading) {
    return { label: "جارٍ التحقق", detail: null, tone: "loading" };
  }
  if (input.isAdmin) {
    return { label: "ADMIN — وصول كامل", detail: null, tone: "licensed" };
  }
  if (input.isSuspended) {
    return {
      label: "موقوف بقرار الإدارة",
      detail: "تواصل مع الإدارة لاستعادة التفعيل.",
      tone: "suspended",
    };
  }
  if (input.hasLicense) {
    const license = input.license;
    const type = license ? LICENSE_TYPE_LABELS[license.type] : "مرخّص";
    const expiry = formatExpiry(license?.expiresAt ?? null);
    return {
      label: type,
      detail: expiry ? `صالح حتى ${expiry}` : null,
      tone: "licensed",
    };
  }
  // No active licence. A previous (expired/revoked) row stays visible so the
  // author knows why the paid features are locked — without unlocking anything.
  const previous = input.license;
  if (previous?.status === "REVOKED") {
    return { label: "ترخيص ملغى", detail: RESTRICTED_NOTE, tone: "suspended" };
  }
  if (previous?.status === "EXPIRED") {
    return {
      label: `انتهى ${LICENSE_TYPE_LABELS[previous.type]}`,
      detail: RESTRICTED_NOTE,
      tone: "free",
    };
  }
  if (previous?.status === "ACTIVE") {
    // The server keeps an ACTIVE row visible while a provider check is pending.
    return { label: LICENSE_TYPE_LABELS[previous.type], detail: RESTRICTED_NOTE, tone: "free" };
  }
  return { label: "مجاني", detail: RESTRICTED_NOTE, tone: "free" };
}
