/**
 * Owner control-plane server functions.
 *
 * The browser can ask. The server decides, from the verified session, whether
 * the caller is the owner or a platform administrator. A role field in the
 * request body is ignored.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { ControlActor } from "./decisions.ts";
import {
  OPERATION_IDS,
  SERVICE_IDS,
  type ControlPatch,
  type OperationId,
  type ServiceAccess,
  type ServiceId,
} from "./schema.ts";

type VerifiedContext = {
  userId: string;
  userEmail: string | null;
  userEmailVerified: boolean;
};

async function actorFor(context: VerifiedContext): Promise<ControlActor> {
  const { getAuthorizationContext } = await import("@/lib/auth/authorization.server");
  const access = await getAuthorizationContext({
    id: context.userId,
    email: context.userEmail,
    emailVerified: context.userEmailVerified,
  });
  const role = access.isOwner ? "owner" : access.isAdmin ? "admin" : "user";
  return { role, userId: context.userId };
}

function asAccess(value: unknown): ServiceAccess | undefined {
  return value === "public" || value === "authenticated" || value === "entitled" || value === "owner"
    ? value
    : undefined;
}

/** Ignore anything the client sends that is not a known policy field. */
export function parseControlPatch(input: unknown): ControlPatch {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const patch: ControlPatch = {};
  const service = source.service && typeof source.service === "object" ? (source.service as Record<string, unknown>) : null;
  if (service && SERVICE_IDS.includes(service.id as ServiceId)) {
    const retry = service.retry && typeof service.retry === "object" ? (service.retry as Record<string, unknown>) : null;
    patch.service = {
      id: service.id as ServiceId,
      ...(typeof service.enabled === "boolean" ? { enabled: service.enabled } : {}),
      ...(typeof service.maintenance === "boolean" ? { maintenance: service.maintenance } : {}),
      ...(service.availability === "available" || service.availability === "unavailable"
        ? { availability: service.availability }
        : {}),
      ...(asAccess(service.access) ? { access: asAccess(service.access) } : {}),
      ...(service.concurrency != null ? { concurrency: Number(service.concurrency) } : {}),
      ...(retry
        ? {
            retry: {
              ...(retry.maxAttempts != null ? { maxAttempts: Number(retry.maxAttempts) } : {}),
              ...(retry.backoffMs != null ? { backoffMs: Number(retry.backoffMs) } : {}),
            },
          }
        : {}),
    };
  }
  const operation = source.operation && typeof source.operation === "object" ? (source.operation as Record<string, unknown>) : null;
  if (operation && OPERATION_IDS.includes(operation.id as OperationId)) {
    patch.operation = {
      id: operation.id as OperationId,
      ...(operation.userPerMinute != null ? { userPerMinute: Number(operation.userPerMinute) } : {}),
      ...(operation.ipPerMinute != null ? { ipPerMinute: Number(operation.ipPerMinute) } : {}),
    };
  }
  const scalars = [
    "storageQuotaBytes",
    "aiDailyRequestBudget",
    "projectLimit",
    "pageLimit",
    "maxUploadBytes",
    "pollingIntervalMs",
    "backgroundConcurrency",
    "publicCacheTtlMs",
  ] as const;
  for (const key of scalars) {
    if (source[key] != null && Number.isFinite(Number(source[key]))) {
      patch[key] = Number(source[key]);
    }
  }
  return patch;
}

export const getPublicOperationalLimitsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { loadPublicOperational } = await import("./store.server");
  return loadPublicOperational();
});

export const getServiceControlFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const actor = await actorFor(context);
    if (actor.role !== "owner" && actor.role !== "admin") {
      return { ok: false as const, reason: "forbidden" as const };
    }
    const { loadServiceControlView } = await import("./store.server");
    const view = await loadServiceControlView();
    return { ok: true as const, ...view };
  });

export const updateServiceControlFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => parseControlPatch(data))
  .handler(async ({ data, context }) => {
    const actor = await actorFor(context);
    const { saveControlPatch, loadServiceControlView } = await import("./store.server");
    try {
      const saved = await saveControlPatch(actor, data);
      if (!saved.ok) return { ok: false as const, reason: "forbidden" as const };
      const view = await loadServiceControlView();
      return { ok: true as const, rejected: saved.rejected, ...view };
    } catch (error) {
      const { classifyDatabaseFailure } = await import("./decisions");
      if (classifyDatabaseFailure(error) === "quota") {
        return {
          ok: false as const,
          reason: "provider_limited" as const,
          error: "تعذّر حفظ السياسة لأن مزوّد قاعدة البيانات تجاوز حصته. لم يُكتَب أي تغيير، ولم تُوقَف المحرر أو التخزين أو الذكاء الاصطناعي.",
        };
      }
      return {
        ok: false as const,
        reason: "database_unavailable" as const,
        error: "تعذّر حفظ سياسة التشغيل لأن قاعدة البيانات غير متاحة. لم تُغيَّر الخدمات الأخرى.",
      };
    }
  });
