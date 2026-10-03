/**
 * Compare the parsed PSD with the NASAQ project and say where they diverge.
 * Unsupported features are reported, not hidden.
 */

import type { CanvasEl, Project } from "../model";
import type { PsdDocument, PsdNode, ValidationIssue, ValidationResult } from "./types";

function flatten(els: CanvasEl[], dx = 0, dy = 0): CanvasEl[] {
  const out: CanvasEl[] = [];
  for (const el of els) {
    const abs = { ...el, x: el.x + dx, y: el.y + dy };
    out.push(abs);
    if (el.children?.length) out.push(...flatten(el.children, abs.x, abs.y));
  }
  return out;
}

function walkNodes(nodes: PsdNode[], into: PsdNode[] = []): PsdNode[] {
  for (const node of nodes) {
    into.push(node);
    if (node.children.length) walkNodes(node.children, into);
  }
  return into;
}

export function validateConversion(doc: PsdDocument, project: Project): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (project.pages.length !== doc.pages.length) {
    issues.push({
      severity: "error",
      code: "pages",
      message: `عدد الصفحات ${project.pages.length} لا يطابق لوحات PSD (${doc.pages.length}).`,
    });
  }
  const dpi = doc.dpi || 72;
  const mm = (px: number) => (px * 25.4) / dpi;
  doc.pages.forEach((page, index) => {
    const got = project.pages[index];
    if (!got) return;
    const expectW = mm(page.widthPx);
    const expectH = mm(page.heightPx);
    const boosted = expectW <= 10 || expectH <= 10;
    if (!boosted && (Math.abs((got.w || 0) - expectW) > 0.6 || Math.abs((got.h || 0) - expectH) > 0.6)) {
      issues.push({
        severity: "error",
        code: "size",
        message: `أبعاد «${got.name}» (${got.w}×${got.h}مم) تبتعد عن الأصل (${expectW.toFixed(1)}×${expectH.toFixed(1)}مم).`,
      });
    }
    const elements = flatten(got.elements);
    const byLayer = new Map(elements.filter((el) => el.source?.layerId).map((el) => [el.source!.layerId, el]));
    for (const node of walkNodes(page.nodes)) {
      if (node.kind === "adjustment" || node.kind === "empty") {
        if (!byLayer.has(node.id)) {
          issues.push({
            severity: "warn",
            code: "skipped",
            message: `«${node.name}» لم تُحوَّل: ${node.issues[0] || "ميزة غير مدعومة"}.`,
          });
        }
        continue;
      }
      const el = byLayer.get(node.id);
      if (!el) {
        issues.push({
          severity: "error",
          code: "missing-layer",
          message: `الطبقة «${node.name}» غير موجودة في مستند نَسَق.`,
        });
        continue;
      }
      if (node.kind === "text" && node.text && el.content !== node.text.content) {
        issues.push({
          severity: "error",
          code: "text",
          message: `نص «${node.name}» لا يطابق الأصل.`,
        });
      }
      if (node.kind === "text" && node.text && el.style.color?.toLowerCase() !== node.text.color.toLowerCase()) {
        issues.push({
          severity: "warn",
          code: "color",
          message: `لون نص «${node.name}» مختلف (${el.style.color} بدل ${node.text.color}).`,
        });
      }
      if (node.kind === "pixels" && !el.src) {
        issues.push({
          severity: "error",
          code: "image",
          message: `الصورة «${node.name}» بلا مصدر.`,
        });
      }
      if (!node.boundsEstimated && node.kind !== "group" && node.width > 1 && node.height > 1 && !boosted) {
        const x = mm(node.left);
        const y = mm(node.top);
        if (Math.abs(el.x - x) > 0.75 || Math.abs(el.y - y) > 0.75) {
          issues.push({
            severity: "warn",
            code: "position",
            message: `موضع «${node.name}» يبتعد أكثر من 0.75مم عن الأصل.`,
          });
        }
      }
      if (node.issues.length) {
        issues.push({
          severity: "warn",
          code: "unsupported",
          message: `«${node.name}»: ${node.issues.join(" · ")}`,
        });
      }
    }
  });
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return { ok: errors === 0, issues };
}
