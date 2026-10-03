import type { CanvasEl, Theme } from "./model";
import { measureTextHeight, measureTextWidth } from "./arabic";
import { bindDesignSkill } from "./design-skill";

bindDesignSkill("layouts");

/**
 * Shared media grammar for the existing NASAQ templates.
 * Art direction: `.grok/skills/nasaq-media/SKILL.md`.
 *
 * A4 measure: 16mm margin, 178mm column, 4mm rhythm.
 * Display is Tajawal. Body prose is Noto Naskh. Metadata is IBM Plex Sans Arabic.
 * Amiri is not a body face. Every mark is a real element.
 */

export type Add = (type: CanvasEl["type"], over?: Partial<CanvasEl>) => CanvasEl;
type Style = CanvasEl["style"];

export const DISPLAY = "Tajawal";
export const BODY = "Noto Naskh Arabic";
export const META = "IBM Plex Sans Arabic";
export const CEREMONY = "Amiri";
export const EDITORIAL = "Noto Kufi Arabic";

/** A4 text block: 16mm margin, 178mm measure, 4mm gutter, 12 columns. */
export const MARGIN = 16;
export const MEASURE = 178;
export const RIGHT = MARGIN + MEASURE;
const COL = 134 / 12;
const GUTTER = 4;

/**
 * A column counted from the right, the way an Arabic page is set.
 * `cell(0, 12)` is the full measure. `cell(0, 7)` is the right-hand block.
 */
export function cell(col: number, span = 1): { x: number; w: number } {
  const w = span * COL + (span - 1) * GUTTER;
  const x = RIGHT - (col + span) * COL - (col + span - 1) * GUTTER;
  return { x: Math.round(x * 100) / 100, w: Math.round(w * 100) / 100 };
}

type RoleStyle = {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  textAlign: "right" | "left" | "center";
};

/** Fixed relationships. A page may color a role; it should not invent a new size. */
export const ROLE = {
  display: { fontFamily: DISPLAY, fontSize: 34, fontWeight: 800, lineHeight: 1.02, textAlign: "right" },
  h1: { fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, lineHeight: 1.15, textAlign: "right" },
  h2: { fontFamily: DISPLAY, fontSize: 15, fontWeight: 700, lineHeight: 1.25, textAlign: "right" },
  h3: { fontFamily: DISPLAY, fontSize: 12, fontWeight: 700, lineHeight: 1.3, textAlign: "right" },
  body: { fontFamily: BODY, fontSize: 11.5, fontWeight: 500, lineHeight: 1.75, textAlign: "right" },
  caption: { fontFamily: META, fontSize: 8, fontWeight: 600, lineHeight: 1.4, textAlign: "right" },
  meta: { fontFamily: META, fontSize: 8.5, fontWeight: 600, lineHeight: 1.35, textAlign: "right" },
  folio: { fontFamily: META, fontSize: 8, fontWeight: 600, lineHeight: 1, textAlign: "left" },
} satisfies Record<string, RoleStyle>;

/**
 * A text frame that matches its words.
 *
 * A single line keeps its alignment edge and shrinks to the glyphs. A paragraph
 * keeps the column width and grows just enough that the last line is inside
 * the frame. Either way the box is the text, not a clip.
 */
export function balancedFrame(
  content: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
  lineHeight: number,
  align: "right" | "left" | "center" | "justify" = "right",
): { x: number; y: number; w: number; h: number } {
  const size = fontSize || 14;
  const leading = lineHeight || 1.5;
  const slack = size * 0.3528 * 0.36;
  const natural = measureTextWidth(content, size, 400) + slack;
  const wraps = align === "justify" || content.includes("\n") || natural > w + 1;
  let nextW = w;
  let nextX = x;
  if (!wraps) {
    nextW = Math.round(Math.max(8, Math.min(w, natural)) * 100) / 100;
    if (align === "center") nextX = x + (w - nextW) / 2;
    else if (align === "left") nextX = x;
    else nextX = x + w - nextW;
    nextX = Math.round(nextX * 100) / 100;
  }
  const needed = measureTextHeight(content, Math.max(8, nextW), size, leading) + slack;
  const nextH = Math.round(Math.max(h, needed) * 100) / 100;
  return { x: nextX, y, w: nextW, h: nextH };
}

export function paint(
  add: Add,
  name: string,
  content: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: Style,
) {
  const fontSize = Number(style.fontSize) || 14;
  const lineHeight = Number(style.lineHeight) || 1.5;
  const align = style.textAlign || "right";
  const frame = balancedFrame(content, x, y, w, h, fontSize, lineHeight, align);
  add("text", {
    name,
    content,
    x: frame.x,
    y: frame.y,
    w: frame.w,
    h: frame.h,
    style: {
      textBoxMode: "autoHeight",
      overflowVisible: true,
      lineHeight,
      ...style,
    },
  });
}

