import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CanvasEl, Page, Project } from "../model.ts";
import {
  detectImportProblems,
  estimateTextHeightMm,
  repairBreakdown,
  repairProject,
  type RepairFix,
} from "./repair.ts";

/* ── builders ─────────────────────────────────────────────────────────────── */

let seq = 0;
const id = (prefix: string) => `${prefix}-${(seq += 1)}`;

interface ElInput {
  type?: CanvasEl["type"];
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
  opacity?: number;
  z?: number;
  hidden?: boolean;
  content?: string;
  src?: string;
  children?: CanvasEl[];
  origin?: { x: number; y: number; w: number; h: number; rot?: number };
  px?: { w: number; h: number };
  style?: CanvasEl["style"];
  sourceKind?: CanvasEl["source"] extends infer S ? (S extends { kind: infer K } ? K : never) : never;
}

function el(input: ElInput = {}): CanvasEl {
  const type = input.type ?? "shape";
  return {
    id: id("el"),
    type,
    name: input.name ?? "عنصر",
    x: input.x ?? 0,
    y: input.y ?? 0,
    w: input.w ?? 40,
    h: input.h ?? 20,
    rotation: input.rotation ?? 0,
    opacity: input.opacity ?? 1,
    z: input.z ?? 1,
    ...(input.hidden ? { hidden: true } : {}),
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.src !== undefined ? { src: input.src } : {}),
    ...(input.children ? { children: input.children } : {}),
    style: input.style ?? (type === "shape" ? { fill: "#006c35" } : {}),
    source: {
      kind: input.sourceKind ?? "psd",
      layerId: id("layer"),
      layerName: input.name ?? "عنصر",
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.px ? { px: input.px } : {}),
    },
  };
}

function page(elements: CanvasEl[], w = 210, h = 297, name = "الصفحة 1"): Page {
  return { id: id("page"), name, w, h, bg: "#ffffff", elements };
}

function project(pages: Page[]): Project {
  seq = 0;
  return {
    version: 2,
    name: "مستند اختبار",
    theme: "official",
    orgName: "",
    pages,
  };
}

