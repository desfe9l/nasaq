import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/license/rate-limit";
import {
  normalizeDraftInput,
  validDraftInput,
  type ReportDraftInput,
  type ReportDraftResult,
} from "./contract";

let getRequestRef: typeof import("@tanstack/react-start/server").getRequest | null = null;

/**
 * Shared IP rule (`@/lib/auth/request-ip`): the RIGHTMOST forwarded entry, not
 * the caller-supplied first one — a rotating `x-forwarded-for` used to mint a
 * fresh per-IP bucket on every request.
 */
async function clientIdentifier(): Promise<string> {
  try {
    getRequestRef ??= (await import("@tanstack/react-start/server")).getRequest;
    const { clientIpFromHeaders } = await import("@/lib/auth/request-ip");
    return clientIpFromHeaders(getRequestRef()?.headers);
  } catch {
    return "unknown";
  }
}

export const generateReportDraftFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: ReportDraftInput) => data)
  .handler(async ({ data, context }): Promise<ReportDraftResult> => {
    const input = normalizeDraftInput(data);
    if (!validDraftInput(input)) {
      return {
        ok: false,
        code: "invalid",
        message: "أدخل وصفاً واضحاً للتقرير والجمهور المستهدف.",
      };
    }

    const { getAuthorizationContext, requireFeature } = await import(
      "@/lib/auth/authorization.server"
    );
    const access = await getAuthorizationContext({
      id: context.userId,
      email: context.userEmail,
    });
    try {
      requireFeature(access, "ai_report");
    } catch {
      return {
        ok: false,
        code: "license_required",
        message: "تحتاج هذه الميزة إلى ترخيص نشط.",
      };
    }

    if (
      !access.isAdmin &&
      (!checkRateLimit("ai:report:user", context.userId, 8, 60_000) ||
        !checkRateLimit("ai:report:ip", await clientIdentifier(), 16, 60_000))
    ) {
      return {
        ok: false,
        code: "rate_limited",
        message: "تم الوصول إلى حد المحاولات المؤقت. حاول بعد دقيقة.",
      };
    }

    try {
      const { generateReportDraft } = await import("./provider.server");
      return { ok: true, draft: await generateReportDraft(input) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "provider_error";
      if (code === "not_configured") {
        return {
          ok: false,
          code: "not_configured",
          message: "خدمة الذكاء الاصطناعي غير مفعّلة لهذه البيئة بعد.",
        };
      }
      if (code === "provider_rejected") {
        return {
          ok: false,
          code: "provider_error",
          message: "رفض مزود الذكاء الاصطناعي الطلب. لم يتغير محتوى المستند.",
        };
      }
      if (code === "provider_rate") {
        return {
          ok: false,
          code: "rate_limited",
          message: "مزود الذكاء الاصطناعي مشغول مؤقتًا. حاول بعد قليل. لم يتغير المستند.",
        };
      }
      if (code === "empty_draft") {
        return {
          ok: false,
          code: "provider_error",
          message: "أعاد الذكاء الاصطناعي مسودة فارغة. لم يتغير محتوى المستند.",
        };
      }
      return {
        ok: false,
        code: "provider_error",
        message: "تعذر توليد المسودة الآن. لم يتغير محتوى المستند.",
      };
    }
  });
