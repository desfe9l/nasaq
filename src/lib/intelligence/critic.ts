import { clone, pageSize, type CanvasEl, type Page, type Project } from "@/lib/editor/model";
import { contrastRatio } from "./analyze";
import type { Correction, Critique, CritiqueAxis, CritiqueIssue, QualityAxes } from "./schema";
import { INTELLIGENCE_SCHEMA_VERSION } from "./schema";

const CONTENT = new Set(["text", "box", "stat", "table", "stamp"]);
const ARABIC = /[\u0600-\u06FF]/;
const AXES: Array<keyof QualityAxes> = [
  "structure",
  "hierarchy",
  "spacing",
  "alignment",
  "readability",
  "density",
  "consistency",
];

function issue(
  id: string,
  severity: CritiqueIssue["severity"],
  axis: CritiqueAxis,
  metric: string,
  evidence: string,
  instruction: string,
): CritiqueIssue {
  return { id, severity, axis, metric, evidence, instruction };
}

function intersects(a: CanvasEl, b: CanvasEl): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

function isContent(el: CanvasEl): boolean {
  return CONTENT.has(el.type) && !el.hidden;
}

function furniture(el: CanvasEl): boolean {
  return Boolean(el.hfRole) || el.name === "رقم الصفحة";
}

function px(mm: number): number {
  return Math.round(mm * 3.78);
}

export function emptyAxes(): QualityAxes {
  return {
    structure: 100,
    hierarchy: 100,
    spacing: 100,
    alignment: 100,
    readability: 100,
    density: 100,
    consistency: 100,
  };
}

export function scoreAxes(issues: CritiqueIssue[]): QualityAxes {
  const axes = emptyAxes();
  for (const item of issues) {
    const penalty = item.severity === "high" ? 16 : item.severity === "medium" ? 8 : 3;
    axes[item.axis] = Math.max(0, axes[item.axis] - penalty);
  }
  return axes;
}

