/**
 * «إصلاح العناصر» — the import repair engine.
 *
 * A conversion can leave an element outside the page, stretched, rotated by a
 * stray matrix, or in a group whose frame no longer matches its members. This
 * engine inspects an imported NASAQ document, reports what looks wrong, and —
 * only when asked — applies CONSERVATIVE corrections.
 *
 * Conservative means:
 *   · Geometry that already matches its truth is never touched.
 *   · The primary truth is `source.origin` (the source file's own bounds) and
 *     `source.px` (the asset's intrinsic pixels). The fallback truth is the
 *     page itself: boxes are clamped INTO the page, never invented.
 *   · Fixes are thresholded (0.5 mm, 2%, 8% aspect…) so rounding noise and
 *     intentional bleed never fire a repair.
 *   · The engine is idempotent: repairing a repaired document is a no-op.
 *
 * Everything here is pure data-in/data-out — no DOM, no canvas — so it runs in
 * a worker, in Node tests, or on the main thread with periodic yields.
 */

import type { CanvasEl, Page, Project } from "../model.ts";
import { clone } from "../model.ts";

export type RepairKind =
  | "sanity"
  | "page"
  | "position"
  | "bounds"
  | "size"
  | "image"
  | "text"
  | "rotation"
  | "group"
  | "background";

/** Arabic labels used by the compact repair breakdown («٦ أحجام · ٣ مواضع»). */
export const REPAIR_KIND_LABELS: Record<RepairKind, string> = {
  sanity: "قيم غير سليمة",
  page: "مقاس الصفحة",
  position: "مواضع",
  bounds: "خارج الصفحة",
  size: "أحجام",
  image: "صور",
  text: "نصوص",
  rotation: "دوران",
  group: "مجموعات",
  background: "خلفيات",
};

/** Order the compact breakdown lists its chips in. */
export const REPAIR_KIND_ORDER: readonly RepairKind[] = [
  "size",
  "position",
  "bounds",
  "image",
  "text",
  "background",
  "group",
  "rotation",
  "page",
  "sanity",
];

export interface RepairGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
}

export interface RepairFix {
  kind: RepairKind;
  /** Element or page display name. */
  name: string;
  /** Why this was repaired, in plain Arabic. */
  reason: string;
  before: RepairGeometry;
  after: RepairGeometry;
}

export interface RepairCounts {
  total: number;
  byKind: Partial<Record<RepairKind, number>>;
}

export interface RepairOptions {
  /**
   * Source page sizes in millimetres, page by page (PSD: pixels ÷ dpi). Used
   * to detect a page-size / coordinate-scale mismatch and to rescale the whole
   * page — elements, origins and letter-spacing together, fonts untouched
   * because points are already physical.
   */
  pageSizes?: { w: number; h: number }[];
  /**
   * Allow restoring drifted elements to their imported origin geometry.
   * True for a fresh import (drift there is a conversion defect); false keeps
   * the heuristic-only «safe mode» used on documents the author may have
   * edited since.
   */
  trustOrigin?: boolean;
}

export interface ImportProblem {
  kind: RepairKind;
  name: string;
  reason: string;
  severity: "error" | "warn";
}

export interface RepairResult {
  project: Project;
  fixes: RepairFix[];
  counts: RepairCounts;
}

export type RepairProgress = (done: number, total: number) => void;

/* ── helpers ─────────────────────────────────────────────────────────────── */

const PT_TO_MM = 25.4 / 72;
const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (n: number | undefined, fallback: number): number =>
  typeof n === "number" && Number.isFinite(n) ? n : fallback;

function normRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let r = deg % 360;
  if (r > 180) r -= 360;
  if (r < -180) r += 360;
  if (Math.abs(r) < 0.4) r = 0;
  return round2(r);
}

/** Share of the element's area that lies outside the page (0..1). */
function outsideRatio(
  box: { x: number; y: number; w: number; h: number },
  pageW: number,
  pageH: number,
): number {
  if (box.w <= 0 || box.h <= 0) return 0;
  const ix = Math.max(0, Math.min(box.x + box.w, pageW) - Math.max(box.x, 0));
  const iy = Math.max(0, Math.min(box.y + box.h, pageH) - Math.max(box.y, 0));
  const inside = ix * iy;
  return 1 - inside / (box.w * box.h);
}

