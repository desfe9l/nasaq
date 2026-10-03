import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { checkRateLimit } from "@/lib/license/rate-limit";
import {
  normalizeImageAnalysisInput,
  type ImageAnalysisInput,
  type ImageAnalysisResult,
} from "./image-contract";

async function clientIdentifier(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    return (
      request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request?.headers.get("x-real-ip") ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

export const analyzeImageFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (data: Partial<ImageAnalysisInput>) =>
      normalizeImageAnalysisInput(data) ??
      { imageData: "", language: "ar" as const },
  )
  .handler(async ({ data, context }): Promise<ImageAnalysisResult> => {
    if (!data.imageData) {
      return {
        ok: false,
        code: "invalid",
        message: "تعذر تجهيز الصورة للتحليل. جرّب صورة نقطية أخرى.",
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
      (!checkRateLimit("ai:image:user", context.userId, 4, 60_000) ||
        !checkRateLimit("ai:image:ip", await clientIdentifier(), 8, 60_000))
    ) {
      return {
        ok: false,
        code: "rate_limited",
        message: "تم الوصول إلى حد المحاولات المؤقت. حاول بعد دقيقة.",
      };
    }
    try {
      const { analyzeImage } = await import("./provider.server");
      return { ok: true, analysis: await analyzeImage(data) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "provider_error";
      if (code === "not_configured") {
        return {
          ok: false,
          code: "not_configured",
          message: "خدمة تحليل الصور غير مفعّلة لهذه البيئة.",
        };
      }
      if (code === "provider_rate") {
        return {
          ok: false,
          code: "rate_limited",
          message: "الخدمة مشغولة مؤقتًا. حاول بعد قليل.",
        };
      }
      return {
        ok: false,
        code: "provider_error",
        message: "تعذر تحليل الصورة الآن.",
      };
    }
  });
