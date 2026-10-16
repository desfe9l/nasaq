/**
 * Deterministic review of a provider-authored composition plan.
 *
 * THE WORKFLOW this completes:
 *
 *   art direction (`DesignBrief.visualDirection`)
 *     → structured spec (`DesignComposition[]`, percentages)
 *     → [THIS MODULE] validation + safe corrections
 *     → editable elements (`generateFromIntent`)
 *     → `validateProject` + the design twin's review/correct cycle
 *
 * The design twin already reviews the FINISHED project. Two defect classes
 * cannot be seen there, and both are provider-plan defects:
 *
 *   · TEXT UNDER AN OPAQUE SHAPE. Painting order is array order, so a shape
 *     listed after the text it decorates hides it. The twin compares textual
 *     elements only — a shape covering a heading was invisible to review.
 *   · TEXT GROWTH OFF THE PAGE. Composition text is `autoHeight`, so a short
 *     declared box grows downward with its copy; the twin measures the
 *     DECLARED box, which is in bounds while the rendered paragraph runs past
 *     the page.
 *
 * Plus two precision improvements the twin's coarse net cannot make on a plan:
 * role-aware contrast repair (choose a readable palette ROLE, never black or
 * white by fiat) and a minimal-displacement separation for text collisions
 * that is verified against the whole page before it is applied.
 *
 * Every correction is conservative and verified:
 *
 *   · the input plan is never mutated; a corrected copy is returned,
 *   · no copy is rewritten, no element is dropped, no box size is changed,
 *     nothing is rasterised — geometry and colour roles only, so the result
 *     stays as editable as the plan it came from,
 *   · a correction that cannot be completed inside the page is NOT applied —
 *     it is reported as an issue with `corrected: false` instead of silently
 *     trading one defect for another,
 *   · the review is idempotent: reviewing an already-corrected plan reports
 *     nothing and changes nothing.
 */

import { contrastRatio } from "@/lib/intelligence/analyze";
import type { PaletteRoles } from "@/lib/intelligence/schema";
import type {
  DesignComposition,
  DesignCompositionElement,
} from "./design-composition";

/**
 * The single type scale for provider plans. The element converter
 * (`generateFromIntent`) reads the SAME table, so the height this review
 * predicts and the text the editor later paints cannot drift apart.
 */
export const COMPOSITION_TEXT_SCALE: Record<
  DesignCompositionElement["role"],
  { fontSize: number; lineHeight: number }
> = {
  display: { fontSize: 26, lineHeight: 1.25 },
  body: { fontSize: 12, lineHeight: 1.5 },
  meta: { fontSize: 9, lineHeight: 1.4 },
};

export interface CompositionIssue {
  /** 0-based page in the plan. */
  page: number;
  /** 0-based element index in the ORIGINAL plan order. */
  element: number;
  code: "contrast" | "coverage" | "overflow" | "overlap";
  /** Short factual account of the defect and what was measured. */
  detail: string;
  /** False when no in-bounds correction existed — the owner must see it. */
  corrected: boolean;
}

export interface CompositionReview {
  /** Corrected copies; index i still belongs to plan page i. */
  compositions: DesignComposition[];
  issues: CompositionIssue[];
}

const MM_PER_PT = 25.4 / 72;
/** Percentage points kept between two boxes after a separation. */
const GAP = 1.5;
/** Of the smaller rendered box — below this a touch is layout, not a clash. */
const OVERLAP_RATIO = 0.3;
/** Of the text box — an opaque shape over more than this hides the copy. */
const COVER_RATIO = 0.6;
/** WCAG AA: 4.5:1 for body/meta text, 3:1 for large display text. */
const TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3;
const EPS = 0.01;

const COLORS = ["ink", "onField", "accent"] as const;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Item {
  /** Original plan index — survives the coverage reorder. */
  index: number;
  el: DesignCompositionElement;
  /** Rendered height in percent of the page; lazy, never changes with x/y. */
  height?: number;
}

const textual = (el: DesignCompositionElement) =>
  el.type === "text" || el.type === "table";