/** Share of the PAGE covered by the box (0..1) — the background question. */
function pageCoverage(
  box: { x: number; y: number; w: number; h: number },
  pageW: number,
  pageH: number,
): number {
  if (box.w <= 0 || box.h <= 0 || pageW <= 0 || pageH <= 0) return 0;
  const ix = Math.max(0, Math.min(box.x + box.w, pageW) - Math.max(box.x, 0));
  const iy = Math.max(0, Math.min(box.y + box.h, pageH) - Math.max(box.y, 0));
  return (ix * iy) / (pageW * pageH);
}

/**
 * The page's background-role element, if it has one: the bottom-most visible
 * image/shape/svg big enough to be a backdrop rather than content. The size
 * test honours the imported origin too — a backdrop that shrank is still the
 * backdrop, and restoring it is what the repair is for.
 */
function backgroundIdsOf(page: Page): Set<string> {
  const ids = new Set<string>();
  const pageW = finite(page.w, 210);
  const pageH = finite(page.h, 297);
  const pageArea = pageW * pageH;
  if (pageArea <= 0) return ids;
  const visible = page.elements.filter((el) => !el.hidden);
  if (!visible.length) return ids;
  const bottomZ = Math.min(...visible.map((el) => finite(el.z, 1)));
  const candidates = visible.filter((el) => {
    if (!(el.type === "image" || el.type === "shape" || el.type === "svg")) return false;
    if (finite(el.z, 1) > bottomZ + 0.001) return false;
    const origin = el.source?.origin;
    const area = Math.max(el.w * el.h, origin ? origin.w * origin.h : 0);
    return area >= pageArea * 0.55;
  });
  if (candidates.length !== 1) return ids;
  ids.add(candidates[0]!.id);
  return ids;
}

/** Estimated number of rendered lines, from box width and glyph metrics. */
function estimateTextLines(el: CanvasEl): number {
  const content = el.content || "";
  if (!content) return 0;
  const fontMm = Math.max(0.5, finite(el.style.fontSize, 12) * PT_TO_MM);
  const charW = fontMm * 0.52;
  const perLine = Math.max(1, Math.floor(Math.max(1, el.w) / charW));
  let lines = 0;
  for (const raw of content.split("\n")) {
    const text = raw.trim();
    if (!text) {
      lines += 1;
      continue;
    }
    lines += Math.max(1, Math.ceil(text.length / perLine));
  }
  return lines;
}

/** Estimated rendered height of a text element, in mm. */
export function estimateTextHeightMm(el: CanvasEl): number {
  const fontMm = Math.max(0.5, finite(el.style.fontSize, 12) * PT_TO_MM);
  const lh = Math.min(4, Math.max(0.8, finite(el.style.lineHeight, 1.45)));
  return estimateTextLines(el) * fontMm * lh;
}

/* ── planning ────────────────────────────────────────────────────────────── */

interface Plan {
  fix: RepairFix;
}

interface Ctx {
  pageW: number;
  pageH: number;
  /** Accumulated parent offsets (groups) — page-space position of el.x/el.y. */
  dx: number;
  dy: number;
  trustOrigin: boolean;
  /** True when this element is the page's backdrop — repairs say «خلفية». */
  isBackground: boolean;
}

const geoOf = (el: CanvasEl): RepairGeometry => ({
  x: round2(el.x),
  y: round2(el.y),
  w: round2(el.w),
  h: round2(el.h),
  ...(el.rotation ? { rot: round2(el.rotation) } : {}),
});

function plan(el: CanvasEl, kind: RepairKind, reason: string, after: RepairGeometry): Plan {
  return { fix: { kind, name: el.name || el.type, reason, before: geoOf(el), after } };
}

