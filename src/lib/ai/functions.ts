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

async function clientIdentifier(): Promise<string> {
  try {
    getRequestRef ??= (await import("@tanstack/react-start/server")).getRequest;
    const request = getRequestRef();
    return (
      request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request?.headers.get("x-real-ip") ||
      "unknown"
    );
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
      !access.isOwner &&
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
      return {
        ok: false,
        code: "provider_error",
        message: "تعذر توليد المسودة الآن. لم يتغير محتوى المستند.",
      };
    }
  });
