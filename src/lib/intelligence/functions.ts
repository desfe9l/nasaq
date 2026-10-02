import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { LanguageNoteRequest, LanguageNoteResult } from "./provider";

/**
 * Admin-only. The studio already has a measured critique; this only asks for
 * a short note when a model is configured. Customers never reach it.
 */
export const intelligenceNoteFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: LanguageNoteRequest) => ({
    score: Number(data.score) || 0,
    issues: Array.isArray(data.issues) ? data.issues.filter((item) => typeof item === "string").slice(0, 8) : [],
  }))
  .handler(async ({ data, context }): Promise<LanguageNoteResult> => {
    const [{ getSql }, { isAdminIdentity }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/auth/admin-identity.server"),
    ]);
    const allowed = await isAdminIdentity(await getSql(), {
      id: context.userId,
      email: context.userEmail,
    });
    if (!allowed) {
      return { ok: false, code: "unauthorized", note: "" };
    }
    try {
      const { requestLanguageNote } = await import("./provider.server");
      const note = await requestLanguageNote(data);
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
      return {
        ok: false,
        code: "provider_error",
        note: "تعذرت ملاحظة النموذج. التقييم القياسي لم يتغير.",
      };
    }
  });