function checkElement(el: CanvasEl, ctx: Ctx): Plan[] {
  const plans: Plan[] = [];
  const origin = ctx.trustOrigin ? el.source?.origin : undefined;

  /* rotation — normalise, then restore the imported angle if it drifted */
  const rot = finite(el.rotation, 0);
  const normalized = normRotation(rot);
  if (normalized !== round2(rot)) {
    plans.push(
      plan(el, "rotation", "زاوية الدوران خارج النطاق المعروف، فأُعيد ضبطها", { ...geoOf(el), rot: normalized }),
    );
    el.rotation = normalized;
  } else if (origin && typeof origin.rot === "number" && Math.abs(origin.rot - normalized) > 0.5) {
    const restored = normRotation(origin.rot);
    plans.push(
      plan(el, "rotation", "الدوران لا يطابق الملف الأصلي، فأُعيد إلى زاويته", { ...geoOf(el), rot: restored }),
    );
    el.rotation = restored;
  }

  /* position vs the imported origin */
  if (origin && (Math.abs(el.x - origin.x) > 0.5 || Math.abs(el.y - origin.y) > 0.5)) {
    const kind: RepairKind = ctx.isBackground ? "background" : "position";
    plans.push(
      plan(el, kind, ctx.isBackground ? "الخلفية انحرفت عن موضعها في الملف الأصلي" : "الموضع انحرف عن موضعه في الملف الأصلي", { x: round2(origin.x), y: round2(origin.y), w: round2(el.w), h: round2(el.h), ...(el.rotation ? { rot: round2(el.rotation) } : {}) }),
    );
    el.x = origin.x;
    el.y = origin.y;
  }

  /* size vs the imported origin (a size drift is an aspect/scale defect) */
  if (
    origin &&
    ((Math.abs(el.w - origin.w) > 0.5 && Math.abs(el.w - origin.w) > 0.02 * Math.max(1, origin.w)) ||
      (Math.abs(el.h - origin.h) > 0.5 && Math.abs(el.h - origin.h) > 0.02 * Math.max(1, origin.h)))
  ) {
    const kind: RepairKind = ctx.isBackground
      ? "background"
      : el.type === "image" || el.type === "logo" || el.type === "svg"
        ? "image"
        : "size";
    const reason = ctx.isBackground
      ? "الخلفية لم تعد تغطي الصفحة كما في الملف الأصلي"
      : el.type === "image" || el.type === "logo" || el.type === "svg"
        ? "إطار الصورة لا يطابق إطارها في الملف الأصلي"
        : "الحجم لا يطابق إطار العنصر في الملف الأصلي";
    plans.push(
      plan(el, kind, reason, { x: round2(el.x), y: round2(el.y), w: round2(origin.w), h: round2(origin.h), ...(el.rotation ? { rot: round2(el.rotation) } : {}) }),
    );
    el.w = origin.w;
    el.h = origin.h;
  }

  /* image aspect — the frame must keep the source frame's proportions.
   * With an origin, the size restore above already carries the source frame
   * (and its aspect); this branch is the fallback for imports that brought
   * pixels but no geometry: keep the author's frame, stop stretching the
   * bitmap inside it. */
  if (el.type === "image" && el.w > 1 && el.h > 1 && !el.style.crop && !origin) {
    const boxAspect = el.w / el.h;
    const px = el.source?.px;
    if (px && px.w > 0 && px.h > 0 && (el.style.objectFit || "fill") === "fill") {
      const drift = Math.abs(boxAspect / (px.w / px.h) - 1);
      if (drift > 0.25) {
        plans.push(
          plan(el, "image", "الصورة مشدودة داخل إطار لا يطابق أبعادها، فأُبقيت داخل الإطار دون تشويه", geoOf(el)),
        );
        el.style = { ...el.style, objectFit: "contain" };
      }
    }
  }

  /* text — the frame must be able to hold its own glyphs */
  if (el.type === "text" && el.content) {
    const size = finite(el.style.fontSize, 12);
    if (size <= 0 || size > 400) {
      plans.push(
        plan(el, "sanity", "حجم الخط غير سليم، فرُدّ إلى قيمة قابلة للتحرير", geoOf(el)),
      );
      el.style = { ...el.style, fontSize: 12 };
    } else {
      const needed = estimateTextHeightMm(el);
      /*
       * 1.25 — a box holding less than 80% of its own estimated glyph height
       * is cropped, not tight. Keep a buffer: the glyph-width estimate is
       * approximate, so sub-20% discrepancies stay untouched.
       */
      const tooSmall = needed > el.h * 1.25 && el.h > 0.5;
      if (tooSmall) {
        const absBottom = el.y + ctx.dy + needed * 1.08;
        let newY = el.y;
        if (absBottom > ctx.pageH) {
          newY = Math.max(0, ctx.pageH - needed * 1.08) - ctx.dy;
        }
        plans.push(
          plan(el, "text", "النص أطول من إطاره، فوُسّع الصندوق ليتسع دون اقتصاص", { x: round2(el.x), y: round2(newY), w: round2(el.w), h: round2(needed * 1.08) }),
        );
        el.y = newY;
        el.h = round2(needed * 1.08);
        el.style = { ...el.style, textBoxMode: "autoHeight", overflowVisible: true };
      }
    }
  }

  /* uniform over-scaling — an element far larger than the page itself */
  if (!origin && el.w > ctx.pageW * 1.6 && el.h > ctx.pageH * 1.6) {
    const factor = Math.min((ctx.pageW * 0.95) / el.w, (ctx.pageH * 0.95) / el.h);
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    const nw = round2(el.w * factor);
    const nh = round2(el.h * factor);
    const nx = round2(cx - nw / 2);
    const ny = round2(cy - nh / 2);
    plans.push(
      plan(el, "size", "العنصر أكبر بكثير من الصفحة، فرُدّ إلى مقياس يناسبها مع حفظ النسبة", { x: nx, y: ny, w: nw, h: nh }),
    );
    el.x = nx;
    el.y = ny;
    el.w = nw;
    el.h = nh;
  }

  /* page bounds — an element that mostly left the page is a conversion defect */
  const abs = { x: el.x + ctx.dx, y: el.y + ctx.dy, w: el.w, h: el.h };
  if (abs.w > 0.5 && abs.h > 0.5 && outsideRatio(abs, ctx.pageW, ctx.pageH) > 0.55) {
    const originAbs = origin
      ? { x: origin.x + ctx.dx, y: origin.y + ctx.dy, w: origin.w, h: origin.h }
      : null;
    if (origin && originAbs && outsideRatio(originAbs, ctx.pageW, ctx.pageH) <= 0.55) {
      // The source had it inside; the conversion pushed it out.
      plans.push(
        plan(el, "bounds", "العنصر خرج من حدود الصفحة أثناء التحويل، فأُعيد إلى موضعه الأصلي", { x: round2(origin.x), y: round2(origin.y), w: round2(origin.w), h: round2(origin.h) }),
      );
      el.x = origin.x;
      el.y = origin.y;
      el.w = origin.w;
      el.h = origin.h;
    } else {
      // No trustworthy origin: slide the box back inside, keeping its size.
      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
      const inX = abs.w >= ctx.pageW ? (ctx.pageW - abs.w) / 2 : clamp(abs.x, 0, ctx.pageW - abs.w);
      const inY = abs.h >= ctx.pageH ? (ctx.pageH - abs.h) / 2 : clamp(abs.y, 0, ctx.pageH - abs.h);
      const nx = round2(inX - ctx.dx);
      const ny = round2(inY - ctx.dy);
      plans.push(
        plan(el, "bounds", "العنصر خارج حدود الصفحة تمامًا، فأُعيد إلى داخل اللوحة", { x: nx, y: ny, w: round2(el.w), h: round2(el.h) }),
      );
      el.x = nx;
      el.y = ny;
    }
  }

  return plans;
}