const kindsOf = (fixes: RepairFix[]) => fixes.map((fix) => fix.kind);
const findEl = (p: Project, name: string): CanvasEl => {
  const walk = (els: CanvasEl[]): CanvasEl | null => {
    for (const item of els) {
      if (item.name === name) return item;
      if (item.children) {
        const hit = walk(item.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const pg of p.pages) {
    const hit = walk(pg.elements);
    if (hit) return hit;
  }
  throw new Error(`element ${name} not found`);
};

/* ── the engine ───────────────────────────────────────────────────────────── */

describe("repair engine — do no harm", () => {
  it("leaves a clean import completely untouched", async () => {
    const p = project([
      page([
        el({ name: "خلفية", type: "shape", x: 0, y: 0, w: 210, h: 297, origin: { x: 0, y: 0, w: 210, h: 297 } }),
        el({ name: "عنوان", type: "text", x: 20, y: 30, w: 120, h: 20, origin: { x: 20, y: 30, w: 120, h: 20 }, content: "تقرير سنوي", style: { fontSize: 24, lineHeight: 1.2 } }),
        el({ name: "شعار", type: "image", x: 150, y: 20, w: 40, h: 40, origin: { x: 150, y: 20, w: 40, h: 40 }, px: { w: 400, h: 400 }, src: "data:image/png;base64,x" }),
      ]),
    ]);
    const result = await repairProject(p);
    assert.equal(result.fixes.length, 0);
    assert.deepEqual(result.project.pages[0]!.elements.map((item) => item.x), [0, 20, 150]);
  });

  it("is idempotent — repairing a repaired document fixes nothing", async () => {
    const p = project([
      page([
        el({ name: "مشوّه", type: "image", x: 400, y: -50, w: 20, h: 90, origin: { x: 30, y: 40, w: 90, h: 40 } }),
        el({ name: "نص طويل", type: "text", x: 10, y: 250, w: 150, h: 6, content: "نص عربي طويل جدًا يتجاوز إطاره بمراحل كثيرة", style: { fontSize: 14, lineHeight: 1.4 } }),
      ]),
    ]);
    const first = await repairProject(p);
    assert.ok(first.fixes.length > 0);
    const second = await repairProject(first.project);
    assert.equal(second.fixes.length, 0);
    assert.deepEqual(second.project, first.project);
  });

  it("does not touch the other pages", async () => {
    const p = project([
      page([el({ name: "سليم", x: 10, y: 10, w: 30, h: 30, origin: { x: 10, y: 10, w: 30, h: 30 } })]),
      page([el({ name: "شارد", x: 900, y: 900, w: 30, h: 30 })], 210, 297, "الصفحة 2"),
    ]);
    const result = await repairProject(p);
    assert.deepEqual(kindsOf(result.fixes), ["bounds"]);
    assert.equal(findEl(result.project, "سليم").x, 10);
    assert.ok(findEl(result.project, "شارد").x < 210);
  });

  it("ignores intentional edge bleed under the threshold", async () => {
    const p = project([
      page([
        // A design stripe that bleeds 45% off the left edge on purpose.
        el({ name: "شريط", x: -40, y: 0, w: 90, h: 297, origin: { x: -40, y: 0, w: 90, h: 297 } }),
      ]),
    ]);
    const result = await repairProject(p);
    assert.equal(result.fixes.length, 0);
  });
});

describe("repair engine — sanity", () => {
  it("repairs NaN, infinite and negative geometry", async () => {
    const broken = el({ name: "مكسور", type: "image", x: Number.NaN, y: Number.POSITIVE_INFINITY, w: Number.NaN, h: -20, opacity: 3, src: "data:image/png;base64,x" });
    broken.x = Number.NaN;
    const p = project([page([broken])]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "sanity"));
    const fixed = findEl(result.project, "مكسور");
    assert.ok(Number.isFinite(fixed.x));
    assert.ok(Number.isFinite(fixed.y));
    assert.ok(fixed.w > 0);
    assert.ok(fixed.h > 0);
    assert.ok(fixed.opacity <= 1);
  });

  it("normalises rotation without losing the angle", async () => {
    const p = project([page([el({ name: "مدوّر", rotation: 361.4 })])]);
    const result = await repairProject(p);
    const fixed = findEl(result.project, "مدوّر");
    assert.equal(fixed.rotation, 1.4);
    assert.ok(result.fixes.some((fix) => fix.kind === "rotation"));
  });

  it("collapses near-zero rotation and NaN rotation to 0", async () => {
    const a = el({ name: "شبه مستقيم", rotation: 0.2 });
    const b = el({ name: "غير رقمي", rotation: Number.NaN });
    const p = project([page([a, b])]);
    const result = await repairProject(p);
    assert.equal(findEl(result.project, "شبه مستقيم").rotation, 0);
    assert.equal(findEl(result.project, "غير رقمي").rotation, 0);
  });
});

describe("repair engine — origin truth", () => {
  it("restores a position that drifted from the source file", async () => {
    const p = project([
      page([el({ name: "منزاح", x: 66.4, y: 90, w: 40, h: 20, origin: { x: 20, y: 30, w: 40, h: 20 } })]),
    ]);
    const result = await repairProject(p);
    assert.deepEqual(kindsOf(result.fixes), ["position"]);
    const fixed = findEl(result.project, "منزاح");
    assert.equal(fixed.x, 20);
    assert.equal(fixed.y, 30);
    assert.ok(result.fixes[0]!.reason.length > 3);
  });

  it("restores a size that drifted from the source file", async () => {
    const p = project([
      page([el({ name: "مكبّر", x: 20, y: 30, w: 80, h: 20, origin: { x: 20, y: 30, w: 40, h: 20 } })]),
    ]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "size"));
    const fixed = findEl(result.project, "مكبّر");
    assert.equal(fixed.w, 40);
    assert.equal(fixed.h, 20);
  });

  it("restores a stretched image frame from its source aspect", async () => {
    const p = project([
      page([el({ name: "صورة مشدودة", type: "image", x: 10, y: 10, w: 100, h: 100, origin: { x: 10, y: 10, w: 100, h: 50 }, px: { w: 1000, h: 500 }, src: "data:image/png;base64,x" })]),
    ]);
    const result = await repairProject(p);
    assert.deepEqual(kindsOf(result.fixes), ["image"]);
    const fixed = findEl(result.project, "صورة مشدودة");
    assert.equal(fixed.h, 50);
  });

  it("restores rotation from the source file when it drifted", async () => {
    const p = project([page([el({ name: "مقلوب", rotation: 45, origin: { x: 0, y: 0, w: 40, h: 20, rot: 90 } })])]);
    const result = await repairProject(p);
    assert.equal(findEl(result.project, "مقلوب").rotation, 90);
    assert.ok(result.fixes.some((fix) => fix.kind === "rotation"));
  });

  it("honours trustOrigin=false (safe mode for edited documents)", async () => {
    const p = project([
      page([el({ name: "منزاح", x: 66, y: 90, w: 40, h: 20, origin: { x: 20, y: 30, w: 40, h: 20 } })]),
    ]);
    const result = await repairProject(p, { trustOrigin: false });
    assert.equal(result.fixes.length, 0);
    assert.equal(findEl(result.project, "منزاح").x, 66);
  });
});

describe("repair engine — heuristics without origin", () => {
  it("clamps a fully out-of-page element back onto the page", async () => {
    const p = project([page([el({ name: "طارق", x: 400, y: 500, w: 60, h: 30 })])]);
    const result = await repairProject(p);
    assert.deepEqual(kindsOf(result.fixes), ["bounds"]);
    const fixed = findEl(result.project, "طارق");
    assert.equal(fixed.x + fixed.w, 210);
    assert.equal(fixed.y + fixed.h, 297);
  });

  it("keeps a partially-bleeding wide element on the page", async () => {
    const p = project([page([el({ name: "عريض", x: -40, y: 50, w: 280, h: 30 })])]);
    const result = await repairProject(p);
    const fixed = findEl(result.project, "عريض");
    // Less than 55% of the area is outside — an intentional bleed stays.
    assert.equal(result.fixes.length, 0);
    assert.equal(fixed.x, -40);
  });

  it("scales down an element far larger than the page itself", async () => {
    const p = project([page([el({ name: "عملاق", x: -100, y: -100, w: 600, h: 800 })])]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "size"));
    const fixed = findEl(result.project, "عملاق");
    assert.ok(fixed.w <= 210 * 0.96);
    assert.ok(fixed.h <= 297 * 0.96);
    // Aspect is preserved.
    assert.ok(Math.abs(fixed.w / fixed.h - 600 / 800) < 0.01);
  });

  it("keeps an overstretched bitmap inside its frame without stretching it", async () => {
    const p = project([
      page([el({ name: "بانر", type: "image", x: 10, y: 10, w: 200, h: 20, px: { w: 1000, h: 500 }, src: "data:image/png;base64,x" })]),
    ]);
    const result = await repairProject(p);
    assert.deepEqual(kindsOf(result.fixes), ["image"]);
    const fixed = findEl(result.project, "بانر");
    assert.equal(fixed.style.objectFit, "contain");
    assert.equal(fixed.w, 200); // frame kept
  });

  it("never fights an intentional stretched frame recorded in the origin", async () => {
    const p = project([
      page([el({ name: "ممدود مقصود", type: "image", x: 10, y: 10, w: 200, h: 20, origin: { x: 10, y: 10, w: 200, h: 20 }, px: { w: 1000, h: 500 }, src: "data:image/png;base64,x" })]),
    ]);
    const result = await repairProject(p);
    assert.equal(result.fixes.length, 0);
    assert.notEqual(findEl(result.project, "ممدود مقصود").style.objectFit, "contain");
  });
});

