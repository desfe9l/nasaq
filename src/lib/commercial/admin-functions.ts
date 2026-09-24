/**
 * Administrative API — the sensitive surface.
 *
 * EVERY function in this file calls `requireAdmin` before doing anything else,
 * and `requireAdmin` resolves admin identity from the verified session plus the
 * `admin_users` table. There is no request field that can make a caller an admin,
 * so invoking these from a customer session is a 403 regardless of how the call
 * is crafted.
 *
 * The authorization check is the FIRST statement in each handler, before any read
 * of customer data — a check placed after a query still leaks whether a row
 * exists through timing and error shape.
 *
 * These functions are imported only by the admin route and its components. That is
 * a bundling convenience, NOT the security boundary: the boundary is the server
 * re-deriving the caller's role on every call.
 */
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  activateCustomer,
  approvePayment,
  changePlan,
  extendSubscription,
  grantAdmin,
  isAdmin,
  listAuditLog,
  listCustomersForAdmin,
  rejectPayment,
  requireAdmin,
  restoreCustomer,
  setExpiration,
  suspendCustomer,
} from "./admin.server";
import { updatePaymentSettings } from "./payment-settings.server";
import { optionalNote, requireId, requirePositiveDays } from "./validation";
import { listAllPlans, updatePlan } from "./plans.server";
import {
  getPaymentRequestForAdmin,
  listPaymentRequestsForAdmin,
} from "./payments.server";
import type {
  AdminAuditEntry,
  AdminCustomer,
  AdminPaymentRequest,
  PaymentInstructions,
  PaymentRequestStatus,
  Plan,
} from "./types";

/**
 * Whether the CALLER is an admin.
 *
 * Used to decide whether to render the admin link, and to guard the admin route.
 * It is a convenience for the UI: every admin action re-checks server-side, so a
 * tampered `true` here buys a customer nothing but a broken page.
 */
export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ isAdmin: boolean }> => {
    const sql = await getSql();
    return { isAdmin: await isAdmin(sql, context.userId) };
  });

/** The admin queue. Optionally filtered by status. */
export const getAdminPaymentRequests = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): { status?: PaymentRequestStatus } => {
    const raw = (input as Record<string, unknown> | null)?.status;
    const allowed: PaymentRequestStatus[] = [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "CANCELLED",
    ];
    return {
      status:
        typeof raw === "string" && (allowed as string[]).includes(raw)
          ? (raw as PaymentRequestStatus)
          : undefined,
    };
  })
  .handler(async ({ context, data }): Promise<AdminPaymentRequest[]> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    return listPaymentRequestsForAdmin(sql, data.status);
  });

/** One request in full, including the customer's reference and note. */
export const getAdminPaymentRequest = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown): { requestId: string } => {
    return {
      requestId: requireId((input as Record<string, unknown>)?.requestId, "معرّف الطلب مطلوب."),
    };
  })
  .handler(async ({ context, data }): Promise<AdminPaymentRequest | null> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    return getPaymentRequestForAdmin(sql, data.requestId);
  });

/** Approve a payment: records the decision and grants the entitlement. */
export const adminApprovePayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { requestId: string; adminNote: string | null } => {
    const data = input as Record<string, unknown> | null;
    return {
      requestId: requireId(data?.requestId, "معرّف الطلب مطلوب."),
      adminNote: optionalNote(data?.adminNote),
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await approvePayment(sql, { adminUserId: context.userId }, data.requestId, data.adminNote);
      return { ok: true };
    } catch (err) {
      // Conflict = already reviewed; surface it so the admin's queue refreshes
      // rather than silently showing a stale row.
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر الاعتماد." };
    }
  });

/** Reject a payment. Leaves any existing entitlement untouched. */
export const adminRejectPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { requestId: string; adminNote: string | null } => {
    const data = input as Record<string, unknown> | null;
    return {
      requestId: requireId(data?.requestId, "معرّف الطلب مطلوب."),
      adminNote: optionalNote(data?.adminNote),
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await rejectPayment(sql, { adminUserId: context.userId }, data.requestId, data.adminNote);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر الرفض." };
    }
  });

/** All customers with derived status — admin-only. */
export const getAdminCustomers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AdminCustomer[]> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    return listCustomersForAdmin(sql);
  });

/** Manually activate (or re-activate) a customer on a plan. */
export const adminActivateCustomer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { userId: string; planId: string } => {
    const data = input as Record<string, unknown> | null;
    const userId = typeof data?.userId === "string" ? data.userId.trim() : "";
    const planId = typeof data?.planId === "string" ? data.planId.trim() : "";
    if (!userId || !planId) throw new Error("المستخدم والباقة مطلوبان.");
    return { userId, planId };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await activateCustomer(sql, { adminUserId: context.userId }, data.userId, data.planId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر التفعيل." };
    }
  });

/** Suspend a customer. Nothing is deleted; access simply stops. */
export const adminSuspendCustomer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { userId: string } => {
    return {
      userId: requireId((input as Record<string, unknown>)?.userId, "معرّف المستخدم مطلوب."),
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await suspendCustomer(sql, { adminUserId: context.userId }, data.userId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر الإيقاف." };
    }
  });

/** Lift a suspension. */
export const adminRestoreCustomer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { userId: string } => {
    return {
      userId: requireId((input as Record<string, unknown>)?.userId, "معرّف المستخدم مطلوب."),
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await restoreCustomer(sql, { adminUserId: context.userId }, data.userId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر الاستعادة." };
    }
  });

