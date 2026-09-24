export {
  PAYLINK_PLAN_KEYS,
  paylinkPlanKey,
  isValidPlanKey,
  getCatalogPlan,
  requireCatalogPlan,
  CENTRAL_PLANS,
  listCatalogPlans,
  type PaylinkPlanKey,
  type PaylinkPlanFamily,
  type PaylinkPeriod,
  type CatalogPlan,
} from "../commercial/catalog.ts";

import type { PaylinkPlanKey } from "../commercial/catalog.ts";

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