/* ── the analysis walk ───────────────────────────────────────────────────── */

interface WalkStats {
  visited: number;
}

function* walkElements(els: CanvasEl[], dx: number, dy: number): Generator<{ el: CanvasEl; dx: number; dy: number }> {
  for (const el of els) {
    yield { el, dx, dy };
    if (el.children?.length) yield* walkElements(el.children, dx + el.x, dy + el.y);
  }
}

function sanityPass(pages: Page[]): Plan[] {
  const plans: Plan[] = [];
  for (const page of pages) {
    for (const { el } of walkElements(page.elements, 0, 0)) {
      const sane = (v: number, min: number): number => {
        const n = finite(v, min);
        return Number.isFinite(n) && n > 0 ? n : min;
      };
      const w = sane(el.w, 0.4);
      const h = sane(el.h, 0.4);
      const x = finite(el.x, 0);
      const y = finite(el.y, 0);
      const opacity = Math.min(1, Math.max(0, finite(el.opacity, 1)));
      const rot = Number.isFinite(el.rotation) ? el.rotation : 0;
      const changed =
        w !== el.w ||
        h !== el.h ||
        !Number.isFinite(el.x) ||
        !Number.isFinite(el.y) ||
        opacity !== el.opacity ||
        !Number.isFinite(el.rotation);
      if (changed) {
        plans.push(
          plan(el, "sanity", "قيم هندسية غير سليمة (أبعاد أو موضع أو شفافية)، فرُدّت إلى أقرب قيمة صالحة", { x: round2(x), y: round2(y), w: round2(w), h: round2(h), ...(rot ? { rot: round2(rot) } : {}) }),
        );
        el.w = w;
        el.h = h;
        el.rotation = rot;
        if (!Number.isFinite(el.x)) el.x = 0;
        if (!Number.isFinite(el.y)) el.y = 0;
        el.opacity = opacity;
      }
    }
  }
  return plans;
}

