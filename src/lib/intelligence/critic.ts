import { clone, pageSize, type CanvasEl, type Page, type Project } from "@/lib/editor/model";
import { contrastRatio } from "./analyze";
import type { Correction, Critique, CritiqueIssue } from "./schema";
import { INTELLIGENCE_SCHEMA_VERSION } from "./schema";

const CONTENT = new Set(["text", "box", "stat", "table", "stamp"]);
const ARABIC = /[\u0600-\u06FF]/;

function issue(
  id: string,
  severity: CritiqueIssue["severity"],
  metric: string,
  evidence: string,
  instruction: string,
): CritiqueIssue {
  return { id, severity, metric, evidence, instruction };
}

function intersects(a: CanvasEl, b: CanvasEl): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

function isContent(el: CanvasEl): boolean {
  return CONTENT.has(el.type) && !el.hidden;
}

function pageIssues(page: Page, pageIndex: number): CritiqueIssue[] {
  const found: CritiqueIssue[] = [];
  const size = pageSize(page);
  const margin = Math.min(16, Math.max(8, size.w * 0.05));
  const content = page.elements.filter(isContent);

  if (!page.elements.length) {
    found.push(
      issue(
        `${page.id}-empty`,
        "high",
        "density",
        `الصفحة ${pageIndex + 1} بلا عناصر.`,
        "أضف ترويسة وعنوانًا ومتنًا داخل الهامش، أو احذف الصفحة الفارغة.",
      ),
    );
  }

  content.forEach((el) => {
    const arabic = ARABIC.test(el.content || "");
    if (arabic && (el.style.textAlign === "left" || el.style.direction === "ltr")) {
      found.push(
        issue(
          `${el.id}-rtl`,
          "high",
          "rtl",
          `«${(el.content || "").slice(0, 32)}» محاذاته يسار أو اتجاهه لاتيني.`,
          "اجعل الاتجاه rtl والمحاذاة يمينًا. لا تعكس صفحة إنجليزية؛ النص عربي.",
        ),
      );
    }
    const bleeds =
      el.x < margin - 0.5 ||
      el.y < 2 ||
      el.x + el.w > size.w - margin + 0.5 ||
      el.y + el.h > size.h - 6;
    const fullBar = el.w >= size.w - 2;
    if (bleeds && !fullBar && el.type !== "stamp" && el.name !== "رقم الصفحة") {
      found.push(
        issue(
          `${el.id}-margin`,
          "medium",
          "margin",
          `العنصر «${el.name}» عند (${Math.round(el.x)}, ${Math.round(el.y)}) خارج هامش ${Math.round(margin)}مم.`,
          `انقل «${el.name}» إلى داخل الهامش (${Math.round(margin)}مم) دون تغيير نصه.`,
        ),
      );
    }
    const sizePt = Number(el.style.fontSize || 0);
    if (el.type === "text" && sizePt > 0 && sizePt < 8 && (el.content || "").length > 1) {
      found.push(
        issue(
          `${el.id}-type`,
          "low",
          "type",
          `حجم «${el.name}» هو ${sizePt}.`,
          "ارفع الحجم إلى 8 على الأقل حتى يبقى سطر البيانات مقروءًا.",
        ),
      );
    }
    if (
      el.style.color &&
      el.style.fill &&
      el.style.color.startsWith("#") &&
      el.style.fill.startsWith("#") &&
      contrastRatio(el.style.color, el.style.fill) < 3
    ) {
      found.push(
        issue(
          `${el.id}-contrast`,
          "medium",
          "contrast",
          `تباين «${el.name}» أقل من 3:1.`,
          "بدّل لون النص إلى حبر داكن على الحشو الفاتح، أو إلى ورق فاتح على الحقل الداكن.",
        ),
      );
    }
  });

  for (let i = 0; i < content.length; i += 1) {
    for (let j = i + 1; j < content.length; j += 1) {
      const area = intersects(content[i], content[j]);
      if (area < 8) continue;
      found.push(
        issue(
          `${content[i].id}-${content[j].id}-overlap`,
          "high",
          "overlap",
          `«${content[i].name}» يتقاطع مع «${content[j].name}» بمساحة ${Math.round(area)} مم².`,
          `أنزل العنصر الأدنى ${Math.round(area > 40 ? 6 : 4)}مم تحت الآخر واترك 4مم بينهما.`,
        ),
      );
    }
  }

  const sizes = new Set(
    content.map((el) => Number(el.style.fontSize || 0)).filter((value) => value > 0),
  );
  if (sizes.size > 6) {
    found.push(
      issue(
        `${page.id}-scale`,
        "low",
        "hierarchy",
        `الصفحة ${pageIndex + 1} تستخدم ${sizes.size} أحجام خط.`,
        "اخفض السلم إلى عرض وعنوان ومتن وبيانات ورقم صفحة.",
      ),
    );
  }

  return found;
}

