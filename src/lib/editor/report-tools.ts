/**
 * Report tools: page furniture, the stamp & signature zone, and KPI cards.
 *
 * Everything here builds on the EXISTING element model — a KPI card is an
 * ordinary `box` + `progress` + `text`, the signature zone is an ordinary
 * `group`, page numbers are ordinary `text` carrying a macro. Nothing invents a
 * parallel structure, so every one of these objects can be moved, restyled,
 * ungrouped, exported and re-imported like anything the author drew by hand.
 *
 * Colours always come from the document's active theme (`THEMES`), which is what
 * makes «تطابق ألوان المستند» true by construction rather than by a setting: a
 * KPI card inserted into a ministry report is ministry-green, and switching the
 * theme restyles the whole document including its cards.
 */

import {
  createElement,
  createGroupFrom,
  elementsBounds,
  nextZ,
  normalizeZ,
  type CanvasEl,
  type ElStyle,
  type Page,
  type Theme,
  type ThemeId,
  THEMES,
} from "./model.ts";
import { uid } from "../utils.ts";
import { MACROS } from "./macros.ts";

export type HeaderFooterRole = "header" | "footer";

/** Both roles, in the order the UI lists them. */
export const HEADER_FOOTER_ROLES: HeaderFooterRole[] = ["header", "footer"];

/** Height of the band at the top of a page that counts as its header. */
export const HEADER_BAND_MM = 30;
/** Height of the band at the bottom of a page that counts as its footer. */
export const FOOTER_BAND_MM = 26;

/** Clamp a band to a quarter of the page, so a slide is not mostly "header". */
export function bands(size: { w: number; h: number }) {
  return {
    header: Math.min(HEADER_BAND_MM, size.h * 0.25),
    footer: Math.min(FOOTER_BAND_MM, size.h * 0.22),
  };
}

/**
 * Which furniture role an element sits in, by geometry.
 *
 * Deliberately geometric: an author who drags a logo into the top band has made
 * it a header, whether or not they thought about it in those terms.
 */
export function furnitureRole(
  el: CanvasEl,
  size: { w: number; h: number },
): HeaderFooterRole | null {
  if (el.hfRole) return el.hfRole;
  const { header, footer } = bands(size);
  if (el.y + el.h / 2 <= header) return "header";
  if (el.y + el.h / 2 >= size.h - footer) return "footer";
  return null;
}

/** Top-level elements of a page that belong to its header or footer band. */
export function furnitureElements(
  page: Page,
  size: { w: number; h: number },
): { header: CanvasEl[]; footer: CanvasEl[] } {
  const header: CanvasEl[] = [];
  const footer: CanvasEl[] = [];
  for (const el of page.elements ?? []) {
    if (el.hidden) continue;
    const role = furnitureRole(el, size);
    if (role === "header") header.push(el);
    else if (role === "footer") footer.push(el);
  }
  return { header, footer };
}

/**
 * Copy one page's header and footer onto every other page of the document.
 *
 * The active page is the SOURCE — the author styles the furniture they can see
 * and then applies it everywhere. Furniture already applied on a target page is
 * replaced rather than duplicated, so pressing the button twice is idempotent.
 * Pages of a different size are skipped: an A4 header copied onto a 16:9 slide
 * would be the wrong width, and silently rescaling it would be worse.
 */
