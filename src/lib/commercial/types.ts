/**
 * Commercial domain types — shared by client and server.
 *
 * Kept dependency-free (no `@/lib/db`, no React) so the browser can import the
 * types and the plan shape without pulling in a server module. Anything that
 * reads or writes these rows lives in a `.server.ts` file.
 */

/** Account states, in the order a customer moves through them. */
export type AccountStatus =
  | "FREE"
  | "PENDING"
  | "ACTIVE"
  | "EXPIRED"
  | "SUSPENDED";

/** Lifecycle of a single purchase attempt. */
export type PaymentRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED";

/** Status stored on an entitlement row. */
export type SubscriptionStatus = "ACTIVE" | "EXPIRED" | "SUSPENDED";

/**
 * A purchasable plan. `price` is a string, not a number: Postgres `numeric`
 * has no exact float representation, and rounding a price in JS is how a
 * displayed total drifts from the stored one. Format it for display instead.
 */
export type Plan = {
  id: string;
  name: string;
  arabicName: string;
  description: string;
  price: string;
  currency: string;
  durationDays: number;
  features: string[];
  enabled: boolean;
  sortOrder: number;
};

/** The subset of a payment request a customer may see about their own request. */
export type CustomerPaymentRequest = {
  id: string;
  planId: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  paymentReference: string;
  customerNote: string | null;
  status: PaymentRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
  /** The admin's note, surfaced only after review so the customer learns why. */
  adminNote: string | null;
};

/**
 * A customer's own account view. `expiresAt` is authoritative — computed
 * server-side, never from a client clock.
 */
export type CustomerAccount = {
  status: AccountStatus;
  planId: string | null;
  planName: string | null;
  planArabicName: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  /** Whole days remaining; null unless ACTIVE. Never negative. */
  daysRemaining: number | null;
};

/** External payment instructions shown to the customer (admin-editable). */
export type PaymentInstructions = {
  bankName: string;
  accountName: string;
  iban: string;
  instructionsAr: string;
  instructionsEn: string;
};

/** A row in the admin queue. Carries the customer identity an admin needs. */
export type AdminPaymentRequest = CustomerPaymentRequest & {
  userId: string;
  userEmail: string | null;
  userName: string | null;
  /** True when the user already holds a live entitlement (renewal vs first buy). */
  isRenewal: boolean;
};

/** A customer row in the admin list. */
export type AdminCustomer = {
  userId: string;
  email: string | null;
  name: string | null;
  status: AccountStatus;
  planId: string | null;
  expiresAt: string | null;
  createdAt: string;
  pendingPayments: number;
};

/** An audit-log entry for a sensitive admin action. */
export type AdminAuditEntry = {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  /**
   * JSON-safe by design: server-function return values are
   * serialization-validated, so `Record<string, unknown>` would be rejected —
   * and a nested value could otherwise smuggle something unserializable across
   * the boundary.
   */
  detail: Record<string, string | number | boolean | null>;
  createdAt: string;
};

/** Actions recorded in the admin audit log. */
export type AdminAction =
  | "payment.approved"
  | "payment.rejected"
  | "customer.activated"
  | "customer.suspended"
  | "customer.restored"
  | "subscription.extended"
  | "subscription.expiration_changed"
  | "plan.changed"
  | "payment_settings.updated"
  | "admin.granted";

/** Payload for submitting a payment reference. */
export type SubmitPaymentInput = {
  planId: string;
  paymentReference: string;
  customerNote?: string;
};