describe("repair engine — text boxes", () => {
  it("grows a text frame that clips its content", async () => {
    const content = "سطر أول من النص العربي الطويل".repeat(3);
    const p = project([
      page([el({ name: "نص مقصوص", type: "text", x: 10, y: 40, w: 90, h: 5, content, style: { fontSize: 14, lineHeight: 1.4 } })]),
    ]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "text"));
    const fixed = findEl(result.project, "نص مقصوص");
    assert.ok(fixed.h > 5);
    assert.equal(fixed.style.textBoxMode, "autoHeight");
    assert.ok(fixed.h >= estimateTextHeightMm({ ...fixed, content }) * 0.99);
  });

  it("grows upward when the box sits at the page bottom", async () => {
    const content = "نص عربي طويل يتطلب عدة أسطر داخل الإطار";
    const p = project([
      page([el({ name: "تذييل", type: "text", x: 10, y: 292, w: 120, h: 4, content, style: { fontSize: 12, lineHeight: 1.4 } })]),
    ]);
    const result = await repairProject(p);
    const fixed = findEl(result.project, "تذييل");
    assert.ok(fixed.h > 4);
    assert.ok(fixed.y + fixed.h <= 297 + 0.51);
  });

  it("does not fire on a one-line label that fits", async () => {
    const p = project([
      page([el({ name: "وسم", type: "text", x: 10, y: 10, w: 80, h: 6, content: "تقرير ٢٠٢٥", style: { fontSize: 14, lineHeight: 1.2 } })]),
    ]);
    const result = await repairProject(p);
    assert.equal(result.fixes.length, 0);
  });

  it("grows a two-line paragraph that overflows by ~29% (the 1.25 band)", async () => {
    // ~130 chars at 11pt in a 150mm box ≈ 2 lines × 5.8mm = 11.6mm of glyphs
    // in a 9mm frame — clipped in the editor, yet below the old 1.45 trigger.
    const content =
      "نظرة شاملة على أداء الإدارة خلال العام، مع مؤشرات الأداء الرئيسية وأبرز الإنجازات والتحديات التي واجهت فرق العمل في مختلف القطاعات.";
    const p = project([
      page([el({ name: "مقدمة", type: "text", x: 25, y: 90, w: 150, h: 9, content, style: { fontSize: 11, lineHeight: 1.5 } })]),
    ]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "text"));
    const fixed = findEl(result.project, "مقدمة");
    assert.ok(fixed.h >= 12, `h=${fixed.h}`);
    assert.equal(fixed.style.textBoxMode, "autoHeight");
  });

  it("leaves a mild (<20%) text-frame discrepancy untouched", async () => {
    // Estimate noise must not trigger a rewrite: 1 line at 12pt ≈ 5.1mm in a 4.5mm frame (ratio 1.13).
    const p = project([
      page([el({ name: "عنوان فرعي", type: "text", x: 10, y: 20, w: 120, h: 4.5, content: "قسم الإنجازات", style: { fontSize: 12, lineHeight: 1.2 } })]),
    ]);
    const result = await repairProject(p);
    assert.equal(result.fixes.filter((fix) => fix.kind === "text").length, 0);
  });

  it("repairs an unreadable font size", async () => {
    const p = project([
      page([el({ name: "خط مكسور", type: "text", x: 10, y: 10, w: 80, h: 30, content: "مرحبا", style: { fontSize: 0, lineHeight: 1.2 } })]),
    ]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "sanity"));
    assert.equal(findEl(result.project, "خط مكسور").style.fontSize, 12);
  });
});

