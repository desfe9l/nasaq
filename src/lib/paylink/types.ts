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
  /** Paylink webhook contract marker — `"v2"` once a V2 callback was accepted. */
  apiVersion: string | null;
  /** Gateway method that settled the order (mada, visaMastercard, stcpay, …). */
  paymentType: string | null;
  /** The order number Paylink echoed back on the V2 callback. */
  merchantOrderNumber: string | null;
  /** Merchant mobile as reported by Paylink (V2 merchant block). */
  merchantMobile: string | null;
  /** When Paylink confirmed settlement. */
  paidAt: string | null;
};

export type AdminPaylinkTransaction = PaylinkTransaction & {
  userEmail: string | null;
  userName: string | null;
  /** A local paid row alone is not proof of Keygen user-scope activation. */
  licenseBound: boolean;
};