function pagePass(pages: Page[], options: RepairOptions): Plan[] {
  const plans: Plan[] = [];
  const expected = options.pageSizes;
  if (!expected?.length) return plans;
  pages.forEach((page, index) => {
    const want = expected[index];
    const pageW = finite(page.w, 0);
    const pageH = finite(page.h, 0);
    if (!want || want.w < 20 || want.h < 20 || pageW < 10 || pageH < 10) return;
    const offW = Math.abs(pageW - want.w);
    const offH = Math.abs(pageH - want.h);
    if (offW <= Math.max(2, want.w * 0.02) && offH <= Math.max(2, want.h * 0.02)) return;
    const sx = want.w / pageW;
    const sy = want.h / pageH;
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0.1 || sx >= 10 || sy <= 0.1 || sy >= 10) return;

    /*
     * Two very different mistakes land here, and the fix must not confuse
     * them:
     *
     *  · The WHOLE conversion used the wrong scale (a dpi mix-up): the
     *    content was laid out for the wrong page size — its box matches the
     *    CURRENT page. Rescale page AND content together; the composition is
     *    preserved, only its unit was wrong.
     *  · Only the page dimensions were lost: the content already sits at the
     *    right absolute size — its box matches the EXPECTED page. Fix the
     *    page dimensions and leave every element alone.
     *
     * The visible content box decides. When it matches neither page (cropped
     * artwork, a stray element, generous bleed), stay conservative: no fix.
     */
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const { el, dx, dy } of walkElements(page.elements, 0, 0)) {
      if (el.hidden) continue;
      count += 1;
      minX = Math.min(minX, el.x + dx);
      minY = Math.min(minY, el.y + dy);
      maxX = Math.max(maxX, el.x + dx + el.w);
      maxY = Math.max(maxY, el.y + dy + el.h);
    }
    const contentMatches = (w: number, h: number): boolean => {
      if (!count) return false; // handled separately: nothing to rescale
      return (
        maxX - minX >= w * 0.75 &&
        maxX - minX <= w * 1.25 &&
        maxY - minY >= h * 0.75 &&
        maxY - minY <= h * 1.25 &&
        minX >= -w * 0.15 &&
        minY >= -h * 0.15 &&
        maxX <= w * 1.15 &&
        maxY <= h * 1.15
      );
    };
    let rescaleContent: boolean;
    if (!count) {
      rescaleContent = false; // an empty page only needs its dimensions fixed
    } else {
      const followsCurrent = contentMatches(pageW, pageH);
      const followsExpected = contentMatches(want.w, want.h);
      if (followsCurrent && !followsExpected) rescaleContent = true;
      else if (followsExpected && !followsCurrent) rescaleContent = false;
      else return; // ambiguous or matches neither — no confident page repair
    }

    const before = { x: 0, y: 0, w: round2(pageW), h: round2(pageH) };
    const scale = (el: CanvasEl): void => {
      el.x = round2(el.x * sx);
      el.y = round2(el.y * sy);
      el.w = round2(Math.max(0.4, el.w * sx));
      el.h = round2(Math.max(0.4, el.h * sy));
      const origin = el.source?.origin;
      if (origin) {
        origin.x = round2(origin.x * sx);
        origin.y = round2(origin.y * sy);
        origin.w = round2(Math.max(0.4, origin.w * sx));
        origin.h = round2(Math.max(0.4, origin.h * sy));
      }
      if (typeof el.style?.letterSpacing === "number" && el.style.letterSpacing > 0) {
        el.style = { ...el.style, letterSpacing: round2(el.style.letterSpacing * ((sx + sy) / 2)) };
      }
      for (const child of el.children || []) scale(child);
    };
    const reason = rescaleContent
      ? "مقاس الصفحة لا يطابق ملف المصدر، فأُعيد ضبط المقاس مع المحتوى معًا حفاظًا على التكوين"
      : "مقاس الصفحة لا يطابق ملف المصدر، فأُعيد ضبط مقاس الصفحة وحده لأن العناصر في مواضعها الصحيحة";
    plans.push({
      fix: {
        kind: "page",
        name: page.name || `صفحة ${index + 1}`,
        reason,
        before,
        after: { x: 0, y: 0, w: round2(want.w), h: round2(want.h) },
      },
    });
    if (rescaleContent) for (const el of page.elements) scale(el);
    page.w = round2(want.w);
    page.h = round2(want.h);
  });
  return plans;
}