describe("repair engine — groups", () => {
  it("recomputes a group frame that no longer matches its members", async () => {
    const child = el({ name: "عضو", x: 60, y: 60, w: 50, h: 50, origin: { x: 60, y: 60, w: 50, h: 50 } });
    const group = el({ name: "مجموعة", type: "group", x: 50, y: 50, w: 40, h: 40, children: [child] });
    const p = project([page([group])]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "group"));
    const fixedGroup = findEl(result.project, "مجموعة");
    const fixedChild = findEl(result.project, "عضو");
    // Group box now hugs the child, and the child keeps its page position.
    assert.equal(fixedGroup.x, 110);
    assert.equal(fixedGroup.y, 110);
    assert.equal(fixedGroup.w, 50);
    assert.equal(fixedGroup.h, 50);
    assert.equal(fixedChild.x, 0);
    assert.equal(fixedChild.y, 0);
    assert.equal(fixedChild.source?.origin?.x, 0);
  });

  it("leaves a correct group alone", async () => {
    const child = el({ name: "عضو سليم", x: 5, y: 5, w: 30, h: 30, origin: { x: 5, y: 5, w: 30, h: 30 } });
    const group = el({ name: "مجموعة سليمة", type: "group", x: 10, y: 10, w: 40, h: 40, children: [child] });
    const p = project([page([group])]);
    const result = await repairProject(p);
    assert.equal(result.fixes.length, 0);
  });

  it("repairs inside nested groups using page-space bounds", async () => {
    const deep = el({ name: "عميق", x: 700, y: 700, w: 30, h: 30, origin: { x: 5, y: 5, w: 30, h: 30 } });
    const inner = el({ name: "داخلية", type: "group", x: 20, y: 20, w: 60, h: 60, children: [deep] });
    const outer = el({ name: "خارجية", type: "group", x: 10, y: 10, w: 100, h: 100, children: [inner] });
    const p = project([page([outer])]);
    const result = await repairProject(p);
    const fixed = findEl(result.project, "عميق");
    assert.ok(result.fixes.some((fix) => fix.kind === "position"));
    assert.equal(fixed.x, 5);
    assert.equal(fixed.y, 5);
  });
});