export function applyFurniture(
  pages: Page[],
  sourcePageId: string,
  sizeOf: (page: Page) => { w: number; h: number },
  options: { roles?: HeaderFooterRole[] } = {},
): { pages: Page[]; copied: number; skipped: number[] } {
  const source = pages.find((p) => p.id === sourcePageId);
  if (!source) return { pages, copied: 0, skipped: [] };
  const roles = options.roles ?? [...HEADER_FOOTER_ROLES];
  const sourceSize = sizeOf(source);
  const picked = furnitureElements(source, sourceSize);
  const template: CanvasEl[] = roles
    .flatMap((role) => picked[role])
    .map((el) => ({
      ...el,
      hfRole: furnitureRole(el, sourceSize) ?? undefined,
    }));

  if (!template.length) return { pages, copied: 0, skipped: [] };

  let copied = 0;
  const skipped: number[] = [];
  const next = pages.map((page, index) => {
    if (page.id === sourcePageId) {
      // The source keeps its own elements; they simply become furniture.
      return {
        ...page,
        elements: page.elements.map((el) => {
          const role = furnitureRole(el, sourceSize);
          return role ? { ...el, hfRole: role } : el;
        }),
      };
    }
    const size = sizeOf(page);
    if (
      Math.abs(size.w - sourceSize.w) > 0.5 ||
      Math.abs(size.h - sourceSize.h) > 0.5
    ) {
      skipped.push(index + 1);
      return page;
    }
    const kept = (page.elements ?? []).filter((el) => !el.hfRole);
    const clones = template.map((el) => ({
      ...structuredClone(el),
      id: uid("el"),
      hfRole: el.hfRole,
      locked: true,
    }));
    for (const clone of clones) reid(clone);
    const merged: Page = { ...page, elements: [...kept, ...clones] };
    normalizeZ(merged);
    copied += clones.length;
    return merged;
  });

  return { pages: next, copied, skipped };
}

/** Remove every applied header/footer element, from every page. */
export function clearFurniture(pages: Page[]): {
  pages: Page[];
  removed: number;
} {
  let removed = 0;
  const next = pages.map((page) => {
    const kept = (page.elements ?? []).filter((el) => {
      if (!el.hfRole) return true;
      removed += 1;
      return false;
    });
    return kept.length === (page.elements ?? []).length
      ? page
      : { ...page, elements: kept };
  });
  return { pages: next, removed };
}

/** Give every element in a subtree a fresh id. */
function reid(el: CanvasEl): void {
  el.id = uid("el");
  for (const child of el.children ?? []) reid(child);
}

/** Does this page already carry a live page-number macro? */
export function hasPageNumber(page: Page): boolean {
  return (page.elements ?? []).some((el) =>
    String(el.content ?? "").includes(MACROS[2].token),
  );
}

/**
 * Add «صفحة n من m» plus a hairline rule to the footer of every page that does
 * not have one yet.
 *
 * The number itself is the `{رقم_الصفحة_من_الكل}` macro, so it resolves per page
 * at render and export time — adding a page later renumbers everything with no
 * further action.
 */
export function numberPages(
  pages: Page[],
  theme: Theme,
  sizeOf: (page: Page) => { w: number; h: number },
): { pages: Page[]; added: number } {
  let added = 0;
  const next = pages.map((page) => {
    if (hasPageNumber(page)) return page;
    const size = sizeOf(page);
    const { footer } = bands(size);
    const y = size.h - footer / 2 - 4;
    const rule = createElement(
      "line",
      {
        name: "خط الترقيم",
        x: 16,
        y: y - 3,
        w: Math.max(20, size.w - 32),
        h: 1.2,
        style: { color: theme.line, stroke: 0.25 },
      },
      theme,
    );
    const label = createElement(
      "text",
      {
        name: "رقم الصفحة",
        x: 16,
        y,
        w: Math.max(40, size.w - 32),
        h: 8,
        content: `وثيقة رسمية · ${MACROS[2].token}`,
        style: {
          fontFamily: "Tajawal",
          fontSize: 9,
          fontWeight: 600,
          lineHeight: 1.6,
          textAlign: "center",
          color: theme.muted,
        },
      },
      theme,
    );
    added += 2;
    const merged: Page = { ...page, elements: [...page.elements, rule, label] };
    normalizeZ(merged);
    return merged;
  });
  return { pages: next, added };
}