function elementPass(pages: Page[], options: RepairOptions, stats: WalkStats): Plan[] {
  const plans: Plan[] = [];
  const trustOrigin = options.trustOrigin !== false;
  for (const page of pages) {
    const pageW = finite(page.w, 210);
    const pageH = finite(page.h, 297);
    const backgrounds = backgroundIdsOf(page);
    const ctx: Ctx = { pageW, pageH, dx: 0, dy: 0, trustOrigin, isBackground: false };
    for (const step of walkElements(page.elements, 0, 0)) {
      stats.visited += 1;
      plans.push(
        ...checkElement(step.el, {
          ...ctx,
          dx: step.dx,
          dy: step.dy,
          isBackground: backgrounds.has(step.el.id),
        }),
      );
    }
  }
  return plans;
}

function groupPass(pages: Page[]): Plan[] {
  const plans: Plan[] = [];
  const visit = (els: CanvasEl[]): void => {
    for (const el of els) {
      if (el.children?.length) visit(el.children);
      if (el.type !== "group" || !el.children?.length) continue;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const child of el.children) {
        minX = Math.min(minX, child.x);
        minY = Math.min(minY, child.y);
        maxX = Math.max(maxX, child.x + child.w);
        maxY = Math.max(maxY, child.y + child.h);
      }
      const tolX = Math.max(2, el.w * 0.05);
      const tolY = Math.max(2, el.h * 0.05);
      const broken =
        minX < -tolX || minY < -tolY || maxX > el.w + tolX || maxY > el.h + tolY;
      if (!broken) continue;
      const nx = round2(el.x + minX);
      const ny = round2(el.y + minY);
      const nw = round2(Math.max(0.4, maxX - minX));
      const nh = round2(Math.max(0.4, maxY - minY));
      plans.push(
        plan(el, "group", "إطار المجموعة لا يطابق مواضع أعضائها، فأُعيد حسابه", { x: nx, y: ny, w: nw, h: nh }),
      );
      el.x = nx;
      el.y = ny;
      el.w = nw;
      el.h = nh;
      for (const child of el.children) {
        child.x = round2(child.x - minX);
        child.y = round2(child.y - minY);
        const origin = child.source?.origin;
        if (origin) {
          origin.x = round2(origin.x - minX);
          origin.y = round2(origin.y - minY);
        }
      }
    }
  };
  for (const page of pages) visit(page.elements);
  return plans;
}

function backgroundPass(pages: Page[]): Plan[] {
  const plans: Plan[] = [];
  for (const page of pages) {
    const pageW = finite(page.w, 210);
    const pageH = finite(page.h, 297);
    const pageArea = pageW * pageH;
    if (pageArea <= 0) continue;
    const roles = backgroundIdsOf(page);
    if (roles.size !== 1) continue;
    const hit = page.elements.find((el) => roles.has(el.id));
    if (!hit) continue;
    const el = hit;
    const coverage = pageCoverage(el, pageW, pageH);
    if (coverage >= 0.97) continue;
    const origin = el.source?.origin;
    const originUsable = !!origin && origin.w > 1 && origin.h > 1;
    if (originUsable && origin) {
      const originCoverage = pageCoverage(origin, pageW, pageH);
      if (originCoverage >= 0.97 && coverage < originCoverage - 0.03) {
        plans.push(
          plan(el, "background", "الخلفية لم تعد تغطي الصفحة كما في الملف الأصلي", { x: round2(origin.x), y: round2(origin.y), w: round2(origin.w), h: round2(origin.h) }),
        );
        el.x = origin.x;
        el.y = origin.y;
        el.w = origin.w;
        el.h = origin.h;
        continue;
      }
      // The source itself placed a smaller backdrop — never invent a fill.
      if (originCoverage < 0.97) continue;
    }
    const aspect = el.w > 0 && el.h > 0 ? el.w / el.h : 0;
    if (Math.abs(aspect - pageW / pageH) <= 0.05 * (pageW / pageH) && el.w <= pageW * 1.05 && el.h <= pageH * 1.05) {
      plans.push(
        plan(el, "background", "الخلفية لا تملأ الصفحة، فوُسّعت لتغطيتها بالكامل", { x: 0, y: 0, w: round2(pageW), h: round2(pageH) }),
      );
      el.x = 0;
      el.y = 0;
      el.w = round2(pageW);
      el.h = round2(pageH);
    }
  }
  return plans;
}

