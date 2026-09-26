/**
 * Customer-facing commercial API.
 *
 * Every function here runs on the server behind `authMiddleware`, which supplies
 * a VERIFIED user id (`context.userId`). That id — never anything from the
 * request body — is what scopes each query, which is what makes cross-customer
 * access impossible rather than merely unlikely.
 *
 * These are the only routes the customer dashboard calls. They can read only the
 * caller's own account and payment requests, and they can create one new request.
 * Nothing here can grant access: approval is admin-only (`./admin-functions`).
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { getAccount } from "./entitlement.server";
import { getPaymentInstructions } from "./payment-settings.server";
import { getPurchasablePlan, listEnabledPlans } from "./plans.server";
import {
  cancelOwnPaymentRequest,
  createPaymentRequest,
  getOwnPaymentRequest,
  hasPendingPaymentRequest,
  listOwnPaymentRequests,
} from "./payments.server";
import type {
  CustomerAccount,
  CustomerPaymentRequest,
  PaymentInstructions,
  Plan,
} from "./types";

/** The catalog. Public information — safe for the marketing page and the dashboard. */
export const getPlans = createServerFn({ method: "GET" }).handler(
  async (): Promise<Plan[]> => {
    const sql = await getSql();
    return listEnabledPlans(sql);
  },
);

/** The caller's own account summary. Authoritative server-side status. */
export const getMyAccount = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CustomerAccount> => {
    const sql = await getSql();
    // `getAccount`, not the gate: a FREE customer must be able to see their own
    // status and buy a plan. The gate exists for PAID functionality only.
    return getAccount(sql, context.userId);
  });

/** The caller's own payment requests. Scoped by user id in SQL. */
export const getMyPaymentRequests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<CustomerPaymentRequest[]> => {
    const sql = await getSql();
    return listOwnPaymentRequests(sql, context.userId);
  });

/**
 * Everything the account page needs, in one round trip.
 *
 * `pendingPayment` lets the UI show "waiting for review" without a second call,
 * and `isRenewal` tells it whether to frame the offer as a renewal.
 */
export const getMyAccountPage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async ({
      context,
    }): Promise<{
      account: CustomerAccount;
      requests: CustomerPaymentRequest[];
      instructions: PaymentInstructions;
      plans: Plan[];
      hasPending: boolean;
    }> => {
      const sql = await getSql();
      // A FREE customer must reach their own dashboard to buy a plan, so this
      // reads state rather than gating on it.
      //
      // Gumroad claim point: if this verified email bought on Gumroad before
      // having a NASAQ account, bind + fulfill the membership now (Keygen
      // stays the licensing authority; failures never break the page).
      const { claimGumroadSubscriptionsForUser } = await import("@/lib/gumroad/claim.server");
      await claimGumroadSubscriptionsForUser(sql, { userId: context.userId, userEmail: context.userEmail }).catch(() => undefined);
      const account = await getAccount(sql, context.userId);
      const [requests, instructions, plans, hasPending] = await Promise.all([
        listOwnPaymentRequests(sql, context.userId),
        getPaymentInstructions(sql),
        listEnabledPlans(sql),
        hasPendingPaymentRequest(sql, context.userId),
      ]);
      return { account, requests, instructions, plans, hasPending };
    },
  );

/** External payment instructions for the checkout step. */
export const getPaymentInstructionsPublic = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<PaymentInstructions> => {
    const sql = await getSql();
    return getPaymentInstructions(sql);
  });

export type SubmitPaymentResult =
  | { ok: true; request: CustomerPaymentRequest }
  | { ok: false; error: string };

/**
 * Submit a payment reference for review.
 *
 * Deliberately narrow in what it trusts:
 *   - The plan is looked up as a PURCHASABLE plan, so a disabled plan can't be
 *     bought by calling this directly.
 *   - The amount is taken from the PLAN, never from the request body. A client
 *     that sends `amount: "1"` is ignored, so a customer cannot underpay by
 *     editing the payload.
 *   - Only the reference and an optional note come from the caller, and both are
 *     length-capped.
 *
 * The response never claims the payment was verified — it cannot be, without a
 * gateway. The customer is told the truth: it is pending review.
 */
export const submitPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { planId: string; paymentReference: string; customerNote?: string } => {
    const data = input as Record<string, unknown> | null;
    const planId = typeof data?.planId === "string" ? data.planId.trim() : "";
    const paymentReference =
      typeof data?.paymentReference === "string" ? data.paymentReference.trim() : "";
    const customerNote =
      typeof data?.customerNote === "string" ? data.customerNote.trim() : undefined;

    if (!planId) throw new Error("اختر باقة أولاً.");
    if (!paymentReference) throw new Error("أدخل رقم مرجع الحوالة.");
    if (paymentReference.length > 120) throw new Error("رقم المرجع طويل جداً.");
    if (customerNote && customerNote.length > 500) throw new Error("الملاحظة طويلة جداً.");

    return { planId, paymentReference, customerNote };
  })
  .handler(async ({ context, data }): Promise<SubmitPaymentResult> => {
    const sql = await getSql();

    const plan = await getPurchasablePlan(sql, data.planId);
    if (!plan) return { ok: false, error: "الباقة غير متاحة." };

    const instructions = await getPaymentInstructions(sql);
    if (!instructions.iban || !instructions.bankName || !instructions.accountName) {
      return { ok: false, error: "الدفع قريبًا — تعليمات التحويل غير مكتملة." };
    }

    // One open request at a time keeps the admin queue truthful: a second
    // submission while the first is unreviewed would double-count the payment.
    if (await hasPendingPaymentRequest(sql, context.userId)) {
      return {
        ok: false,
        error: "لديك طلب قيد المراجعة بالفعل. انتظر حتى يتم التحقق منه.",
      };
    }

    const request = await createPaymentRequest(sql, {
      userId: context.userId,
      planId: plan.id,
      // Snapshot the plan's price — the customer was quoted this.
      amount: plan.price,
      currency: plan.currency,
      paymentMethod: "MANUAL",
      paymentReference: data.paymentReference,
      customerNote: data.customerNote ?? null,
    });

    return { ok: true, request };
  });

/** Cancel one of the caller's own PENDING requests. */
export const cancelMyPaymentRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { requestId: string } => {
    const requestId =
      typeof (input as Record<string, unknown>)?.requestId === "string"
        ? ((input as Record<string, unknown>).requestId as string).trim()
        : "";
    if (!requestId) throw new Error("معرّف الطلب مطلوب.");
    return { requestId };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean }> => {
    const sql = await getSql();
    // Scoped by user id: someone else's request is simply not cancellable here.
    const ok = await cancelOwnPaymentRequest(sql, context.userId, data.requestId);
    return { ok };
  });

/**
 * Read one of the caller's own requests.
 *
 * Exists mainly to make the ownership boundary explicit and testable: for
 * another customer's id this resolves to null, never to their data.
 */
export const getMyPaymentRequest = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): { requestId: string } => {
    const requestId =
      typeof (input as Record<string, unknown>)?.requestId === "string"
        ? ((input as Record<string, unknown>).requestId as string).trim()
        : "";
    if (!requestId) throw new Error("معرّف الطلب مطلوب.");
    return { requestId };
  })
  .handler(async ({ context, data }): Promise<CustomerPaymentRequest | null> => {
    const sql = await getSql();
    return getOwnPaymentRequest(sql, context.userId, data.requestId);
  });