describe("repair engine — backgrounds and pages", () => {
  it("snaps an almost-full-page background to the page", async () => {
    const p = project([
      page([
        el({ name: "خلفية", type: "image", x: 5, y: 5, w: 200, h: 287, src: "data:image/png;base64,x" }),
        el({ name: "عنوان", type: "text", x: 20, y: 20, w: 100, h: 10, content: "غلاف", style: { fontSize: 20, lineHeight: 1.2 } }),
      ]),
    ]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "background"));
    const fixed = findEl(result.project, "خلفية");
    assert.equal(fixed.x, 0);
    assert.equal(fixed.w, 210);
    assert.equal(fixed.h, 297);
  });

  it("restores a background from its origin instead of guessing", async () => {
    const p = project([
      page([
        el({ name: "خلفية أصل", type: "image", x: 0, y: 0, w: 150, h: 210, origin: { x: 0, y: 0, w: 210, h: 297 }, src: "data:image/png;base64,x" }),
      ]),
    ]);
    const result = await repairProject(p);
    const fixed = findEl(result.project, "خلفية أصل");
    assert.equal(fixed.w, 210);
    assert.equal(fixed.h, 297);
    assert.ok(result.fixes.some((fix) => fix.kind === "background"));
  });

  it("does not snap a background whose aspect differs from the page", async () => {
    const p = project([
      page([el({ name: "لوحة", type: "image", x: 0, y: 0, w: 210, h: 160, src: "data:image/png;base64,x" })]),
    ]);
    const result = await repairProject(p);
    assert.equal(result.fixes.length, 0);
  });

  it("rescales a page that does not match the source document size", async () => {
    const text = el({
      name: "عنوان",
      type: "text",
      x: 20,
      y: 20,
      w: 100,
      h: 20,
      content: "عنوان",
      origin: { x: 20, y: 20, w: 100, h: 20 },
      style: { fontSize: 24, lineHeight: 1.2, letterSpacing: 1.5 },
    });
    const backdrop = el({
      name: "خلفية",
      type: "shape",
      x: 0,
      y: 0,
      w: 105,
      h: 148.5,
      origin: { x: 0, y: 0, w: 105, h: 148.5 },
    });
    const p = project([page([backdrop, text], 105, 148.5)]);
    const result = await repairProject(p, { pageSizes: [{ w: 210, h: 297 }] });
    assert.ok(result.fixes.some((fix) => fix.kind === "page"));
    const fixedPage = result.project.pages[0]!;
    assert.equal(fixedPage.w, 210);
    assert.equal(fixedPage.h, 297);
    const fixed = findEl(result.project, "عنوان");
    assert.equal(fixed.x, 40);
    assert.equal(fixed.w, 200);
    // Points are physical — the font keeps its size.
    assert.equal(fixed.style.fontSize, 24);
    // Letter-spacing is millimetres — it scales.
    assert.equal(fixed.style.letterSpacing, 3);
    // Origins follow the page scale, keeping a re-repair a no-op.
    assert.equal(fixed.source?.origin?.x, 40);
    const again = await repairProject(result.project, { pageSizes: [{ w: 210, h: 297 }] });
    assert.equal(again.fixes.length, 0);
  });

  it("stays hands-off when the content is too sparse to judge the page", async () => {
    // One small label on a page whose size disagrees with the source: the
    // content box matches neither page, so the engine declines to guess.
    const p = project([
      page([el({ name: "وسم", type: "text", x: 20, y: 20, w: 100, h: 20, origin: { x: 20, y: 20, w: 100, h: 20 }, content: "وسم", style: { fontSize: 24, lineHeight: 1.2 } })], 105, 148.5),
    ]);
    const result = await repairProject(p, { pageSizes: [{ w: 210, h: 297 }] });
    assert.equal(result.fixes.length, 0);
    assert.equal(result.project.pages[0]!.w, 105);
  });

  it("ignores a page-size expectation that is itself nonsense", async () => {
    const p = project([page([el({ name: "عنصر", x: 10, y: 10, w: 30, h: 30 })], 210, 297)]);
    const result = await repairProject(p, { pageSizes: [{ w: 8, h: 6 }] });
    assert.equal(result.fixes.length, 0);
  });

  it("scales page and content together when the whole conversion used the wrong unit", async () => {
    // Everything is consistently half-size: a dpi mix-up, not a layout bug.
    const p = project([
      page(
        [
          el({ name: "خلفية", type: "shape", x: 0, y: 0, w: 105, h: 148.5, origin: { x: 0, y: 0, w: 105, h: 148.5 } }),
          el({ name: "عنوان", type: "text", x: 10, y: 12, w: 60, h: 10, origin: { x: 10, y: 12, w: 60, h: 10 }, content: "تقرير", style: { fontSize: 18, lineHeight: 1.2 } }),
        ],
        105,
        148.5,
      ),
    ]);
    const result = await repairProject(p, { pageSizes: [{ w: 210, h: 297 }] });
    assert.ok(result.fixes.some((fix) => fix.kind === "page"));
    const fixedPage = result.project.pages[0]!;
    assert.equal(fixedPage.w, 210);
    assert.equal(fixedPage.h, 297);
    const bg = findEl(result.project, "خلفية");
    assert.equal(bg.w, 210);
    assert.equal(bg.h, 297);
    // Fonts are points — physical — and stay untouched.
    assert.equal(findEl(result.project, "عنوان").style.fontSize, 18);
    const again = await repairProject(result.project, { pageSizes: [{ w: 210, h: 297 }] });
    assert.equal(again.fixes.length, 0);
  });

  it("fixes only the page when the content already sits at the right size", async () => {
    // Content at full size, page halved: only the page dimensions were lost.
    const p = project([
      page(
        [
          el({ name: "خلفية", type: "shape", x: 0, y: 0, w: 210, h: 297, origin: { x: 0, y: 0, w: 210, h: 297 } }),
        ],
        105,
        148.5,
      ),
    ]);
    const result = await repairProject(p, { pageSizes: [{ w: 210, h: 297 }] });
    assert.ok(result.fixes.some((fix) => fix.kind === "page"));
    assert.equal(result.fixes.filter((fix) => fix.kind !== "page").length, 0);
    assert.equal(result.project.pages[0]!.w, 210);
    assert.equal(findEl(result.project, "خلفية").w, 210);
  });

  it("stays hands-off when the content matches neither page", async () => {
    const p = project([
      page([el({ name: "مربوع", x: 500, y: 500, w: 400, h: 400, origin: { x: 500, y: 500, w: 400, h: 400 } })], 210, 297),
    ]);
    const result = await repairProject(p, { pageSizes: [{ w: 420, h: 594 }] });
    assert.ok(!result.fixes.some((fix) => fix.kind === "page"));
  });
});

