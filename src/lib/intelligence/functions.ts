import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getClientIp } from "@/lib/auth/request-ip.server";
import { checkAppSafetyLimit } from "@/lib/policy/limits";
import type { LanguageNoteRequest, LanguageNoteResult } from "./provider";

interface NoteInput extends LanguageNoteRequest {
  images?: string[];
}

/**
 * Admin-only. The studio already has a measured critique; this only asks for
 * a short note when a model is configured. Customers never reach it.
 */
export const intelligenceNoteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: NoteInput) => ({
    score: Number(data.score) || 0,
    issues: Array.isArray(data.issues) ? data.issues.filter((item) => typeof item === "string").slice(0, 8) : [],
    images: Array.isArray(data.images)
      ? data.images.filter((item) => typeof item === "string" && item.startsWith("data:image/")).slice(0, 1)
      : [],
  }))
  .handler(async ({ data, context }): Promise<LanguageNoteResult> => {
    const [{ getSql }, { isAdminIdentity }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/auth/admin-identity.server"),
    ]);
    const allowed = await isAdminIdentity(await getSql(), {
      id: context.userId,
      email: context.userEmail,
      emailVerified: context.userEmailVerified,
    });
    if (!allowed) {
      return { ok: false, code: "unauthorized", note: "" };
    }
    // Admin-only, but it spends real provider money: the application safety
    // ceiling applies to admins too, so a compromised admin session cannot
    // drain the provider budget (`@/lib/policy/limits`).
    if (!checkAppSafetyLimit("ai:admin-note", getClientIp()).allowed) {
      return { ok: false, code: "rate_limited", note: "تم الوصول إلى حد الحماية المؤقت. حاول بعد دقيقة." };
    }
    try {
      const { requestLanguageNote, requestVisualNote } = await import("./provider.server");
      const note = data.images.length ? await requestVisualNote(data) : await requestLanguageNote(data);
      return { ok: true, code: "ok", note };
    } catch (error) {
      const code = error instanceof Error ? error.message : "provider_error";
      if (code === "not_configured") {
        return {
          ok: false,
          code: "not_configured",
          note: "لا يوجد نموذج لغوي مفعّل. التقييم المعتمد هو الفحص القياسي.",
        };
      }
      if (code === "provider_timeout") {
        return { ok: false, code: "provider_error", note: "انتهت مهلة ملاحظة النموذج. التقييم القياسي لم يتغير." };
      }
      if (code === "provider_aborted") {
        return { ok: false, code: "provider_error", note: "أُلغي طلب ملاحظة النموذج. التقييم القياسي لم يتغير." };
      }
      if (code === "provider_blocked") {
        return { ok: false, code: "provider_error", note: "حجب مزود النموذج الطلب. التقييم القياسي لم يتغير." };
      }
      if (code === "provider_unavailable") {
        return { ok: false, code: "provider_error", note: "مزود النموذج غير متاح مؤقتًا. التقييم القياسي لم يتغير." };
      }
      return {
        ok: false,
        code: "provider_error",
        note: "تعذرت ملاحظة النموذج. التقييم القياسي لم يتغير.",
      };
    }
  });
