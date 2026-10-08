import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { checkAppSafetyLimit, checkOperationLimit } from "@/lib/policy/limits";
import { noteProviderSignal } from "@/lib/control-plane/snapshot";
import {
  normalizeImageAnalysisInput,
  type ImageAnalysisInput,
  type ImageAnalysisResult,
} from "./image-contract";

/**
 * Shared IP rule (`@/lib/auth/request-ip`): the RIGHTMOST forwarded entry, not
 * the caller-supplied first one — a rotating `x-forwarded-for` used to mint a
 * fresh per-IP bucket on every request.
 */
async function clientIdentifier(): Promise<string> {
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

function imageProviderMessage(code: string): string {
  if (code === "provider_quota" || code === "provider_billing") {
    noteProviderSignal("ai", code === "provider_quota" ? "quota" : "billing");
    return "حصة مزود معالجة الصور لا تسمح بهذا الطلب. لم يتوقف المحرر ولا التخزين ولا تسجيل الدخول.";
  }
  if (code === "provider_unavailable" || code === "provider_timeout") {
    noteProviderSignal("image_processing", code === "provider_timeout" ? "timeout" : "down");
  }
  if (code === "provider_timeout") return "انتهت مهلة تحليل الصورة. لم يتغير المستند؛ حاول مرة أخرى.";
  if (code === "provider_aborted") return "أُلغي تحليل الصورة.";
  if (code === "provider_auth") return "رفض مزود تحليل الصور بيانات الاعتماد.";
  if (code === "invalid_model") return "نموذج تحليل الصور المكوّن غير صالح.";
  if (code === "provider_blocked") return "حجب مزود تحليل الصور هذا الطلب.";
  if (code === "provider_empty") return "لم يُعد مزود تحليل الصور نتيجة قابلة للاستخدام.";
  if (code === "provider_malformed") return "أعاد مزود تحليل الصور نتيجة غير مكتملة.";
  if (code === "provider_unavailable") return "مزود تحليل الصور غير متاح مؤقتًا.";
  return "تعذر تحليل الصورة الآن.";
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
      emailVerified: context.userEmailVerified,
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
    const privileged = access.isAdmin || access.isOwner;
    const { refreshControlPlane } = await import("@/lib/control-plane/store.server");
    const { gateService } = await import("@/lib/control-plane/decisions");
    const { enforcementPlane } = await import("@/lib/control-plane/snapshot");
    await refreshControlPlane();
    const gate = gateService(enforcementPlane(), "image_processing", { privileged });
    if (!gate.allowed) {
      return {
        ok: false,
        code: "not_configured",
        message: "معالجة الصور متوقفة بقرار المالك. بقية التطبيق، بما فيه المحرر والتخزين، لم تتوقف.",
      };
    }
    const verdict = privileged
      ? checkAppSafetyLimit("ai:image", await clientIdentifier())
      : checkOperationLimit("ai:image", context.userId, await clientIdentifier());
    if (!verdict.allowed) {
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
        message: imageProviderMessage(code),
      };
    }
  });
