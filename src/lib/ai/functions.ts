import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { checkAppSafetyLimit, checkOperationLimit } from "@/lib/policy/limits";
import { noteProviderSignal } from "@/lib/control-plane/snapshot";
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
  type DesignBrief,
  type DesignBriefInput,
  type DesignBriefResult,
} from "./design-contract";
import type { DesignMemoryInput, DesignMemoryView } from "./design-memory";
import { DESIGN_CONSTITUTION_VERSION } from "./design-constitution";

let getRequestRef: typeof import("@tanstack/react-start/server").getRequest | null = null;

/**
 * Shared IP rule (`@/lib/auth/request-ip`): the RIGHTMOST forwarded entry, not
 * the caller-supplied first one — a rotating `x-forwarded-for` used to mint a
 * fresh per-IP bucket on every request.
 */
async function aiServiceClosed(privileged: boolean): Promise<{ ok: false; code: "not_configured"; message: string } | null> {
  const { refreshControlPlane } = await import("@/lib/control-plane/store.server");
  const { gateService } = await import("@/lib/control-plane/decisions");
  const { enforcementPlane } = await import("@/lib/control-plane/snapshot");
  await refreshControlPlane();
  const gate = gateService(enforcementPlane(), "ai", { privileged });
  if (gate.allowed) return null;
  return {
    ok: false,
    code: "not_configured",
    message:
      gate.code === "maintenance"
        ? "خدمة الذكاء الاصطناعي في صيانة بقرار المالك. المحرر والتخزين والقوالب وتسجيل الدخول لم تتوقف."
        : "خدمة الذكاء الاصطناعي متوقفة بقرار المالك. المحرر والتخزين والقوالب وتسجيل الدخول لم تتوقف.",
  };
}

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
  if (code === "provider_quota" || code === "provider_billing") {
    noteProviderSignal("ai", code === "provider_quota" ? "quota" : "billing");
    return "حصة مزود الذكاء الاصطناعي لا تسمح بهذا الطلب. لم يتوقف المحرر ولا التخزين ولا القوالب ولا تسجيل الدخول.";
  }
  if (code === "provider_unavailable" || code === "provider_timeout") {
    noteProviderSignal("ai", code === "provider_timeout" ? "timeout" : "down");
  }
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

    const privileged = access.isAdmin || access.isOwner;
    const closed = await aiServiceClosed(privileged);
    if (closed) return closed;

    // Application-owned budget (`@/lib/policy/limits`). Admins and the owner are
    // exempt from the per-user budget, but the IP safety ceiling still bounds them.
    const verdict = privileged
      ? checkAppSafetyLimit("ai:report", await clientIdentifier(), { isOwner: access.isOwner })
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
    const designPrivileged = access.isAdmin || access.isOwner;
    const designClosed = await aiServiceClosed(designPrivileged);
    if (designClosed) return designClosed;
    const designVerdict = designPrivileged
      ? checkAppSafetyLimit("ai:design", await clientIdentifier(), { isOwner: access.isOwner })
      : checkOperationLimit("ai:design", context.userId, await clientIdentifier());
    if (!designVerdict.allowed) {
      return { ok: false, code: "rate_limited", message: "تم الوصول إلى حد المحاولات المؤقت. حاول بعد دقيقة." };
    }
    try {
      const { generateDesignBrief } = await import("./provider.server");
      const { loadDesignContext } = await import("./design-context.server");
      const learned = await loadDesignContext(context.userId, data.prompt);
      return { ok: true, brief: await generateDesignBrief(data, learned) };
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

    const selectionPrivileged = access.isAdmin || access.isOwner;
    const selectionClosed = await aiServiceClosed(selectionPrivileged);
    if (selectionClosed) return selectionClosed;

    const selectionVerdict = selectionPrivileged
      ? checkAppSafetyLimit("ai:selection", await clientIdentifier(), { isOwner: access.isOwner })
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
 * Design twin preparation. Gemini, when configured, returns art direction.
 * A missing or failing provider is reported as such and does not invent a
 * model response. The editor then builds editable elements locally.
 */
export type DesignTwinPrepareResult =
  | {
      ok: true;
      constitutionVersion: string;
      memory: DesignMemoryView[];
      memoryError?: string;
      gemini:
        | { ok: true; brief: DesignBrief; model: string }
        | { ok: false; code: string; message: string };
    }
  | {
      ok: false;
      code: "unauthorized" | "license_required" | "rate_limited" | "invalid" | "not_configured" | "provider_error";
      message: string;
    };

export const prepareDesignTwinFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: Partial<DesignBriefInput> & { audience?: string }) => data)
  .handler(async ({ data, context }): Promise<DesignTwinPrepareResult> => {
    const input = normalizeDesignBriefInput(data);
    if (!validDesignBriefInput(input)) {
      return { ok: false, code: "invalid", message: "اكتب وصفًا واضحًا للتصميم المطلوب." };
    }
    const { getAuthorizationContext, requireFeature } = await import("@/lib/auth/authorization.server");
    const access = await getAuthorizationContext({
      id: context.userId,
      email: context.userEmail,
      emailVerified: context.userEmailVerified,
    });
    try {
      requireFeature(access, "ai_report");
    } catch {
      return { ok: false, code: "license_required", message: "تحتاج هذه الميزة إلى ترخيص نشط." };
    }
    const privileged = access.isAdmin || access.isOwner;
    const closed = await aiServiceClosed(privileged);
    if (closed) return closed;
    const verdict = privileged
      ? checkAppSafetyLimit("ai:design", await clientIdentifier())
      : checkOperationLimit("ai:design", context.userId, await clientIdentifier());
    if (!verdict.allowed) {
      return { ok: false, code: "rate_limited", message: "تم الوصول إلى حد المحاولات المؤقت. حاول بعد دقيقة." };
    }

    let memory: DesignMemoryView[] = [];
    let memoryNotes = "";
    try {
      const { loadDesignContext } = await import("./design-context.server");
      const learned = await loadDesignContext(context.userId, input.prompt);
      memory = learned.memory;
      memoryNotes = learned.memoryNotes;
    } catch {
      return { ok: false, code: "provider_error", message: "تعذر قراءة ذاكرة التصميم ومراجعه. لم يتم توليد تصميم؛ حاول مجددًا." };
    }

    const audience = String(data.audience ?? "").trim().slice(0, 160);
    const prompt = audience ? `${input.prompt}\nالجمهور: ${audience}` : input.prompt;
    try {
      const { generateDesignBrief } = await import("./provider.server");
      const modelSink = { model: "" };
      const brief = await generateDesignBrief({ ...input, prompt }, { memoryNotes, modelSink });
      return {
        ok: true,
        constitutionVersion: DESIGN_CONSTITUTION_VERSION,
        memory,
        gemini: { ok: true, brief, model: modelSink.model || "gemini-2.5-flash" },
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "provider_error";
      const message = code === "not_configured"
        ? "خدمة Gemini غير مفعّلة في هذه البيئة. لم يتم توليد تصميم؛ حاول مجددًا بعد تفعيل الخدمة."
        : providerFailureMessage(code, "تعذر طلب Gemini. لم يتم توليد تصميم؛ حاول مجددًا بعد تفعيل الخدمة.");
      return {
        ok: true,
        constitutionVersion: DESIGN_CONSTITUTION_VERSION,
        memory,
        gemini: { ok: false, code, message },
      };
    }
  });

export const listDesignMemoryFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true; memory: DesignMemoryView[] } | { ok: false; message: string }> => {
    try {
      const { listDesignMemory } = await import("./design-memory.server");
      return { ok: true, memory: await listDesignMemory(context.userId) };
    } catch {
      return { ok: false, message: "تعذر قراءة ذاكرة التصميم لهذا الحساب." };
    }
  });

