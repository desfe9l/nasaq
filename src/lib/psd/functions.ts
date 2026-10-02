/**
 * Owner gate for PSD → NASAQ.
 *
 * The file itself is parsed in the browser (a PSD can be far larger than a
 * server function body). This call is still the boundary: a visitor who is
 * not the owner is rejected before any conversion is treated as authorised,
 * and the magic bytes plus the size are checked again on the server. No
 * processing secret is returned to the browser.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { PSD_MAX_BYTES, magicHexOk, sanitizeFileName } from "@/lib/editor/psd/security";

export const psdAuthorizeImportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { fileName: string; byteLength: number; magicHex: string }) => data)
  .handler(async ({ data, context }) => {
    const { verifyTemplateManager } = await import("@/lib/admin/owner-gate.server");
    const { getSql } = await import("@/lib/db");
    const gate = await verifyTemplateManager(
      { userId: context.userId, userEmail: context.userEmail },
      getSql(),
    );
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