/* ── public API ──────────────────────────────────────────────────────────── */

function countFixes(fixes: RepairFix[]): RepairCounts {
  const byKind: Partial<Record<RepairKind, number>> = {};
  for (const fix of fixes) byKind[fix.kind] = (byKind[fix.kind] || 0) + 1;
  return { total: fixes.length, byKind };
}

/**
 * Run every pass, in order, against one working pages tree. The passes plan a
 * fix AND apply it immediately — that is what makes chained checks honest (the
 * bounds check sees the position an origin restore just fixed) and the whole
 * engine idempotent.
 */
function analyze(pages: Page[], options: RepairOptions, stats: WalkStats): RepairFix[] {
  const fixes: RepairFix[] = [];
  const collect = (plans: Plan[]): void => {
    for (const item of plans) fixes.push(item.fix);
  };
  collect(sanityPass(pages));
  collect(pagePass(pages, options));
  collect(elementPass(pages, options, stats));
  collect(groupPass(pages));
  collect(backgroundPass(pages));
  return fixes;
}

/**
 * Inspect an imported document and report likely conversion problems WITHOUT
 * changing anything. Powers the inspector's «مشكلات محتملة» list.
 */
export function detectImportProblems(project: Project, options: RepairOptions = {}): ImportProblem[] {
  const stats: WalkStats = { visited: 0 };
  // Detection runs the real passes on a scratch copy, so what it reports is
  // exactly what a repair would fix — no speculative warnings.
  const fixes = analyze(clone({ pages: project.pages }).pages as Page[], options, stats);
  const problems: ImportProblem[] = fixes.map((fix) => ({
    kind: fix.kind,
    name: fix.name,
    reason: fix.reason,
    severity: fix.kind === "sanity" || fix.kind === "page" ? "error" : "warn",
  }));
  for (const page of project.pages) {
    for (const { el } of walkElements(page.elements, 0, 0)) {
      if ((el.type === "image" || el.type === "logo") && !el.src) {
        problems.push({
          kind: "image",
          name: el.name || "صورة",
          reason: "الصورة بلا مصدر — الأصل لم يُستخرج من الملف",
          severity: "error",
        });
      }
    }
  }
  return problems;
}

/**
 * Repair an imported document. The input project is never mutated: a repaired
 * clone comes back together with every fix that was applied.
 */
export async function repairProject(
  project: Project,
  options: RepairOptions = {},
  onProgress?: RepairProgress,
): Promise<RepairResult> {
  const working = clone(project);
  const stats: WalkStats = { visited: 0 };
  const fixes = analyze(working.pages, options, stats);
  // One cooperative yield keeps the main thread responsive after a big walk.
  await new Promise((resolve) => setTimeout(resolve, 0));
  onProgress?.(stats.visited, stats.visited);
  return { project: working, fixes, counts: countFixes(fixes) };
}

/** Compact «٦ أحجام · ٣ مواضع» breakdown in display order. */
export function repairBreakdown(counts: RepairCounts): { kind: RepairKind; label: string; count: number }[] {
  return REPAIR_KIND_ORDER.filter((kind) => (counts.byKind[kind] || 0) > 0).map((kind) => ({
    kind,
    label: REPAIR_KIND_LABELS[kind],
    count: counts.byKind[kind] || 0,
  }));
}
