import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { checkAppSafetyLimit, checkOperationLimit } from "@/lib/policy/limits";
import {
  normalizeDraftInput,
  validDraftInput,
  type ReportDraftInput,
  type ReportDraftResult,
} from "./contract";
import {
  cleanSelectionText,
  normalizeSelectionInput,
  validSelectionInput,
  type SelectionActionInput,
  type SelectionActionResult,
} from "./selection-contract";
import {
  normalizeDesignBriefInput,
  validDesignBriefInput,
  type DesignBriefInput,
  type DesignBriefResult,
} from "./design-contract";

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

function providerFailureMessage(code: string, fallback: string): string {
  if (code === "provider_timeout") return "انتهت مهلة خدمة الذكاء الاصطناعي. لم يتغير المستند؛ حاول مرة أخرى.";
  if (code === "provider_aborted") return "أُلغي طلب الذكاء الاصطناعي. لم يتغير المستند.";
  if (code === "provider_auth") return "رفض مزود الذكاء الاصطناعي بيانات الاعتماد. لم يتغير المستند.";
  if (code === "invalid_model") return "نموذج الذكاء الاصطناعي المكوّن غير صالح. لم يتغير المستند.";
  if (code === "provider_blocked") return "حجب مزود الذكاء الاصطناعي هذا الطلب. لم يتغير المستند.";
  if (code === "provider_empty") return "لم يُعد مزود الذكاء الاصطناعي نتيجة قابلة للاستخدام. لم يتغير المستند.";
  if (code === "provider_malformed") return "أعاد مزود الذكاء الاصطناعي نتيجة غير مكتملة. لم يتغير المستند.";
  if (code === "provider_unavailable") return "مزود الذكاء الاصطناعي غير متاح مؤقتًا. لم يتغير المستند.";
  return fallback;
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

    // Application-owned budget (`@/lib/policy/limits`). Admins are exempt from
    // the per-user budget, but the IP safety ceiling still bounds them.
    const verdict = access.isAdmin
      ? checkAppSafetyLimit("ai:report", await clientIdentifier())
      : checkOperationLimit("ai:report", context.userId, await clientIdentifier());
    if (!verdict.allowed) {
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
        message: providerFailureMessage(code, "تعذر توليد المسودة الآن. لم يتغير محتوى المستند."),
      };
    }
  });

/** Gemini supplies art direction; NASAQ turns it into real editable elements. */
export const generateDesignBriefFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: Partial<DesignBriefInput>) => normalizeDesignBriefInput(data))
  .handler(async ({ data, context }): Promise<DesignBriefResult> => {
    if (!validDesignBriefInput(data)) {
      return { ok: false, code: "invalid", message: "اكتب وصفًا واضحًا للتصميم المطلوب." };
    }
    const { getAuthorizationContext, requireFeature } = await import(
      "@/lib/auth/authorization.server"
    );
    const access = await getAuthorizationContext({ id: context.userId, email: context.userEmail, emailVerified: context.userEmailVerified });
    try {
      requireFeature(access, "ai_report");
    } catch {
      return { ok: false, code: "license_required", message: "تحتاج هذه الميزة إلى ترخيص نشط." };
    }
    const designVerdict = access.isAdmin
      ? checkAppSafetyLimit("ai:design", await clientIdentifier())
      : checkOperationLimit("ai:design", context.userId, await clientIdentifier());
    if (!designVerdict.allowed) {
      return { ok: false, code: "rate_limited", message: "تم الوصول إلى حد المحاولات المؤقت. حاول بعد دقيقة." };
    }
    try {
      const { generateDesignBrief } = await import("./provider.server");
      return { ok: true, brief: await generateDesignBrief(data) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "provider_error";
      if (code === "not_configured") {
        return { ok: false, code: "not_configured", message: "خدمة الذكاء الاصطناعي غير مفعّلة لهذه البيئة بعد." };
      }
      if (code === "provider_rate") {
        return { ok: false, code: "rate_limited", message: "مزود الذكاء الاصطناعي مشغول مؤقتًا. حاول بعد قليل." };
      }
      if (code === "provider_rejected") {
        return { ok: false, code: "provider_error", message: "رفض مزود الذكاء الاصطناعي الطلب." };
      }
      return { ok: false, code: "provider_error", message: providerFailureMessage(code, "تعذر توليد التوجيه التصميمي الآن.") };
    }
  });

/**
 * «إجراءات المحتوى المحدد» — transform ONE selected element's text.
 *
 * Same authorization (`ai_report`), same rate-limit discipline as the draft
 * function, but a tighter per-user budget: a transformation is cheap and
 * frequent, so the panel offers it as a button rather than a form. The IP rule
 * is shared with the draft function's helper above.
 */
export const transformSelectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: SelectionActionInput) => data)
  .handler(async ({ data, context }): Promise<SelectionActionResult> => {
    const input = normalizeSelectionInput(data);
    if (!validSelectionInput(input)) {
      return {
        ok: false,
        code: "invalid",
        message: "لا يوجد نص محدد كافٍ لتنفيذ الإجراء.",
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

    const selectionVerdict = access.isAdmin
      ? checkAppSafetyLimit("ai:selection", await clientIdentifier())
      : checkOperationLimit("ai:selection", context.userId, await clientIdentifier());
    if (!selectionVerdict.allowed) {
      return {
        ok: false,
        code: "rate_limited",
        message: "تم الوصول إلى حد المحاولات المؤقت. حاول بعد دقيقة.",
      };
    }

    try {
      const { transformSelection } = await import("./provider.server");
      const text = cleanSelectionText(await transformSelection(input));
      if (!text) throw new Error("empty_result");
      return { ok: true, text };
    } catch (error) {
      const code = error instanceof Error ? error.message : "provider_error";
      if (code === "not_configured") {
        return {
          ok: false,
          code: "not_configured",
          message: "خدمة الذكاء الاصطناعي غير مفعّلة لهذه البيئة بعد.",
        };
      }
      if (code === "provider_rate") {
        return {
          ok: false,
          code: "rate_limited",
          message: "مزود الذكاء الاصطناعي مشغول مؤقتًا. حاول بعد قليل. لم يتغير العنصر.",
        };
      }
      if (code === "provider_rejected") {
        return {
          ok: false,
          code: "provider_error",
          message: "رفض مزود الذكاء الاصطناعي الطلب. لم يتغير العنصر.",
        };
      }
      return {
        ok: false,
        code: "provider_error",
        message: providerFailureMessage(code, "تعذر تنفيذ الإجراء الآن. لم يتغير العنصر."),
      };
    }
  });

/**
 * «نَسَق AI» — the admin-facing status of the ONE AI layer.
 *
 * It answers what an operator can act on: is the Gemini adapter configured at
 * all, and which model answers. It never reads, echoes or hints at the key.
 * Capabilities, licences and rate limits are owned by the calls themselves —
 * this probe reports, it does not authorize anything.
 */
export const nasaqAiStatusFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{
    configured: boolean;
    model: string;
    capabilities: string[];
  }> => {
    const model = process.env.NASAQ_AI_MODEL?.trim() || "gemini-2.5-flash";
    return {
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      model,
      capabilities: [
        "تقرير ذكي",
        "توجيه تصميمي قابل للتحرير",
        "إجراءات النص المحدد",
        "تحليل الصور وOCR",
        "توليد محتوى خام إلى مستند",
      ],
    };
  });