function pageIssues(page: Page, pageIndex: number, pageCount: number): CritiqueIssue[] {
  const found: CritiqueIssue[] = [];
  const size = pageSize(page);
  const margin = Math.min(16, Math.max(8, size.w * 0.05));
  const content = page.elements.filter(isContent);
  const body = content.filter((el) => !furniture(el));

  if (!page.elements.length) {
    found.push(
      issue(
        `${page.id}-empty`,
        "high",
        "structure",
        "density",
        `الصفحة ${pageIndex + 1} بلا عناصر.`,
        "أضف ترويسة وعنوانًا ومتنًا داخل الهامش، أو احذف الصفحة الفارغة.",
      ),
    );
  }

  if (!(size.w > 10) || !(size.h > 10)) {
    found.push(
      issue(
        `${page.id}-size`,
        "high",
        "structure",
        "geometry",
        `مقاس الصفحة ${pageIndex + 1} غير صالح.`,
        "أبقِ عرض الصفحة وارتفاعها كما في المصدر، وكلاهما أكبر من 10مم.",
      ),
    );
  }

  content.forEach((el) => {
    if (![el.x, el.y, el.w, el.h].every((value) => Number.isFinite(value)) || el.w < 1 || el.h < 1) {
      found.push(
        issue(
          `${el.id}-geometry`,
          "high",
          "structure",
          "geometry",
          `«${el.name}» أبعاده غير صالحة.`,
          "اجعل العرض والارتفاع أرقامًا موجبة، ولا تترك الموضع فارغًا.",
        ),
      );
    }
    const arabic = ARABIC.test(el.content || "");
    if (arabic && (el.style.textAlign === "left" || el.style.direction === "ltr")) {
      found.push(
        issue(
          `${el.id}-rtl`,
          "high",
          "structure",
          "rtl",
          `«${(el.content || "").slice(0, 32)}» محاذاته يسار أو اتجاهه لاتيني.`,
          "اجعل الاتجاه rtl والمحاذاة يمينًا. لا تعكس الحروف؛ النص يُخزَّن بترتيبه المنطقي.",
        ),
      );
    }
    if ((el.type === "text" || el.type === "box") && !(el.content || "").trim()) {
      found.push(
        issue(
          `${el.id}-empty-text`,
          "medium",
          "structure",
          "empty",
          `«${el.name}» بلا نص.`,
          "أبقِ النص الأصلي إن وُجد، أو احذف المربع الفارغ. لا تخترع فقرة.",
        ),
      );
    }
    const outside =
      el.x < -0.5 || el.y < -0.5 || el.x + el.w > size.w + 0.5 || el.y + el.h > size.h + 0.5;
    const fullBar = el.w >= size.w - 2 && el.x >= -0.5;
    if (outside && !fullBar && !furniture(el)) {
      found.push(
        issue(
          `${el.id}-bounds`,
          "high",
          "structure",
          "bounds",
          `«${el.name}» يخرج عن الصفحة (${Math.round(el.x)}, ${Math.round(el.y)}).`,
          `أدخل «${el.name}» كاملًا داخل الصفحة دون تغيير نصه.`,
        ),
      );
    }
    const bleeds =
      el.x < margin - 0.5 ||
      el.y < 2 ||
      el.x + el.w > size.w - margin + 0.5 ||
      el.y + el.h > size.h - 6;
    if (bleeds && !fullBar && !furniture(el) && el.type !== "stamp") {
      found.push(
        issue(
          `${el.id}-margin`,
          "medium",
          "spacing",
          "margin",
          `«${el.name}» عند (${Math.round(el.x)}, ${Math.round(el.y)}) خارج هامش ${Math.round(margin)}مم.`,
          `انقل «${el.name}» إلى داخل الهامش (${Math.round(margin)}مم، حوالي ${px(margin)}بكسل) دون تغيير نصه.`,
        ),
      );
    }
    const sizePt = Number(el.style.fontSize || 0);
    if (el.type === "text" && sizePt > 0 && sizePt < 8 && (el.content || "").length > 1 && !furniture(el)) {
      found.push(
        issue(
          `${el.id}-type`,
          "low",
          "readability",
          "type",
          `حجم «${el.name}» هو ${sizePt}.`,
          "ارفع الحجم إلى 8 على الأقل حتى يبقى السطر مقروءًا.",
        ),
      );
    }
    if (
      el.type === "text" &&
      sizePt > 0 &&
      sizePt <= 12 &&
      el.w > 160 &&
      !furniture(el)
    ) {
      found.push(
        issue(
          `${el.id}-measure`,
          "medium",
          "readability",
          "measure",
          `عرض سطر «${el.name}» هو ${Math.round(el.w)}مم مع حجم ${sizePt}.`,
          `ضيّق «${el.name}» إلى 140مم وأبقِ حافته اليمنى على عمود المحتوى حتى لا يطول السطر.`,
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
          "readability",
          "contrast",
          `تباين «${el.name}» أقل من 3:1.`,
          "بدّل لون النص إلى حبر داكن على الحشو الفاتح، أو إلى ورق فاتح على الحقل الداكن.",
        ),
      );
    }
  });

  for (let i = 0; i < body.length; i += 1) {
    for (let j = i + 1; j < body.length; j += 1) {
      const area = intersects(body[i], body[j]);
      if (area < 8) continue;
      found.push(
        issue(
          `${body[i].id}-${body[j].id}-overlap`,
          "high",
          "structure",
          "overlap",
          `«${body[i].name}» يتقاطع مع «${body[j].name}» بمساحة ${Math.round(area)} مم².`,
          `أنزل العنصر الأدنى ${Math.round(area > 40 ? 6 : 4)}مم (حوالي ${px(area > 40 ? 6 : 4)}بكسل) تحت الآخر واترك 4مم بينهما.`,
        ),
      );
    }
  }

  const texts = body.filter((el) => el.type === "text" && Number(el.style.fontSize || 0) > 0);
  const heads = texts.filter((el) => Number(el.style.fontSize || 0) >= 14);
  if (heads.length >= 2) {
    const sorted = [...heads].sort((a, b) => a.y - b.y || b.x - a.x);
    const biggest = Math.max(...heads.map((el) => Number(el.style.fontSize || 0)));
    if (Number(sorted[0].style.fontSize || 0) + 1 < biggest) {
      found.push(
        issue(
          `${page.id}-hierarchy`,
          "medium",
          "hierarchy",
          "hierarchy",
          `أكبر عنوان في الصفحة ${pageIndex + 1} ليس أول كتلة ظاهرة.`,
          `ارفع «${sorted[0].name}» إلى ${biggest} أو انقل العنوان الأكبر فوق المتن بمسافة 4مم.`,
        ),
      );
    }
  }
  if (pageIndex === 0) {
    const title = texts.find((el) => el.name === "العنوان");
    const titleSize = Number(title?.style.fontSize || 0);
    if (!title || titleSize < 20) {
      found.push(
        issue(
          `${page.id}-cover`,
          "high",
          "hierarchy",
          "cover",
          "الغلاف بلا عنوان بحجم عرض.",
          "ضع العنوان الأصلي في أعلى الغلاف بحجم 22 على الأقل، يمين الصفحة، دون استبداله بعبارة جديدة.",
        ),
      );
    }
  }

  const stacked = [...texts].sort((a, b) => a.y - b.y || b.x - a.x);
  for (let i = 0; i < stacked.length - 1; i += 1) {
    const upper = stacked[i];
    const lower = stacked[i + 1];
    const upperSize = Number(upper.style.fontSize || 0);
    const lowerSize = Number(lower.style.fontSize || 0);
    if (upperSize < lowerSize + 4) continue;
    const gap = lower.y - (upper.y + upper.h);
    if (gap < 0 || gap >= 4) continue;
    const need = Math.round((4 - gap) * 10) / 10;
    found.push(
      issue(
        `${upper.id}-${lower.id}-gap`,
        "medium",
        "spacing",
        "spacing",
        `المسافة بين «${upper.name}» و«${lower.name}» هي ${Math.round(gap * 10) / 10}مم.`,
        `زِد المسافة بين «${upper.name}» وأول كتلة تحته بمقدار ${need}مم (حوالي ${px(need)}بكسل) حتى لا يلتصق العنوان بالمتن.`,
      ),
    );
  }

  const aligned = texts.filter((el) => el.w >= 24);
  if (aligned.length >= 3) {
    const rights = aligned.map((el) => Math.round(el.x + el.w));
    const target = rights.slice().sort((a, b) => a - b)[Math.floor(rights.length / 2)];
    const off = aligned.filter((el) => Math.abs(el.x + el.w - target) > 3);
    if (off.length >= 2) {
      found.push(
        issue(
          `${page.id}-align`,
          "medium",
          "alignment",
          "alignment",
          `${off.length} كتل لا تشارك الحافة اليمنى عند ${target}مم.`,
          `حاذِ الحافة اليمنى لـ «${off[0].name}» مع عمود المحتوى عند ${target}مم. لا تغيّر النص.`,
        ),
      );
    }
  }

  const sizes = new Set(texts.map((el) => Number(el.style.fontSize || 0)).filter((value) => value > 0));
  if (sizes.size > 6) {
    found.push(
      issue(
        `${page.id}-scale`,
        "low",
        "hierarchy",
        "hierarchy",
        `الصفحة ${pageIndex + 1} تستخدم ${sizes.size} أحجام خط.`,
        "اخفض السلم إلى عرض وعنوان ومتن وبيانات ورقم صفحة.",
      ),
    );
  }

  if (body.length) {
    let area = 0;
    for (const el of body) area += Math.max(0, el.w) * Math.max(0, el.h);
    const density = area / Math.max(1, size.w * size.h);
    if (density > 0.78) {
      found.push(
        issue(
          `${page.id}-dense`,
          "medium",
          "density",
          "density",
          `تغطية الصفحة ${pageIndex + 1} حوالي ${Math.round(density * 100)}٪.`,
          "وسّع الفراغ بين الكتل بمقدار 4مم أو انقل كتلة واحدة إلى الصفحة التالية. لا تصغّر المتن تحت 11.",
        ),
      );
    }
  }

  if (pageCount > 1 && pageIndex > 0) {
    const hasHead = page.elements.some((el) => el.hfRole === "header" || el.name === "ترويسة");
    if (!hasHead) {
      found.push(
        issue(
          `${page.id}-running`,
          "low",
          "consistency",
          "consistency",
          `الصفحة ${pageIndex + 1} بلا ترويسة بينما المستند متعدد الصفحات.`,
          "أضف شريط ترويسة بنفس ارتفاع صفحات الداخل (16مم) ونفس محاذاة العنوان الجاري.",
        ),
      );
    }
  }

  return found;
}