export const recordDesignMemoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: Partial<DesignMemoryInput>) => data)
  .handler(async ({ data, context }): Promise<{ ok: true; entry: DesignMemoryView } | { ok: false; code: string; message: string }> => {
    const { getAuthorizationContext, requireFeature } = await import("@/lib/auth/authorization.server");
    const access = await getAuthorizationContext({
      id: context.userId,
      email: context.userEmail,
      emailVerified: context.userEmailVerified,
    });
    try {
      requireFeature(access, "ai_report");
    } catch {
      return { ok: false, code: "license_required", message: "تحتاج هذه الميزة إلى ترخيص نشط." };
    }
    try {
      const { recordDesignMemory } = await import("./design-memory.server");
      const entry = await recordDesignMemory(context.userId, data);
      if (!entry) return { ok: false, code: "invalid", message: "الملاحظة غير مكتملة. الرفض والتصحيح يحتاجان سببًا." };
      return { ok: true, entry };
    } catch {
      return { ok: false, code: "provider_error", message: "تعذر حفظ الملاحظة في حسابك." };
    }
  });

export const deleteDesignMemoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id?: string }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; message: string }> => {
    const id = String(data.id ?? "").trim();
    if (!id) return { ok: false, message: "لا توجد ملاحظة لحذفها." };
    try {
      const { deleteDesignMemory } = await import("./design-memory.server");
      const removed = await deleteDesignMemory(context.userId, id);
      return removed ? { ok: true } : { ok: false, message: "الملاحظة ليست في هذا الحساب." };
    } catch {
      return { ok: false, message: "تعذر حذف الملاحظة." };
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
    fallbacks: string[];
    constitutionVersion: string;
  }> => {
    const model = process.env.NASAQ_AI_MODEL?.trim() || "gemini-2.5-flash";
    return {
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      model,
      fallbacks: ["gemini-3.5-flash", "gemini-3.1-flash-lite"],
      constitutionVersion: DESIGN_CONSTITUTION_VERSION,
      capabilities: [
        "تقرير ذكي",
        "توجيه تصميمي قابل للتحرير",
        "إجراءات النص المحدد",
        "تحليل الصور وOCR",
        "توليد محتوى خام إلى مستند",
        "توأم التصميم",
      ],
    };
  });


export const generateDesignFn = createServerFn({ method: "POST" })
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
    const designPrivileged = access.isAdmin || access.isOwner;
    const designClosed = await aiServiceClosed(designPrivileged);
    if (designClosed) return designClosed;
    const designVerdict = designPrivileged
      ? checkAppSafetyLimit("ai:design", await clientIdentifier(), { isOwner: access.isOwner })
      : checkOperationLimit("ai:design", context.userId, await clientIdentifier());
    if (!designVerdict.allowed) {
      return { ok: false, code: "rate_limited", message: "تم الوصول إلى حد المحاولات المؤقت. حاول بعد دقيقة." };
    }
    try {
      const { generateDesignBrief } = await import("./provider.server");
      const { loadDesignContext } = await import("./design-context.server");
      const learned = await loadDesignContext(context.userId, data.prompt);
      const brief = await generateDesignBrief(data, learned);
      return { ok: true, brief };
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
      return { ok: false, code: "provider_error", message: providerFailureMessage(code, "تعذر توليد التصميم الآن.") };
    }
  });