export function band(
  add: Add,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
) {
  add("shape", {
    name,
    x,
    y,
    w,
    h,
    style: { fill, borderWidth: 0, radius: 0 },
  });
}

export function hairline(
  add: Add,
  name: string,
  x: number,
  y: number,
  w: number,
  color: string,
  stroke = 0.3,
) {
  add("line", {
    name,
    x,
    y,
    w,
    h: 0.4,
    style: { color, stroke },
  });
}

export function tick(
  add: Add,
  name: string,
  x: number,
  y: number,
  h: number,
  color: string,
) {
  band(add, name, x, y, 0.35, h, color);
}

/** Quiet running head: section on the right, a gold diamond, one thread. */
export function runningHead(add: Add, theme: Theme, section: string, w = 210) {
  const ink = mediaInk(theme);
  mark(add, "معين الرأس", 16, 11.4, 3.2, 3.2, ink.gold, "diamond");
  paint(add, "قسم الصفحة", section, 24, 10, w - 42, 6, {
    fontFamily: META,
    fontSize: 8,
    fontWeight: 600,
    color: theme.muted,
    textAlign: "right",
    letterSpacing: 0.4,
  });
  hairline(add, "خط الرأس", 16, 18.5, w - 32, ink.gold, 0.35);
}

/**
 * Green footer bar and the page number inside a gold circle on the outer edge.
 */
export function folio(
  add: Add,
  theme: Theme,
  org: string,
  pageNo: string,
  w = 210,
  h = 297,
) {
  const ink = mediaInk(theme);
  const barH = 14;
  const y = h - barH;
  band(add, "تذييل أخضر", 0, y, w, barH, ink.green);
  const d = 9;
  const cy = y + (barH - d) / 2;
  mark(add, "دائرة الرقم", 8, cy, d, d, ink.gold, "circle");
  paint(add, "رقم الصفحة", pageNo, 8, cy, d, d, {
    fontFamily: META,
    fontSize: 6.5,
    fontWeight: 700,
    color: ink.green,
    textAlign: "center",
    lineHeight: 1,
    verticalAlign: "middle",
  });
  paint(add, "تذييل الجهة", org || "اسم الجهة", 22, y + 3.6, w - 32, 7, {
    fontFamily: META,
    fontSize: 8,
    fontWeight: 600,
    color: "#f4f7f5",
    textAlign: "right",
  });
}

/** Official catalog ink. Other themes keep their own primary and accent. */
export function mediaInk(theme: Theme) {
  if (theme.id === "official") {
    return {
      green: "#0c3d2c",
      mid: "#1b4d3e",
      line: "#1f6b45",
      gold: "#c6a05a",
      soft: "#e7efe9",
    };
  }
  return {
    green: theme.primary,
    mid: theme.primarySoft,
    line: theme.primarySoft,
    gold: theme.accent,
    soft: theme.surface,
  };
}

export function mark(
  add: Add,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  shapeId: string,
) {
  return add("shape", {
    name,
    x,
    y,
    w,
    h,
    style: { fill, borderWidth: 0, radius: 0, shapeId },
  });
}

/** White KPI card: green icon tile, huge number, gold diamond, short label. */
export function kpiCard(
  add: Add,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  value: string,
  label: string,
  green: string,
  gold: string,
  ink: string,
) {
  add("shape", {
    name: `بطاقة ${name}`,
    x,
    y,
    w,
    h,
    style: { fill: "#ffffff", borderColor: "#e4e0d8", borderWidth: 0.35, radius: 2, shapeId: "rounded" },
  });
  band(add, `أيقونة ${name}`, x + w - 16, y + 5, 10, 10, green);
  paint(add, `رقم ${name}`, value, x + 6, y + 6, w - 26, 16, {
    ...ROLE.display,
    fontSize: 22,
    color: green,
    lineHeight: 1,
  });
  mark(add, `معين ${name}`, x + 6, y + h - 14, 3, 3, gold, "diamond");
  paint(add, `تسمية ${name}`, label, x + 12, y + h - 16, w - 18, 10, {
    ...ROLE.caption,
    fontSize: 8,
    color: ink,
    lineHeight: 1.25,
  });
}

/**
 * Photographic stand-ins. The author replaces the source; the frame stays.
 * No emblem, no flag, no real portrait.
 */