export function critiqueProject(project: Project): Critique {
  const issues = project.pages.flatMap((page, index) => pageIssues(page, index, project.pages.length));
  const first = pageSize(project.pages[0]);
  project.pages.slice(1).forEach((page, index) => {
    const size = pageSize(page);
    if (Math.abs(size.w - first.w) > 0.5 || Math.abs(size.h - first.h) > 0.5) {
      issues.push(
        issue(
          `${page.id}-page-size`,
          "high",
          "consistency",
          "page-size",
          `الصفحة ${index + 2} مقاسها ${Math.round(size.w)}×${Math.round(size.h)} بينما الأولى ${Math.round(first.w)}×${Math.round(first.h)}.`,
          "أعد الصفحة إلى مقاس الصفحة الأولى واتجاهها. تغيير المقاس ليس تحسينًا.",
        ),
      );
    }
  });
  const score = issues.reduce((total, item) => {
    if (item.severity === "high") return total - 16;
    if (item.severity === "medium") return total - 8;
    return total - 3;
  }, 100);
  return {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    score: Math.max(0, Math.min(100, score)),
    axes: scoreAxes(issues),
    issues,
  };
}

export function compareQuality(before: Critique, after: Critique): {
  improvedAxes: Array<keyof QualityAxes>;
  realImprovement: boolean;
} {
  const improvedAxes = AXES.filter((key) => after.axes[key] > before.axes[key]);
  return {
    improvedAxes,
    realImprovement: after.score > before.score && after.axes.structure >= before.axes.structure,
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
      if (ARABIC.test(el.content || "") && (el.style.textAlign === "left" || el.style.direction === "ltr")) {
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
      if (el.type === "text" && fontSize > 0 && fontSize < 8 && (el.content || "").length > 1 && !furniture(el)) {
        el.style.fontSize = 8;
        record(page.id, el, "type", "رفع الحجم إلى 8.", { fontSize }, { fontSize: 8 });
      }
      if (furniture(el)) continue;
      const beforeBox = { x: el.x, y: el.y, w: el.w, h: el.h };
      const hits = (box: Pick<CanvasEl, "x" | "y" | "w" | "h">) =>
        page.elements.some(
          (other) => other !== el && isContent(other) && !furniture(other) && intersects({ ...el, ...box }, other) >= 8,
        );
      let moved = false;
      if (el.x < margin && !hits({ x: margin, y: el.y, w: el.w, h: el.h })) {
        el.x = margin;
        moved = true;
      }
      if (el.x + el.w > size.w - margin && el.w < size.w - 2) {
        const nextW = Math.max(12, size.w - margin - el.x);
        if (!hits({ x: el.x, y: el.y, w: nextW, h: el.h })) {
          el.w = nextW;
          moved = true;
        }
      }
      if (el.y < 0) {
        const nextY = 0;
        if (!hits({ x: el.x, y: nextY, w: el.w, h: el.h })) {
          el.y = nextY;
          moved = true;
        }
      }
      if (el.y + el.h > size.h - 4) {
        const nextY = Math.max(0, size.h - 4 - el.h);
        if (!hits({ x: el.x, y: nextY, w: el.w, h: el.h })) {
          el.y = nextY;
          moved = true;
        }
      }
      if (el.type === "text" && Number(el.style.fontSize || 0) <= 12 && el.w > 160) {
        const right = el.x + el.w;
        const nextW = 140;
        const nextX = Math.max(margin, right - nextW);
        if (!hits({ x: nextX, y: el.y, w: nextW, h: el.h })) {
          el.w = nextW;
          el.x = nextX;
          moved = true;
        }
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

    const content = page.elements.filter((el) => isContent(el) && !furniture(el)).sort((a, b) => a.y - b.y || a.x - b.x);
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

    const stacked = content.filter((el) => el.type === "text").sort((a, b) => a.y - b.y);
    for (let i = 0; i < stacked.length - 1; i += 1) {
      const upper = stacked[i];
      const lower = stacked[i + 1];
      if (Number(upper.style.fontSize || 0) < Number(lower.style.fontSize || 0) + 4) continue;
      const gap = lower.y - (upper.y + upper.h);
      if (gap < 0 || gap >= 4) continue;
      const delta = 4 - gap;
      const last = stacked[stacked.length - 1];
      if (last.y + delta + last.h > size.h - 4) continue;
      for (let k = i + 1; k < stacked.length; k += 1) stacked[k].y += delta;
      record(
        page.id,
        lower,
        "spacing",
        `زيادة ${Math.round(delta * 10) / 10}مم بين العنوان والمتن.`,
        { y: Math.round((lower.y - delta) * 10) / 10 },
        { y: Math.round(lower.y * 10) / 10 },
      );
    }

    const aligned = content.filter((el) => el.type === "text" && el.w >= 24);
    if (aligned.length >= 3) {
      const rights = aligned.map((el) => el.x + el.w).sort((a, b) => a - b);
      const target = rights[Math.floor(rights.length / 2)];
      for (const el of aligned) {
        const right = el.x + el.w;
        const drift = Math.abs(right - target);
        if (drift <= 3 || drift > 10) continue;
        const nextX = Math.max(margin, target - el.w);
        if (nextX + el.w > size.w - margin + 0.5) continue;
        if (Math.abs(nextX - el.x) < 0.2) continue;
        const before = el.x;
        el.x = nextX;
        record(
          page.id,
          el,
          "alignment",
          `محاذاة الحافة اليمنى إلى ${Math.round(target)}مم.`,
          { x: Math.round(before * 10) / 10 },
          { x: Math.round(el.x * 10) / 10 },
        );
      }
    }
  }

  return { project: next, corrections };
}

/** Keeps a correction batch only when the measured score does not fall. */
export function applyGatedFixes(project: Project): {
  project: Project;
  corrections: Correction[];
  accepted: boolean;
  scoreBefore: number;
  scoreAfter: number;
} {
  const scoreBefore = critiqueProject(project).score;
  const attempt = applySafeFixes(project);
  if (!attempt.corrections.length) {
    return { project, corrections: [], accepted: false, scoreBefore, scoreAfter: scoreBefore };
  }
  const scoreAfter = critiqueProject(attempt.project).score;
  if (scoreAfter <= scoreBefore) {
    return { project: clone(project), corrections: [], accepted: false, scoreBefore, scoreAfter: scoreBefore };
  }
  return {
    project: attempt.project,
    corrections: attempt.corrections,
    accepted: true,
    scoreBefore,
    scoreAfter,
  };
}