/** Add days to a customer's current period. */
export const adminExtendSubscription = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { userId: string; days: number } => {
    const data = input as Record<string, unknown> | null;
    return {
      userId: requireId(data?.userId, "معرّف المستخدم مطلوب."),
      days: requirePositiveDays(data?.days),
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await extendSubscription(sql, { adminUserId: context.userId }, data.userId, data.days);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر التمديد." };
    }
  });

/** Set an explicit expiry date. */
export const adminSetExpiration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { userId: string; expiresAt: string } => {
    const data = input as Record<string, unknown> | null;
    const userId = typeof data?.userId === "string" ? data.userId.trim() : "";
    const expiresAt = typeof data?.expiresAt === "string" ? data.expiresAt.trim() : "";
    if (!userId) throw new Error("معرّف المستخدم مطلوب.");
    const parsed = new Date(expiresAt);
    if (!expiresAt || Number.isNaN(parsed.getTime())) throw new Error("التاريخ غير صالح.");
    return { userId, expiresAt: parsed.toISOString() };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await setExpiration(
        sql,
        { adminUserId: context.userId },
        data.userId,
        new Date(data.expiresAt),
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر التعديل." };
    }
  });

/** Move a customer to a different plan without changing their expiry. */
export const adminChangePlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { userId: string; planId: string } => {
    const data = input as Record<string, unknown> | null;
    const userId = typeof data?.userId === "string" ? data.userId.trim() : "";
    const planId = typeof data?.planId === "string" ? data.planId.trim() : "";
    if (!userId || !planId) throw new Error("المستخدم والباقة مطلوبان.");
    return { userId, planId };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await changePlan(sql, { adminUserId: context.userId }, data.userId, data.planId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر التغيير." };
    }
  });

/** Every plan, including disabled ones. Admin-only. */
export const getAdminPlans = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Plan[]> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    return listAllPlans(sql);
  });

/** Edit a plan's price, duration, name, or visibility. */
export const adminUpdatePlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (input: unknown): {
      planId: string;
      price?: string;
      durationDays?: number;
      enabled?: boolean;
      name?: string;
      arabicName?: string;
      description?: string;
      sortOrder?: number;
    } => {
      const data = input as Record<string, unknown> | null;
      const planId = typeof data?.planId === "string" ? data.planId.trim() : "";
      if (!planId) throw new Error("معرّف الباقة مطلوب.");

      const patch: Record<string, string | number | boolean> = {};
      if (typeof data?.price === "string") {
        // Validate as a positive number with at most 2 decimals — the column is
        // numeric(12,2), and letting this through unvalidated produces a raw
        // Postgres error instead of a useful message.
        const price = data.price.trim();
        if (!/^\d+(\.\d{1,2})?$/.test(price)) throw new Error("السعر غير صالح.");
        patch.price = price;
      }
      if (typeof data?.durationDays === "number") {
        patch.durationDays = requirePositiveDays(data.durationDays);
      }
      if (typeof data?.enabled === "boolean") patch.enabled = data.enabled;
      if (typeof data?.name === "string" && data.name.trim()) patch.name = data.name.trim();
      if (typeof data?.arabicName === "string" && data.arabicName.trim()) {
        patch.arabicName = data.arabicName.trim();
      }
      if (typeof data?.description === "string") patch.description = data.description.trim();
      if (typeof data?.sortOrder === "number" && Number.isInteger(data.sortOrder)) {
        patch.sortOrder = data.sortOrder;
      }
      return { planId, ...patch };
    },
  )
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    const { planId, ...patch } = data;
    try {
      await updatePlan(sql, planId, patch);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر التحديث." };
    }
  });

/** Replace the external payment instructions. */
export const adminUpdatePaymentSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): PaymentInstructions => {
    const data = input as Record<string, unknown> | null;
    const str = (key: string, max: number): string =>
      typeof data?.[key] === "string" ? (data[key] as string).trim().slice(0, max) : "";
    return {
      bankName: str("bankName", 120),
      accountName: str("accountName", 120),
      iban: str("iban", 40),
      instructionsAr: str("instructionsAr", 1000),
      instructionsEn: str("instructionsEn", 1000),
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await updatePaymentSettings(sql, data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر الحفظ." };
    }
  });

/** Recent sensitive actions. Admin-only; never exposed to customers. */
export const getAdminAuditLog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AdminAuditEntry[]> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    return listAuditLog(sql, 100);
  });

/** Promote a user to administrator. */
export const adminGrantAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown): { userId: string; note?: string } => {
    const data = input as Record<string, unknown> | null;
    const userId = typeof data?.userId === "string" ? data.userId.trim() : "";
    if (!userId) throw new Error("معرّف المستخدم مطلوب.");
    const note = typeof data?.note === "string" && data.note.trim() ? data.note.trim().slice(0, 200) : null;
    return { userId, note: note ?? undefined };
  })
  .handler(async ({ context, data }): Promise<{ ok: boolean; error?: string }> => {
    const sql = await getSql();
    await requireAdmin(sql, context.userId);
    try {
      await grantAdmin(sql, { adminUserId: context.userId }, data.userId, data.note ?? null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "تعذّر المنح." };
    }
  });