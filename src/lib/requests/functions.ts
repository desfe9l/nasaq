/**
 * Client requests — the platform's server functions.
 *
 * These are the ONLY entry points the browser uses:
 *
 *   • `submitClientRequestFn` — public by design. It runs `optionalAuthMiddleware`,
 *     so a visitor submits without an account while a signed-in caller's request
 *     is associated with their verified account and a snapshot of their licence.
 *     The session is never read from the payload.
 *   • `requestFormSettingsFn` — public read of the form configuration the
 *     administration manages (service types, contact numbers, response promise).
 *   • `myClientRequestsFn` — a signed-in customer's own history, scoped to the
 *     verified user id.
 *   • `adminListClientRequestsFn` / `adminUpdateClientRequestFn` /
 *     `adminSaveRequestSettingsFn` — administrative, each re-verifying the
 *     caller's role on the server before touching customer data.
 *
 * Nothing here returns another customer's data, and no function accepts a role
 * from the request.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, optionalAuthMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  clientRequestCounts,
  listClientRequests,
  listRequestsForUser,
  readRequestSettings,
  saveRequestSettings,
  submitClientRequest,
  updateClientRequest,
  RequestRateLimitedError,
  RequestValidationError,
  type AdminRequestRow,
  type RequestFilters,
  type RequestPatch,
} from "./server";
import {
  DEFAULT_REQUEST_SETTINGS,
  requestKindOptions,
  type ClientRequestSummary,
  type RequestSettings,
  type RequestStatus,
} from "./types";
import {
  isRequestPriority,
  isRequestStatus,
  normalizeResponseNote,
} from "./validation";

/** Best-effort client IP for the visitor throttle. */
async function clientIp(): Promise<string> {
  try {
    const [{ getRequest }, { clientIpFromHeaders }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/lib/auth/request-ip"),
    ]);
    return clientIpFromHeaders(getRequest()?.headers);
  } catch {
    return "unknown";
  }
}

/**
 * The public form configuration.
 *
 * If the database is unreachable the shipped defaults are returned: a contact
 * surface that fails closed would leave customers with no way to reach the
 * platform at all, and these defaults are exactly what a new deployment shows.
 */
export const requestFormSettingsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RequestSettings> => {
    try {
      return await readRequestSettings(await getSql());
    } catch (error) {
      console.error("[requests] settings read failed", error);
      return DEFAULT_REQUEST_SETTINGS;
    }
  },
);

export interface SubmitRequestResult {
  ok: boolean;
  /** Field-level messages, shown next to the form. */
  errors: string[];
  /** True when the submission was throttled rather than rejected. */
  throttled?: boolean;
  request?: {
    id: string;
    createdAt: string;
    serviceLabel: string;
    confirmation: string;
  };
}

export const submitClientRequestFn = createServerFn({ method: "POST" })
  .middleware([optionalAuthMiddleware])
  .validator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<SubmitRequestResult> => {
    const sql = await getSql();
    const settings = await readRequestSettings(sql).catch(
      () => DEFAULT_REQUEST_SETTINGS,
    );

    /*
     * The licence snapshot is best-effort and must never block a submission: a
     * customer writing to us while their entitlement is being revalidated still
     * gets their message through. It is recorded when it can be resolved.
     */
    let licensePlan: string | null = null;
    let licenseStatus: string | null = null;
    if (context.userId) {
      try {
        const { getAuthorizationContext } = await import(
          "@/lib/auth/authorization.server"
        );
        const access = await getAuthorizationContext({
          id: context.userId,
          email: context.userEmail,
          emailVerified: context.userEmailVerified,
        });
        if (access.isAdmin) {
          licensePlan = "إدارة";
          licenseStatus = "ACTIVE";
        } else if (access.license) {
          licensePlan = access.license.metadata?.planKey ?? access.license.type;
          licenseStatus = access.license.status;
        } else if (access.trial) {
          licensePlan = "تجربة";
          licenseStatus = "TRIAL";
        } else {
          licenseStatus = "FREE";
        }
      } catch {
        /* the request is still recorded without the snapshot */
      }
    }

    try {
      const created = await submitClientRequest(
        sql,
        data,
        {
          userId: context.userId,
          userEmail: context.userEmail,
          licensePlan,
          licenseStatus,
        },
        await clientIp(),
      );
      return {
        ok: true,
        errors: [],
        request: {
          id: created.id,
          createdAt: created.createdAt,
          serviceLabel: created.serviceLabel,
          confirmation: settings.confirmationNote,
        },
      };
    } catch (error) {
      if (error instanceof RequestValidationError) {
        return { ok: false, errors: error.errors };
      }
      if (error instanceof RequestRateLimitedError) {
        return {
          ok: false,
          throttled: true,
          errors: [
            "تم إرسال عدة طلبات خلال وقت قصير. حاول مرة أخرى بعد قليل أو استخدم رقم التواصل الظاهر في الصفحة.",
          ],
        };
      }
      console.error("[requests] submission failed", error);
      return {
        ok: false,
        errors: ["تعذّر إرسال الطلب حاليًا. حاول مرة أخرى بعد قليل."],
      };
    }
  });