describe("repair engine — reporting", () => {
  it("builds the compact Arabic breakdown in display order", async () => {
    const p = project([
      page([
        el({ name: "منزاح", x: 66, y: 90, w: 40, h: 20, origin: { x: 20, y: 30, w: 40, h: 20 } }),
        el({ name: "مكبّر", x: 10, y: 10, w: 80, h: 20, origin: { x: 10, y: 10, w: 40, h: 20 } }),
        el({ name: "طارق", x: 400, y: 500, w: 60, h: 30 }),
      ]),
    ]);
    const result = await repairProject(p);
    const breakdown = repairBreakdown(result.counts);
    assert.ok(breakdown.some((row) => row.label === "مواضع" && row.count === 1));
    assert.ok(breakdown.some((row) => row.label === "أحجام" && row.count === 1));
    assert.ok(breakdown.some((row) => row.label === "خارج الصفحة" && row.count === 1));
    assert.equal(result.counts.total, result.fixes.length);
    assert.equal(result.counts.byKind.position, 1);
    assert.equal(result.counts.byKind.bounds, 1);
  });

  it("detects problems without changing the document", () => {
    const p = project([
      page([el({ name: "منزاح", x: 66, y: 90, w: 40, h: 20, origin: { x: 20, y: 30, w: 40, h: 20 } })]),
    ]);
    const before = JSON.stringify(p);
    const problems = detectImportProblems(p);
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.kind, "position");
    assert.equal(problems[0]!.severity, "warn");
    assert.equal(JSON.stringify(p), before);
  });

  it("reports a source-less image as an error it cannot fix", () => {
    const lost = el({ name: "صورة مفقودة", type: "image", x: 10, y: 10, w: 40, h: 40 });
    delete lost.src;
    const p = project([page([lost])]);
    const problems = detectImportProblems(p);
    assert.ok(problems.some((issue) => issue.severity === "error" && issue.kind === "image"));
  });
});

describe("repair engine — malformed documents", () => {
  it("survives an empty page", async () => {
    const p = project([page([], 210, 297)]);
    const result = await repairProject(p);
    assert.equal(result.fixes.length, 0);
  });

  it("survives missing page dimensions (A4 fallback)", async () => {
    const raw = page([el({ name: "عائم", x: 400, y: 500, w: 60, h: 30 })]);
    delete (raw as Partial<Page>).w;
    delete (raw as Partial<Page>).h;
    const p = project([raw]);
    const result = await repairProject(p);
    assert.ok(result.fixes.some((fix) => fix.kind === "bounds"));
  });

  it("survives an empty group and a hidden element", async () => {
    const p = project([
      page([
        el({ name: "مجموعة فارغة", type: "group", x: 10, y: 10, w: 40, h: 40, children: [] }),
        el({ name: "مخفي", x: 900, y: 900, w: 30, h: 30, hidden: true }),
      ]),
    ]);
    const result = await repairProject(p);
    assert.ok(result.project.pages[0]!.elements.length === 2);
  });
});
