import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { magicMatches } from "@/lib/editor/import/detect";
import type { ImportKind } from "@/lib/editor/import/shared";
import { PSD_MAX_BYTES, magicHexOk, sanitizeFileName } from "@/lib/editor/psd/security";

const OFFICE_MAX_BYTES = 80 * 1024 * 1024;
const IMPORT_FORMATS = new Set<ImportKind>(["psd", "psb", "docx", "pptx", "pdf", "png", "jpg", "svg"]);

async function ownerGate(context: { userId: string | null; userEmail?: string | null }) {
  const { verifyTemplateManager } = await import("@/lib/admin/owner-gate.server");
  const { getSql } = await import("@/lib/db");
  return verifyTemplateManager(
    { userId: context.userId || "", userEmail: context.userEmail ?? null },
    getSql(),
  );
}

export const psdAuthorizeImportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { fileName: string; byteLength: number; magicHex: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await ownerGate(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const size = Number(data.byteLength);
    if (!Number.isFinite(size) || size < 26 || size > PSD_MAX_BYTES) {
      return { ok: false as const, error: "حجم ملف PSD غير مسموح." };
    }
    if (!magicHexOk(String(data.magicHex || ""))) {
      return { ok: false as const, error: "الملف ليس PSD أو PSB." };
    }
    return { ok: true as const, fileName: sanitizeFileName(String(data.fileName || "")) };
  });

/** Owner gate for every format the template importer can actually read. */
export const authorizeTemplateImportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { fileName: string; byteLength: number; magicHex: string; format: string }) => data)
  .handler(async ({ data, context }) => {
    const gate = await ownerGate(context);
    if (!gate.ok) return { ok: false as const, error: gate.error };
    const format = String(data.format || "") as ImportKind;
    if (!IMPORT_FORMATS.has(format)) return { ok: false as const, error: "صيغة غير مدعومة." };
    const size = Number(data.byteLength);
    const min = format === "svg" ? 8 : format === "psd" || format === "psb" ? 26 : 8;
    if (!Number.isFinite(size) || size < min) return { ok: false as const, error: "الملف فارغ أو غير صالح." };
    if (format !== "psd" && format !== "psb" && size > OFFICE_MAX_BYTES) {
      return { ok: false as const, error: "حجم الملف أكبر من ٨٠ ميغابايت." };
    }
    if ((format === "psd" || format === "psb") && size > PSD_MAX_BYTES) {
      return { ok: false as const, error: "حجم ملف PSD غير مسموح." };
    }
    if (!magicMatches(format, String(data.magicHex || ""))) {
      return { ok: false as const, error: "توقيع الملف لا يطابق الصيغة المختارة." };
    }
    return {
      ok: true as const,
      fileName: sanitizeFileName(String(data.fileName || "template")),
      format,
    };
  });
