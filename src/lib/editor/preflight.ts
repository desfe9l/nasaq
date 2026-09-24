/**
 * Pre-flight export checker.
 *
 * Every problem this finds is one a printer or a reader would find later, after
 * the file has left the building: a paragraph whose last line is cut off, a logo
 * sitting under the binding, a blank sheet in the middle of a 40-page report, a
 * photograph that prints at 96 dpi. Checking them here costs a second; finding
 * them in print costs a reprint.
 *
 * The checks run against the DOCUMENT MODEL, not the rendered DOM, for two
 * reasons: they are testable without a browser, and they measure the same
 * geometry the exporters will write — including the resolved text metrics from
 * `prepareText`, so "this paragraph overflows" means the same thing here as it
 * does on the canvas and in the PDF.
 */

import { pageSize, type CanvasEl, type Page } from "./model.ts";
import { prepareText } from "./text-render.ts";
import { unresolvedMacros } from "./macros.ts";
import {
  DEFAULT_PRINT_GUIDES,
  GUTTER_MARGIN_MM,
  effectiveDpi,
  elementsInGutter,
  escapesFrame,
  guideGeometry,
  isEmptyPage,
  type PrintGuideSettings,
} from "./print-guides.ts";

export type IssueSeverity = "error" | "warning" | "info";

export type IssueKind =
  | "text-overflow"
  | "gutter"
  | "empty-page"
  | "low-resolution"
  | "off-page"
  | "empty-text"
  | "unresolved-token";

export interface PreflightIssue {
  kind: IssueKind;
  severity: IssueSeverity;
  /** One-line statement of what is wrong. */
  title: string;
  /** Why it matters and what to do about it. */
  detail: string;
  pageId: string;
  pageName: string;
  elementIds: string[];
  /** What the export dialog can offer to do about it. */
  fix?: "fit-text" | "move-inward" | "delete-page" | "delete-element";
}

export interface PreflightOptions {
  /** Print guides the document has enabled. */
  guides?: PrintGuideSettings;
  /** Minimum acceptable print resolution; below this is reported (default 300). */
  minDpi?: number;
  /** Below this the issue is an error rather than a warning (default 150). */
  hardMinDpi?: number;
  /**
   * Natural pixel size of an image source, when the editor knows it (the asset
   * shelf records it on import). Returning null skips the resolution check for
   * that image rather than guessing.
   */
  imageSize?: (src: string) => { w: number; h: number } | null;
  /** Pages excluded from the "empty page" check (e.g. a deliberately blank verso). */
  ignoreEmptyPages?: boolean;
}

export interface PreflightReport {
  issues: PreflightIssue[];
  /** Counts per severity, for the summary line. */
  counts: Record<IssueSeverity, number>;
  /** True when nothing at all was found. */
  clean: boolean;
}

const TEXT_TYPES = new Set(["text", "box", "stat", "stamp"]);

/** Arabic wording for each severity, shared by the panel and the export dialog. */
export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  error: "خطأ",
  warning: "تحذير",
  info: "ملاحظة",
};

/**
 * Run every check over the document.
 *
 * One issue per (page, element) rather than per element instance: a paragraph
 * that overflows in six places is six problems to fix, but a logo sitting in the
 * gutter produces one line, not one per guide band.
 */
