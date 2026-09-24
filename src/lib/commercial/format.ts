/**
 * Shared presentation helpers for the commercial UI.
 *
 * Kept free of server imports so both customer and admin screens can use them.
 */

/** Format a `numeric` price string for display, preserving the stored value. */
export function formatPrice(price: string, currency: string): string {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return `${price} ${currency}`;
  // `numeric` is exact; only the DISPLAY is rounded, never the stored value.
  const formatted = amount.toLocaleString("ar-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${currency}`;
}

/** Format an ISO timestamp as a Gregorian date in Arabic (Saudi Arabia). */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Human label + colour class for each account state. */
export const ACCOUNT_STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  FREE: { label: "بدون باقة", className: "bg-line-2 text-muted" },
  PENDING: { label: "قيد التحقق", className: "bg-gold/20 text-ink" },
  ACTIVE: { label: "مُفعّل", className: "bg-ok/15 text-ok" },
  EXPIRED: { label: "منتهي", className: "bg-danger/10 text-danger" },
  SUSPENDED: { label: "موقوف", className: "bg-danger/10 text-danger" },
};

export const PAYMENT_STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  PENDING: { label: "قيد التحقق", className: "bg-gold/20 text-ink" },
  APPROVED: { label: "مقبول", className: "bg-ok/15 text-ok" },
  REJECTED: { label: "مرفوض", className: "bg-danger/10 text-danger" },
  CANCELLED: { label: "ملغي", className: "bg-line-2 text-muted" },
};

/**
 * What the customer should understand about their current state.
 *
 * Written to be honest: a PENDING account is told verification is waiting on an
 * administrator, never that payment was confirmed — nothing in this app can
 * confirm a transfer, and saying otherwise would be a lie the customer acts on.
 */
export const ACCOUNT_STATUS_MESSAGE: Record<string, string> = {
  FREE: "لا توجد باقة مُفعّلة على حسابك. اختر باقة وأرسل مرجع الحوالة للتحقق منها.",
  PENDING: "تم استلام طلبك وهو الآن قيد التحقق من قِبل الإدارة. سيتم تفعيل الباقة بعد اعتماد الدفعة.",
  ACTIVE: "باقتك مُفعّلة ويمكنك استخدام جميع ميزات المنصة.",
  EXPIRED: "انتهت مدة باقتك. يمكنك التجديد من نفس الحساب دون فقدان أي من مشاريعك.",
  SUSPENDED: "الوصول إلى حسابك موقوف مؤقتاً. تواصل مع الإدارة للمزيد.",
};