/** Remove the page-number furniture this module added. */
export function clearPageNumbers(pages: Page[]): {
  pages: Page[];
  removed: number;
} {
  let removed = 0;
  const next = pages.map((page) => {
    const kept = (page.elements ?? []).filter((el) => {
      const isNumber =
        el.type === "text" &&
        String(el.content ?? "").includes(MACROS[2].token);
      const isRule = el.name === "خط الترقيم";
      if (isNumber || isRule) removed += 1;
      return !isNumber && !isRule;
    });
    return kept.length === (page.elements ?? []).length
      ? page
      : { ...page, elements: kept };
  });
  return { pages: next, removed };
}

/* ── Stamp & signature zone ──────────────────────────────────────────────── */

export interface SignatureZoneOptions {
  /** Top-left corner on the page, in mm. */
  x: number;
  y: number;
  width?: number;
  /** Which furniture the zone prepares: a stamp, a signature, or both. */
  parts?: ("stamp" | "signature")[];
}

/**
 * A ready-made «منطقة الختم والتوقيع».
 *
 * Returned as ONE group, because that is how an author thinks about it: a single
 * object to drop in the corner of a letter, drag as a unit, and ungroup if they
 * want to take it apart. The dashed frame is part of the group but prints as a
 * thin grey rule — it is a zone, and the author replaces the placeholder lines
 * with real names.
 */
export function signatureZone(
  theme: Theme,
  options: SignatureZoneOptions,
): CanvasEl {
  const width = options.width ?? 78;
  const parts = options.parts ?? ["signature", "stamp"];
  const height = parts.includes("stamp") ? 40 : 30;
  const x = options.x;
  const y = options.y;

  const elements: CanvasEl[] = [];

  const frame = createElement(
    "box",
    {
      name: "إطار منطقة التوقيع",
      x,
      y,
      w: width,
      h: height,
      content: "",
      style: {
        fill: "#ffffff",
        borderColor: theme.line,
        borderWidth: 0.3,
        radius: 3,
        padding: 0,
      },
    },
    theme,
  );
  elements.push(frame);

  if (parts.includes("signature")) {
    const title = createElement(
      "text",
      {
        name: "عنوان منطقة التوقيع",
        x: x + 5,
        y: y + 3.5,
        w: width - 10,
        h: 7,
        content: "التوقيع والاعتماد",
        style: {
          fontFamily: "Cairo",
          fontSize: 10,
          fontWeight: 800,
          lineHeight: 1.6,
          textAlign: "right",
          color: theme.primary,
        },
      },
      theme,
    );
    const rule = createElement(
      "line",
      {
        name: "خط منطقة التوقيع",
        x: x + 5,
        y: y + 11,
        w: width - 10,
        h: 1.4,
        style: { color: theme.accent, stroke: 0.4 },
      },
      theme,
    );
    const nameLine = createElement(
      "text",
      {
        name: "سطر الاسم",
        x: x + 5,
        y: y + 13,
        w: width - 10,
        h: 8,
        content: "الاسم: …………………………………",
        style: {
          fontFamily: "Tajawal",
          fontSize: 9.5,
          fontWeight: 600,
          lineHeight: 1.7,
          textAlign: "right",
          color: theme.ink,
        },
      },
      theme,
    );
    const roleLine = createElement(
      "text",
      {
        name: "سطر الصفة",
        x: x + 5,
        y: y + 20,
        w: width - 10,
        h: 8,
        content: "الصفة: …………………………………",
        style: {
          fontFamily: "Tajawal",
          fontSize: 9.5,
          fontWeight: 600,
          lineHeight: 1.7,
          textAlign: "right",
          color: theme.ink,
        },
      },
      theme,
    );
    elements.push(title, rule, nameLine, roleLine);
  }

  if (parts.includes("stamp")) {
    const stamp = createElement(
      "stamp",
      {
        name: "ختم اعتماد",
        x: x + width - 30,
        y: y + (parts.includes("signature") ? 22 : 8),
        w: 26,
        h: 13,
        content: "رسمي",
        style: {
          fontFamily: "Amiri",
          fontSize: 11,
          fontWeight: 700,
          color: theme.accent,
          borderColor: theme.accent,
          borderWidth: 0.5,
          radius: 6,
        },
      },
      theme,
    );
    elements.push(stamp);
  }

  const group = createGroupFrom(elements, "منطقة الختم والتوقيع");
  /* `createGroupFrom` needs two members; the frame alone is the degenerate case. */
  if (!group) {
    const only = elements[0];
    return { ...only, name: "منطقة الختم والتوقيع" };
  }
  return group;
}