function areaOf(rect: Rect): number {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Rendered text height in millimetres, predicted from the same type scale the
 * converter stamps on the elements. Arabic averages ≈ 0.5em per glyph; the
 * estimate deliberately rounds up through `Math.max(1, …)` per line so a
 * borderline box is treated as overflowing, never as secretly fitting.
 */
function estimateTextHeightMm(
  el: DesignCompositionElement,
  boxWmm: number,
): number {
  const scale = COMPOSITION_TEXT_SCALE[el.role];
  const charWidthMm = scale.fontSize * 0.5 * MM_PER_PT;
  const charsPerLine = Math.max(1, Math.floor(boxWmm / charWidthMm));
  let lines = 0;
  for (const row of el.content.split("\n")) {
    if (el.type === "table") {
      const cells = row.split("\t");
      lines += Math.max(
        1,
        ...cells.map((cell) => Math.ceil(cell.trim().length / charsPerLine)),
      );
    } else {
      lines += Math.max(1, Math.ceil(row.length / charsPerLine));
    }
  }
  return lines * scale.fontSize * scale.lineHeight * MM_PER_PT;
}

/** The box actually painted: declared height, or the grown text, whichever is taller. */
function heightOf(item: Item, size: { w: number; h: number }): number {
  if (item.height === undefined) {
    item.height =
      textual(item.el) && item.el.content.trim()
        ? Math.max(
            item.el.h,
            (estimateTextHeightMm(item.el, (item.el.w / 100) * size.w) /
              size.h) *
              100,
          )
        : item.el.h;
  }
  return item.height;
}

function rectOf(item: Item, size: { w: number; h: number }): Rect {
  return { x: item.el.x, y: item.el.y, w: item.el.w, h: heightOf(item, size) };
}

function fitsPage(
  x: number,
  y: number,
  item: Item,
  size: { w: number; h: number },
): boolean {
  const h = heightOf(item, size);
  return (
    x >= -EPS &&
    y >= -EPS &&
    x + item.el.w <= 100 + EPS &&
    y + h <= 100 + EPS
  );
}

export function reviewCompositions(
  pages: readonly DesignComposition[],
  palette: PaletteRoles,
  size: { w: number; h: number },
): CompositionReview {
  const issues: CompositionIssue[] = [];
  const compositions = pages.map((page, pageIndex) => {
    let items: Item[] = page.elements.map((element, index) => ({
      index,
      el: { ...element },
    }));
    const report = (
      item: Item,
      code: CompositionIssue["code"],
      detail: string,
      corrected: boolean,
    ) => {
      issues.push({ page: pageIndex, element: item.index, code, detail, corrected });
    };

    /*
     * 1) Opaque coverage. A solid shape listed AFTER a text paints over it —
     * the text is gone on the rendered page. The shape belongs underneath, so
     * every flagged shape is moved to the bottom of that page's paint stack
     * (front of the list, original order kept). A flagged shape was hiding
     * copy; nothing that is correctly layered above or below other artwork
     * changes position.
     */
    const toBack = new Set<Item>();
    for (let i = 0; i < items.length; i += 1) {
      const text = items[i];
      if (!textual(text.el) || !text.el.content.trim()) continue;
      for (let j = i + 1; j < items.length; j += 1) {
        const shape = items[j];
        if (textual(shape.el) || shape.el.fill === "none") continue;
        const covered =
          intersectionArea(text.el, shape.el) / Math.max(1, areaOf(text.el));
        if (covered < COVER_RATIO) continue;
        toBack.add(shape);
        report(
          text,
          "coverage",
          `an opaque ${shape.el.type} painted over ${Math.round(covered * 100)}% of the text box`,
          true,
        );
      }
    }
    if (toBack.size) {
      items = [
        ...items.filter((item) => toBack.has(item)),
        ...items.filter((item) => !toBack.has(item)),
      ];
    }

    /*
     * 2) Contrast. Text tokens are roles, so the repair is a role swap on the
     * same fill: the visual identity (the panel colour) is kept and only the
     * unreadable pairing is replaced. When no token on this palette reaches
     * the threshold the pairing is reported instead of guessed around.
     */
    for (const item of items) {
      if (!textual(item.el) || !item.el.content.trim()) continue;
      const fillToken = item.el.fill === "none" ? "paper" : item.el.fill;
      const fill = palette[fillToken];
      const threshold = item.el.role === "display" ? LARGE_TEXT_MIN : TEXT_MIN;
      const current = contrastRatio(palette[item.el.color], fill);
      if (current >= threshold) continue;
      const best = COLORS.map((token) => ({
        token,
        ratio: contrastRatio(palette[token], fill),
      }))
        .filter((candidate) => candidate.ratio >= threshold)
        .sort((a, b) => b.ratio - a.ratio)[0];
      report(
        item,
        "contrast",
        `${item.el.color} on ${fillToken} is ${current.toFixed(2)}:1, below ${threshold}:1`,
        Boolean(best),
      );
      if (best) item.el.color = best.token;
    }

    /*
     * 3) Text growth. autoHeight means the declared box is a floor, not a
     * promise; the copy is what must fit the page. Moving the box up is the
     * one way to keep the copy on paper without touching its size or words.
     */
    for (const item of items) {
      if (!textual(item.el) || !item.el.content.trim()) continue;
      const needed = heightOf(item, size);
      if (item.el.y + needed <= 100 + EPS) continue;
      const moved = needed <= 100 + EPS ? 100 - needed : null;
      report(
        item,
        "overflow",
        `the copy needs ${Math.round(needed)}% of the page height from y=${Math.round(item.el.y)}`,
        moved !== null,
      );
      if (moved !== null) item.el.y = moved;
    }

    /*
     * 4) Text collisions. The lower-priority element yields: display beats
     * body beats meta, then the smaller box beats the larger, then the later
     * element in the plan. Candidates are the four minimal separations, and a
     * candidate is only applied when it both fits the page (a text pushed off
     * the bottom is worse than a cramped one) and clears every other text and
     * opaque shape on the page — otherwise the pair is reported as it stands.
     */
    const priority = (el: DesignCompositionElement) =>
      el.role === "display" ? 3 : el.role === "meta" ? 1 : 2;
    const texts = items.filter(
      (item) => textual(item.el) && item.el.content.trim(),
    );
    const opaqueShapes = items.filter(
      (item) => !textual(item.el) && item.el.fill !== "none",
    );
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i];
        const b = texts[j];
        const rectA = rectOf(a, size);
        const rectB = rectOf(b, size);
        const ratio =
          intersectionArea(rectA, rectB) /
          Math.max(1, Math.min(areaOf(rectA), areaOf(rectB)));
        if (ratio < OVERLAP_RATIO) continue;
        const mover =
          priority(a.el) !== priority(b.el)
            ? priority(a.el) < priority(b.el)
              ? a
              : b
            : areaOf(rectA) !== areaOf(rectB)
              ? areaOf(rectA) < areaOf(rectB)
                ? a
                : b
              : b;
        const fixed = mover === a ? b : a;
        const moverRect = rectOf(mover, size);
        const fixedRect = rectOf(fixed, size);
        const candidates = [
          { x: mover.el.x, y: fixedRect.y + fixedRect.h + GAP },
          { x: mover.el.x, y: fixedRect.y - moverRect.h - GAP },
          { x: fixedRect.x - mover.el.w - GAP, y: mover.el.y },
          { x: fixedRect.x + fixedRect.w + GAP, y: mover.el.y },
        ];
        const chosen = candidates
          .filter(
            (candidate) =>
              fitsPage(candidate.x, candidate.y, mover, size) &&
              texts.every(
                (other) =>
                  other === mover ||
                  intersectionArea(
                    { ...moverRect, x: candidate.x, y: candidate.y },
                    rectOf(other, size),
                  ) /
                    Math.max(
                      1,
                      Math.min(areaOf(moverRect), areaOf(rectOf(other, size))),
                    ) <
                    OVERLAP_RATIO,
              ) &&
              opaqueShapes.every(
                (shape) =>
                  intersectionArea(
                    { ...moverRect, x: candidate.x, y: candidate.y },
                    shape.el,
                  ) /
                    Math.max(1, areaOf(moverRect)) <
                  COVER_RATIO,
              ),
          )
          .sort(
            (p, q) =>
              Math.hypot(p.x - mover.el.x, p.y - mover.el.y) -
                Math.hypot(q.x - mover.el.x, q.y - mover.el.y) ||
              p.y - q.y ||
              p.x - q.x,
          )[0];
        report(
          mover,
          "overlap",
          `overlaps another text by ${Math.round(ratio * 100)}% of its box`,
          Boolean(chosen),
        );
        if (chosen) {
          mover.el.x = chosen.x;
          mover.el.y = chosen.y;
        }
      }
    }

    return { elements: items.map((item) => item.el) };
  });

  return { compositions, issues };
}