export function plate(
  kind: "facade" | "court" | "archive" | "press" | "dune" | "night" | "field" | "portrait",
): string {
  const art: Record<typeof kind, string> = {
    facade: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#c5d5cc"/><rect y="300" width="800" height="220" fill="#8ea396"/><rect x="70" y="150" width="180" height="280" fill="#24362e"/><rect x="270" y="90" width="250" height="340" fill="#1a2c24"/><rect x="540" y="180" width="160" height="250" fill="#31463c"/><rect x="300" y="140" width="70" height="46" fill="#e7d7b0"/><rect x="390" y="140" width="70" height="46" fill="#d7c49a"/><rect x="300" y="210" width="70" height="46" fill="#efe3c4"/><rect x="390" y="210" width="70" height="46" fill="#e7d7b0"/><rect y="470" width="800" height="50" fill="#0c3d2c"/></svg>`,
    court: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#d5e3da"/><rect y="250" width="800" height="270" fill="#0c3d2c"/><path d="M0 250 C200 180 360 300 560 210 C680 160 740 200 800 170 L800 250 Z" fill="#1b4d3e"/><rect x="90" y="280" width="220" height="150" fill="#145c42"/><rect x="340" y="240" width="160" height="190" fill="#08281d"/><rect x="530" y="300" width="180" height="130" fill="#1f6b45"/><rect y="490" width="800" height="8" fill="#c6a05a"/></svg>`,
    archive: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#ece7df"/><rect y="340" width="800" height="180" fill="#d9cbb8"/><rect x="80" y="150" width="280" height="220" fill="#f7f4ee"/><rect x="100" y="170" width="240" height="8" fill="#0c3d2c"/><rect x="100" y="190" width="180" height="4" fill="#c6a05a"/><rect x="100" y="210" width="200" height="4" fill="#cfc6ba"/><rect x="420" y="180" width="280" height="180" fill="#0c3d2c"/><rect x="450" y="210" width="90" height="120" fill="#1b4d3e"/><rect x="560" y="210" width="100" height="120" fill="#145c42"/></svg>`,
    press: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 860"><rect width="640" height="860" fill="#1c2420"/><rect y="520" width="640" height="340" fill="#101614"/><circle cx="470" cy="250" r="70" fill="#c6a05a"/><rect x="70" y="300" width="260" height="420" fill="#24302a"/><rect x="100" y="340" width="180" height="12" fill="#f4f1ea"/><rect x="100" y="370" width="140" height="6" fill="#8fa396"/><rect x="100" y="390" width="160" height="6" fill="#8fa396"/><rect y="800" width="640" height="10" fill="#c6a05a"/></svg>`,
    dune: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#e7efe9"/><path d="M0 300 C160 220 300 360 480 280 C640 210 720 250 800 200 L800 520 L0 520 Z" fill="#1b4d3e"/><path d="M0 380 C200 320 340 440 540 370 C680 330 740 360 800 340 L800 520 L0 520 Z" fill="#0c3d2c"/><circle cx="140" cy="110" r="26" fill="#c6a05a"/></svg>`,
    night: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#14211c"/><rect x="180" y="70" width="200" height="370" fill="#1c2e26"/><rect x="210" y="110" width="50" height="70" fill="#c6a05a"/><rect x="280" y="110" width="50" height="70" fill="#8a7344"/><rect x="430" y="140" width="220" height="300" fill="#0c1914"/><rect x="470" y="180" width="140" height="40" fill="#e7d7b0" opacity="0.85"/><rect y="470" width="800" height="50" fill="#08110e"/></svg>`,
    field: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420"><rect width="800" height="420" fill="#d5e4db"/><rect y="230" width="800" height="190" fill="#0c3d2c"/><rect x="60" y="80" width="28" height="250" fill="#145c42"/><rect x="140" y="40" width="240" height="290" fill="#1b4d3e"/><rect x="170" y="80" width="70" height="40" fill="#e7d7b0"/><rect x="260" y="80" width="70" height="40" fill="#f3ead2"/><rect x="430" y="120" width="180" height="210" fill="#08281d"/><rect x="640" y="160" width="100" height="170" fill="#145c42"/><rect y="400" width="800" height="8" fill="#c6a05a"/></svg>`,
    portrait: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 800"><rect width="640" height="800" fill="#e7efe9"/><path d="M320 36C190 36 96 150 96 310V760H544V310C544 150 450 36 320 36Z" fill="#c6a05a"/><path d="M320 58C206 58 124 162 124 310V734H516V310C516 162 434 58 320 58Z" fill="#0c3d2c"/><ellipse cx="320" cy="300" rx="92" ry="112" fill="#1b4d3e"/><path d="M150 760 C190 560 250 500 320 500 C390 500 450 560 490 760 Z" fill="#145c42"/></svg>`,
  };
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(art[kind])}`;
}

export function tableStyle(
  theme: Theme,
  cols: number,
  rows: number,
): Style {
  return {
    cols,
    rows,
    fontSize: 10,
    fontFamily: META,
    cellAlign: "center",
    headerBg: theme.primary,
    headerColor: "#ffffff",
    tableBg: "#ffffff",
    stripeBg: theme.surface,
    borderColor: theme.line,
    color: theme.ink,
  };
}

export const A4 = { w: 210, h: 297 };
export const SLIDE = { w: 338.7, h: 190.5 };