export function runPreflight(
  pages: Page[],
  options: PreflightOptions = {},
): PreflightReport {
  const guides = options.guides ?? DEFAULT_PRINT_GUIDES;
  const minDpi = options.minDpi ?? 300;
  const hardMinDpi = options.hardMinDpi ?? 150;
  const issues: PreflightIssue[] = [];

  pages.forEach((page, index) => {
    const size = pageSize(page);
    const geometry = guideGeometry(size, guides);
    const visible = (page.elements ?? []).filter((el) => !el.hidden);
    /* Macros resolve per page, so the pre-flight measures page N as page N. */
    const pageRef = { number: index + 1, count: pages.length };
    const add = (issue: Omit<PreflightIssue, "pageId" | "pageName">) =>
      issues.push({ ...issue, pageId: page.id, pageName: page.name });

    // ── 1. text that does not fit its box ──────────────────────────────────
    const overflowing: CanvasEl[] = [];
    for (const el of visible) {
      if (!TEXT_TYPES.has(el.type)) continue;
      if (el.type === "group") continue;
      const prepared = prepareText(el, pageRef);
      /*
       * `clipped` is only set for a deliberately FIXED box, which is the case
       * that actually prints cut text. Everything else resizes itself, so
       * reporting it here would train the author to ignore this dialog.
       */
      if (prepared.clipped) overflowing.push(el);
    }
    if (overflowing.length) {
      add({
        kind: "text-overflow",
        severity: "warning",
        title: `${overflowing.length} ${overflowing.length === 1 ? "عنصر نصي" : "عناصر نصية"} يتجاوز إطاره`,
        detail:
          "النص أطول من الصندوق وسيظهر مقطوعًا في الملف المطبوع. «ملاءمة» تمدّ الصندوق ليحتوي النص.",
        elementIds: overflowing.map((el) => el.id),
        fix: "fit-text",
      });
    }

    // ── 2. content inside the binding margin ───────────────────────────────
    const inGutter = elementsInGutter(
      page,
      size,
      geometry.margins.gutter || GUTTER_MARGIN_MM,
    );
    if (inGutter.length) {
      add({
        kind: "gutter",
        severity: "warning",
        title: `${inGutter.length} ${inGutter.length === 1 ? "عنصر" : "عناصر"} داخل هامش التجليد`,
        detail: `العناصر تدخل في ${geometry.margins.gutter} مم عند حافة التجليد (يمين الصفحة)، وقد تُقتطع بعد التخييط. انقلها داخل المنطقة الآمنة.`,
        elementIds: inGutter.map((el) => el.id),
        fix: "move-inward",
      });
    }

    // ── 3. artwork that falls off the sheet ────────────────────────────────
    const trim = geometry.bleed;
    const offPage = visible.filter(
      (el) =>
        el.type !== "group" &&
        escapesFrame(
          { x: el.x, y: el.y, w: el.w, h: el.h },
          guides.bleed ? trim : geometry.trim,
        ),
    );
    if (offPage.length) {
      add({
        kind: "off-page",
        severity: "warning",
        title: `${offPage.length} ${offPage.length === 1 ? "عنصر" : "عناصر"} خارج حدود الصفحة`,
        detail: guides.bleed
          ? "العناصر تتجاوز منطقة القصّ (Bleed) وستُقطع في الطبع التجاري."
          : "العناصر تخرج عن حدود الورقة. فعّل «القصّ والقص الزائد» إن كان الخروج مقصودًا.",
        elementIds: offPage.map((el) => el.id),
      });
    }

    // ── 4. images below print resolution ───────────────────────────────────
    if (options.imageSize) {
      const lowRes: CanvasEl[] = [];
      let lowest = Infinity;
      for (const el of visible) {
        if (el.type !== "image" && el.type !== "logo") continue;
        if (!el.src) continue;
        const pixels = options.imageSize(el.src);
        if (!pixels?.w || !pixels?.h) continue;
        const dpi = effectiveDpi(pixels, { w: el.w, h: el.h });
        if (dpi < minDpi) {
          lowRes.push(el);
          lowest = Math.min(lowest, dpi);
        }
      }
      if (lowRes.length) {
        add({
          kind: "low-resolution",
          severity: lowest < hardMinDpi ? "error" : "warning",
          title: `${lowRes.length} ${lowRes.length === 1 ? "صورة" : "صور"} بدقة أقل من جودة الطباعة`,
          detail: `أقل دقة بينها ${lowest} نقطة/بوصة، والمطلوب ${minDpi} للطباعة. استبدلها بصورة أكبر أو صغّر حجمها على الصفحة.`,
          elementIds: lowRes.map((el) => el.id),
        });
      }
    }

    // ── 5. blank pages and empty text boxes ────────────────────────────────
    if (!options.ignoreEmptyPages && isEmptyPage(page)) {
      add({
        kind: "empty-page",
        severity: "info",
        title: "صفحة بلا محتوى",
        detail:
          "الصفحة فارغة تمامًا وستُطبع بيضاء. احذفها أو أضف محتواها قبل التصدير.",
        elementIds: [],
        fix: "delete-page",
      });
    } else {
      /*
       * A frame, a card background or a letterhead band is an empty text box on
       * purpose — it is filled, bordered, or applied furniture, so it does not
       * print as a hole. Only a box with nothing to show at all is reported.
       */
      const emptyText = visible.filter(
        (el) =>
          TEXT_TYPES.has(el.type) &&
          el.type !== "stamp" &&
          !el.hfRole &&
          !String(el.content ?? "").trim() &&
          !el.style?.fill &&
          !el.style?.borderColor,
      );
      if (emptyText.length) {
        add({
          kind: "empty-text",
          severity: "info",
          title: `${emptyText.length} ${emptyText.length === 1 ? "صندوق نص" : "صناديق نص"} فارغ`,
          detail:
            "صناديق نصية بلا محتوى — تظهر كمساحات فارغة في الملف النهائي.",
          elementIds: emptyText.map((el) => el.id),
          fix: "delete-element",
        });
      }
    }

    // ── 6. braces that never resolved to a macro ───────────────────────────
    const strayTokens = new Map<string, CanvasEl[]>();
    for (const el of visible) {
      for (const token of unresolvedMacros(String(el.content ?? ""))) {
        const bucket = strayTokens.get(token) ?? [];
        bucket.push(el);
        strayTokens.set(token, bucket);
      }
    }
    if (strayTokens.size) {
      const tokens = [...strayTokens.keys()];
      add({
        kind: "unresolved-token",
        severity: "info",
        title: `رموز غير معروفة في ${strayTokens.size} ${strayTokens.size === 1 ? "نص" : "نصوص"}`,
        detail: `${tokens.join(" · ")} — لن تتحوّل إلى قيمة، وستُطبع كما كُتبت. الرموز المتاحة: التاريخ الهجري، التاريخ الميلادي، رقم الصفحة من الكل، اسم الجهة، رقم المعاملة.`,
        elementIds: [
          ...new Set(
            tokens.flatMap((t) => strayTokens.get(t)!.map((el) => el.id)),
          ),
        ],
      });
    }
  });

  const counts: Record<IssueSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const issue of issues) counts[issue.severity] += 1;
  return { issues, counts, clean: issues.length === 0 };
}

/** One-line Arabic summary of a report, for the dialog header and toasts. */
export function preflightSummary(report: PreflightReport): string {
  if (report.clean) return "لا ملاحظات — المستند جاهز للتصدير";
  const parts: string[] = [];
  if (report.counts.error) parts.push(`${report.counts.error} خطأ`);
  if (report.counts.warning) parts.push(`${report.counts.warning} تحذير`);
  if (report.counts.info) parts.push(`${report.counts.info} ملاحظة`);
  return parts.join(" · ");
}

/** Everything of one severity, in document order. */
export function issuesOf(
  report: PreflightReport,
  severity: IssueSeverity,
): PreflightIssue[] {
  return report.issues.filter((issue) => issue.severity === severity);
}