/** A signed-in customer's own requests — scoped to their verified user id. */
export const myClientRequestsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(
    async ({ context }): Promise<{ requests: ClientRequestSummary[] }> => {
      try {
        const sql = await getSql();
        const settings = await readRequestSettings(sql);
        return { requests: await listRequestsForUser(sql, context.userId, settings) };
      } catch (error) {
        console.error("[requests] history read failed", error);
        return { requests: [] };
      }
    },
  );

export interface AdminRequestsResult {
  requests: AdminRequestRow[];
  counts: Record<RequestStatus | "open", number>;
  kinds: { id: string; label: string }[];
  settings: RequestSettings;
}

/** The administrative inbox. Authorization is re-derived, never accepted. */
export const adminListClientRequestsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: RequestFilters | undefined) => data ?? {})
  .handler(async ({ data, context }): Promise<AdminRequestsResult> => {
    const { requireAdmin } = await import("@/lib/commercial/admin.server");
    const sql = await getSql();
    await requireAdmin(sql, context.userId, context.userEmail, context.userEmailVerified);

    const settings = await readRequestSettings(sql);
    const status = isRequestStatus(data.status) ? data.status : (data.status ?? "all");
    const [requests, counts] = await Promise.all([
      listClientRequests(sql, {
        status,
        kind: data.kind,
        search: data.search,
        limit: data.limit,
      }),
      clientRequestCounts(sql),
    ]);
    return { requests, counts, kinds: requestKindOptions(settings), settings };
  });

/** Update one request: status, priority, assignee and the written answer. */
export const adminUpdateClientRequestFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string } & RequestPatch) => data)
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; error?: string; request?: AdminRequestRow }> => {
      const { requireAdmin } = await import("@/lib/commercial/admin.server");
      const sql = await getSql();
      await requireAdmin(sql, context.userId, context.userEmail, context.userEmailVerified);

      const id = String(data.id ?? "").trim();
      if (!id) return { ok: false, error: "طلب غير معروف." };

      const patch: RequestPatch = {};
      if (data.status !== undefined) {
        if (!isRequestStatus(data.status))
          return { ok: false, error: "حالة غير صالحة." };
        patch.status = data.status;
      }
      if (data.priority !== undefined) {
        if (!isRequestPriority(data.priority))
          return { ok: false, error: "أولوية غير صالحة." };
        patch.priority = data.priority;
      }
      if (data.assignedTo !== undefined)
        patch.assignedTo = String(data.assignedTo ?? "").slice(0, 80);
      if (data.responseNote !== undefined)
        patch.responseNote = normalizeResponseNote(data.responseNote);
      if (data.markResponded !== undefined)
        patch.markResponded = Boolean(data.markResponded);

      const request = await updateClientRequest(sql, id, patch);
      if (!request) return { ok: false, error: "لم يُعثر على الطلب." };

      // Best-effort audit: the console's log answers "who changed this?".
      try {
        const { audit } = await import("@/lib/commercial/admin.server");
        await audit(sql, {
          adminUserId: context.userId,
          action: "client_request.updated",
          targetType: "client_request",
          targetId: id,
          detail: { status: request.status, priority: request.priority },
        });
      } catch {
        /* auditing must not fail the update it describes */
      }
      return { ok: true, request };
    },
  );

/** Administration-managed contact numbers, service types and response copy. */
export const adminSaveRequestSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => data)
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: boolean; error?: string; settings?: RequestSettings }> => {
      const { requireAdmin } = await import("@/lib/commercial/admin.server");
      const sql = await getSql();
      await requireAdmin(sql, context.userId, context.userEmail, context.userEmailVerified);
      try {
        const settings = await saveRequestSettings(sql, data);
        return { ok: true, settings };
      } catch (error) {
        console.error("[requests] settings save failed", error);
        return { ok: false, error: "تعذّر حفظ إعدادات الطلبات." };
      }
    },
  );
