export const PAYLINK_PLAN_KEYS = [
  "individual-monthly",
  "individual-annual",
  "team-monthly",
  "team-annual",
] as const;

export type PaylinkPlanKey = (typeof PAYLINK_PLAN_KEYS)[number];
export type PaylinkPlanFamily = "individual" | "team";
export type PaylinkPeriod = "monthly" | "annual";

export function paylinkPlanKey(family: PaylinkPlanFamily, period: PaylinkPeriod): PaylinkPlanKey {
  return `${family}-${period}`;
}

export type PaylinkTransactionStatus =
  | "PENDING"
  | "PROCESSING"
  | "PAID"
  | "FAILED"
  | "CANCELED";

export type PaylinkInvoiceResult =
  | { ok: true; paymentUrl: string; transactionNo: string; orderNumber: string }
  | { ok: false; error: string };

export type PaylinkTransaction = {
  id: string;
  userId: string;
  orderNumber: string;
  transactionNo: string | null;
  planKey: PaylinkPlanKey;
  planId: string;
  amount: string;
  currency: string;
  clientEmail: string | null;
  clientMobile: string | null;
  status: PaylinkTransactionStatus;
  paylinkOrderStatus: string | null;
  licenseId: string | null;
  keygenLicenseId: string | null;
  licenseKey: string | null;
  licenseStatus: "ACTIVE" | "EXPIRED" | "REVOKED" | null;
  entitlementExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type AdminPaylinkTransaction = PaylinkTransaction & {
  userEmail: string | null;
  userName: string | null;
};