/** Convenience: the zone placed in the bottom-left corner of a page. */
export function signatureZoneForPage(
  theme: Theme,
  size: { w: number; h: number },
  margin = 14,
): CanvasEl {
  return signatureZone(theme, {
    x: size.w - 78 - margin,
    y: size.h - 40 - margin - 18,
  });
}

/* ── KPI summary cards ───────────────────────────────────────────────────── */

export type KpiKind = "progress" | "target" | "badge";

export interface KpiCardDef {
  id: KpiKind;
  label: string;
  hint: string;
  size: { w: number; h: number };
}

export const KPI_CARDS: KpiCardDef[] = [
  {
    id: "progress",
    label: "نسبة إنجاز",
    hint: "بطاقة مع شريط تقدّم",
    size: { w: 78, h: 34 },
  },
  {
    id: "target",
    label: "المستهدف مقابل المتحقق",
    hint: "وزن بصري للفارق بين الرقمين",
    size: { w: 86, h: 38 },
  },
  {
    id: "badge",
    label: "شارة إحصائية",
    hint: "رقم كبير وتسمية تحتـه",
    size: { w: 52, h: 30 },
  },
];

export interface KpiOptions {
  x: number;
  y: number;
  /** Caption shown above the value. */
  caption: string;
  /** The value/percentage the card visualises. */
  value: number;
  /** Target-vs-actual only: the target the value is measured against. */
  target?: number;
  /** Number formatting: the theme's numeral style. */
  numerals?: "western" | "arabic";
}

/**
 * Build one KPI card.
 *
 * The palette comes straight from `THEMES[themeId]`: fill is the theme surface,
 * the bar uses the theme's primary, the accent rule uses its gold. Change the
 * document theme and every card changes with it — which is exactly what
 * "matches the active document colour palette" has to mean in practice.
 */