export function critiqueProject(project: Project): Critique {
  const issues = project.pages.flatMap(pageIssues);
  const score = issues.reduce((total, item) => {
    if (item.severity === "high") return total - 16;
    if (item.severity === "medium") return total - 8;
    return total - 3;
  }, 100);
  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    score: Math.max(0, Math.min(100, score)),
    issues,
  };
}

function onFill(fill: string): string {
  const raw = fill.replace("#", "");
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma > 0.6 ? "#172033" : "#f7f6f3";
}

/**
 * Applies only the corrections the critic can justify. Content strings,
 * element types, and page sizes stay put.
 */
export function applySafeFixes(project: Project): { project: Project; corrections: Correction[] } {
  const next = clone(project);
  const corrections: Correction[] = [];

  const record = (
    pageId: string,
    el: CanvasEl,
    action: string,
    instruction: string,
    before: Record<string, string | number>,
    after: Record<string, string | number>,
  ) => {
    corrections.push({ pageId, elementId: el.id, action, instruction, before, after });
  };

  for (const page of next.pages) {
    const size = pageSize(page);
    const margin = Math.min(16, Math.max(8, size.w * 0.05));
    for (const el of page.elements) {
      if (!isContent(el)) continue;
      if (ARABIC.test(el.content || "") && (el.style.textAlign === "left" || el.style.direction !== "rtl")) {
        const before = {
          textAlign: el.style.textAlign || "",
          direction: el.style.direction || "",
        };
        if (el.style.textAlign === "left") el.style.textAlign = "right";
        el.style.direction = "rtl";
        record(page.id, el, "rtl", "اتجاه عربي ومحاذاة يمين.", before, {
          textAlign: el.style.textAlign || "",
          direction: "rtl",
        });
      }
      if (
        el.style.color?.startsWith("#") &&
        el.style.fill?.startsWith("#") &&
        contrastRatio(el.style.color, el.style.fill) < 3
      ) {
        const before = el.style.color;
        el.style.color = onFill(el.style.fill);
        record(page.id, el, "contrast", "رفع التباين فوق 3:1.", { color: before }, { color: el.style.color });
      }
      const fontSize = Number(el.style.fontSize || 0);
      if (el.type === "text" && fontSize > 0 && fontSize < 8 && (el.content || "").length > 1 && el.name !== "رقم الصفحة") {
        el.style.fontSize = 8;
        record(page.id, el, "type", "رفع الحجم إلى 8.", { fontSize }, { fontSize: 8 });
      }
      if (el.hfRole || el.name === "رقم الصفحة") continue;
      const beforeBox = { x: el.x, y: el.y, w: el.w, h: el.h };
      let moved = false;
      if (el.x < margin) {
        el.x = margin;
        moved = true;
      }
      if (el.x + el.w > size.w - margin) {
        el.w = Math.max(12, size.w - margin - el.x);
        moved = true;
      }
      if (el.y < 0) {
        el.y = 0;
        moved = true;
      }
      if (el.y + el.h > size.h - 4) {
        el.y = Math.max(0, size.h - 4 - el.h);
        moved = true;
      }
      if (moved) {
        record(page.id, el, "margin", `إدخال «${el.name}» إلى الهامش ${Math.round(margin)}مم.`, beforeBox, {
          x: Math.round(el.x * 10) / 10,
          y: Math.round(el.y * 10) / 10,
          w: Math.round(el.w * 10) / 10,
          h: Math.round(el.h * 10) / 10,
        });
      }
    }

    const content = page.elements.filter(isContent).sort((a, b) => a.y - b.y || a.x - b.x);
    for (let pass = 0; pass < 4; pass += 1) {
      let changed = false;
      for (let i = 0; i < content.length; i += 1) {
        for (let j = i + 1; j < content.length; j += 1) {
          if (intersects(content[i], content[j]) < 8) continue;
          const lower = content[i].y <= content[j].y ? content[j] : content[i];
          const upper = lower === content[i] ? content[j] : content[i];
          const before = lower.y;
          const target = upper.y + upper.h + 4;
          if (target + lower.h <= size.h - 4) {
            lower.y = target;
            changed = true;
            record(
              page.id,
              lower,
              "overlap",
              `فصل «${lower.name}» عن «${upper.name}» بمسافة 4مم.`,
              { y: Math.round(before * 10) / 10 },
              { y: Math.round(lower.y * 10) / 10 },
            );
          }
        }
      }
      if (!changed) break;
    }
  }

  return { project: next, corrections };
}
