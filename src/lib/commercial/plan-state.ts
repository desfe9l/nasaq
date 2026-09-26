/**
 * The single line a buyer reads on `/purchase` before choosing a plan:
 * "where am I now?".
 *
 * Kept as a pure function, separate from the page, for two reasons:
 *
 * 1. Every value here comes from the server (`getMyAccountPage` +
 *    `getLicenseStatusFn`) — the page never guesses a status from the browser.
 *    A purchase page that hid the truth would push a subscribed buyer into
 *    paying twice.
 * 2. The six subscription states (Free / Trial / Pro / Lifetime × Expired /
 *    Revoked) are a presentation contract, so they are unit-tested without a
 *    DOM.
 */

import { ACCOUNT_STATUS_META, formatDate } from "./format.ts";
import { LICENSE_TYPE_LABELS, type LicenseInfo } from "../license/types.ts";
import type { CustomerAccount } from "./types.ts";

export type PurchaseStateTone = "ok" | "muted" | "warn" | "danger";

export type PurchaseStateView = {
  /** Chip text, e.g. «احترافي (PRO) · نشط». */
  label: string;
  tone: PurchaseStateTone;
  /** One sentence of context; never empty. */
  detail: string;
};

/** Arabic wording for the three license statuses. */
export const LICENSE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "نشط",
  EXPIRED: "منتهي",
  REVOKED: "ملغى / موقوف",
};

export type PurchaseStateInput = {
  /** A verified, signed-in NASAQ user (the dev fallback identity does not count). */
  signedIn: boolean;
  /** The authoritative account view, or null when unknown. */
  account: CustomerAccount | null;
  /** The authoritative license view, or null when unknown. */
  license: LicenseInfo | null;
  /** A suspended account is blocked regardless of any stored license. */
  isSuspended: boolean;
};

/**
 * Precedence, highest first:
 *
 * 1. Administrator — full access, no subscription needed.
 * 2. Suspended account or REVOKED license — blocked (refund / dispute / stop).
 * 3. A license row (the normal paid path): type × status, plus plan + expiry.
 * 4. An account row that is not FREE (paid but the license row is still
 *    catching up, e.g. the sale is being fulfilled right now).
 * 5. Free — the default, and the only state that invites a purchase.
 */
export function purchaseStateView(input: PurchaseStateInput): PurchaseStateView {
  const { signedIn, account, license, isSuspended } = input;
  const plan = account?.planArabicName ?? account?.planName ?? null;
  const licenseExpiry = license?.expiresAt ? `سارية حتى ${formatDate(license.expiresAt)}` : null;

  if (account?.isAdmin) {
    return {
      label: "إداري — وصول كامل",
      tone: "ok",
      detail: "هذا الحساب معتمد كمدير للمنصة، ولا يحتاج إلى اشتراك.",
    };
  }

  if (isSuspended || license?.status === "REVOKED") {
    return {
      label: license
        ? `${LICENSE_TYPE_LABELS[license.type]} · ${LICENSE_STATUS_LABELS.REVOKED}`
        : "موقوف",
      tone: "danger",
      detail: "الوصول موقوف (إلغاء أو نزاع على الدفع). تواصل مع الدعم لاستعادة التفعيل.",
    };
  }

  if (license) {
    const statusLabel = LICENSE_STATUS_LABELS[license.status] ?? license.status;
    const parts = [plan, licenseExpiry].filter(Boolean);
    return {
      label: `${LICENSE_TYPE_LABELS[license.type]} · ${statusLabel}`,
      tone: license.status === "ACTIVE" ? "ok" : "warn",
      detail: parts.length ? parts.join(" · ") : "أكمل الدفع عبر Gumroad لتفعيل الترخيص.",
    };
  }

  if (account && account.status !== "FREE") {
    const meta = ACCOUNT_STATUS_META[account.status] ?? ACCOUNT_STATUS_META.FREE;
    const parts = [
      plan,
      account.expiresAt ? `سارية حتى ${formatDate(account.expiresAt)}` : null,
      account.status === "ACTIVE" && account.daysRemaining !== null
        ? `المتبقي ${account.daysRemaining} يومًا`
        : null,
    ].filter(Boolean);
    return {
      label: meta.label,
      tone:
        account.status === "ACTIVE" ? "ok" : account.status === "PENDING" ? "warn" : "danger",
      detail: parts.length ? parts.join(" · ") : "تفاصيل باقتك متاحة في صفحة حسابك.",
    };
  }

  return {
    label: "Free — مجاني",
    tone: "muted",
    detail: signedIn
      ? "لا يوجد اشتراك مدفوع على هذا الحساب بعد؛ اشترِ باقة ويُربط الترخيص تلقائيًا بنفس بريد حسابك."
      : "الخطة المجانية دائمة. سجّل الدخول بحسابك أو اشترِ بنفس بريدك ليُربط الترخيص تلقائيًا.",
  };
}