export function kpiCard(
  kind: KpiKind,
  themeId: ThemeId,
  options: KpiOptions,
): CanvasEl[] {
  const theme = THEMES[themeId] ?? THEMES.official;
  const def = KPI_CARDS.find((c) => c.id === kind) ?? KPI_CARDS[0];
  const { x, y } = options;
  const w = def.size.w;
  const h = def.size.h;
  const out: CanvasEl[] = [];

  const card = createElement(
    "box",
    {
      name: `بطاقة مؤشر — ${def.label}`,
      x,
      y,
      w,
      h,
      content: "",
      style: {
        fill: theme.surface,
        borderColor: theme.line,
        borderWidth: 0.3,
        radius: 5,
        padding: 0,
      },
    },
    theme,
  );
  out.push(card);

  const accent = createElement(
    "line",
    {
      name: "شريط لوني",
      x: x + w - 2.6,
      y,
      w: 2.6,
      h,
      style: { color: theme.accent, stroke: 0.9 },
    },
    theme,
  );
  out.push(accent);

  const caption = createElement(
    "text",
    {
      name: "تسمية المؤشر",
      x: x + 4,
      y: y + 3,
      w: w - 12,
      h: 7,
      content: options.caption,
      style: {
        fontFamily: "Tajawal",
        fontSize: 8.5,
        fontWeight: 700,
        lineHeight: 1.6,
        textAlign: "right",
        color: theme.muted,
        numerals: options.numerals,
      },
    },
    theme,
  );
  out.push(caption);

  if (kind === "badge") {
    const value = createElement(
      "text",
      {
        name: "قيمة المؤشر",
        x: x + 4,
        y: y + 10,
        w: w - 12,
        h: 14,
        content: formatValue(options.value, options.numerals, "%"),
        style: {
          fontFamily: "Cairo",
          fontSize: 22,
          fontWeight: 800,
          lineHeight: 1.6,
          textAlign: "center",
          color: theme.primary,
          numerals: options.numerals,
        },
      },
      theme,
    );
    out.push(value);
    return out;
  }

  if (kind === "target") {
    const targetValue = options.target ?? 100;
    const actual = createElement(
      "text",
      {
        name: "المتحقق",
        x: x + 4,
        y: y + 10,
        w: (w - 14) / 2,
        h: 14,
        content: formatValue(options.value, options.numerals, "%").replace(
          "%",
          "",
        ),
        style: {
          fontFamily: "Cairo",
          fontSize: 20,
          fontWeight: 800,
          lineHeight: 1.6,
          textAlign: "right",
          color: theme.primary,
          numerals: options.numerals,
        },
      },
      theme,
    );
    const target = createElement(
      "text",
      {
        name: "المستهدف",
        x: x + (w - 10) / 2,
        y: y + 10,
        w: (w - 14) / 2,
        h: 14,
        content: formatValue(targetValue, options.numerals, "%").replace(
          "%",
          "",
        ),
        style: {
          fontFamily: "Cairo",
          fontSize: 20,
          fontWeight: 800,
          lineHeight: 1.6,
          textAlign: "left",
          color: theme.muted,
          numerals: options.numerals,
        },
      },
      theme,
    );
    out.push(actual, target);
    const bar = createElement(
      "progress",
      {
        name: "شريط المستهدف",
        x: x + 4,
        y: y + h - 9,
        w: w - 10,
        h: 5,
        content: "",
        style: {
          value: clampPercent((options.value / Math.max(1, targetValue)) * 100),
          showValue: false,
          fill: theme.primary,
          background: theme.line,
          radius: 2,
          fontSize: 8,
        },
      },
      theme,
    );
    out.push(bar);
    return out;
  }

  // progress
  const value = createElement(
    "text",
    {
      name: "قيمة المؤشر",
      x: x + 4,
      y: y + 10,
      w: w - 10,
      h: 11,
      content: formatValue(options.value, options.numerals, "%"),
      style: {
        fontFamily: "Cairo",
        fontSize: 17,
        fontWeight: 800,
        lineHeight: 1.6,
        textAlign: "right",
        color: theme.primary,
        numerals: options.numerals,
      },
    },
    theme,
  );
  out.push(value);
  const bar = createElement(
    "progress",
    {
      name: "شريط الإنجاز",
      x: x + 4,
      y: y + h - 9,
      w: w - 10,
      h: 5,
      content: "",
      style: {
        value: clampPercent(options.value),
        showValue: false,
        fill: theme.primary,
        background: theme.line,
        radius: 2,
        fontSize: 8,
      },
    },
    theme,
  );
  out.push(bar);
  return out;
}

function clampPercent(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function formatValue(
  value: number,
  numerals: "western" | "arabic" | undefined,
  suffix: string,
): string {
  const rounded = Math.round(Number(value) || 0);
  const raw = `${rounded}${suffix}`;
  if (numerals !== "arabic") return raw;
  return raw.replace(/[0-9]/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/** Insert a batch of ready elements onto a page, keeping layer order sane. */
export function placeElements(page: Page, elements: CanvasEl[]): Page {
  const next: Page = { ...page, elements: [...page.elements, ...elements] };
  for (const el of elements) if (!el.z) el.z = nextZ(next);
  normalizeZ(next);
  return next;
}

/** Bounding box of a group of elements, or null when there is nothing to bound. */
export function boundsOf(elements: CanvasEl[]) {
  return elementsBounds(elements);
}

/** Style patch for text inside a KPI card, exposed for the properties panel. */
export function kpiTextStyle(theme: Theme): ElStyle {
  return {
    fontFamily: "Tajawal",
    fontSize: 9,
    fontWeight: 700,
    color: theme.muted,
    lineHeight: 1.7,
  };
}
