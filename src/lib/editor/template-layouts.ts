import type { CanvasEl, Theme } from "./model";

/**
 * Shared editorial grammar for the existing NASAQ templates.
 *
 * A4 measure: 16mm margin, 178mm column, 4mm rhythm.
 * Type roles stay stable: Tajawal for display, Noto Naskh for prose,
 * IBM Plex Sans Arabic for metadata, Amiri for ceremonial pages.
 * Every mark is a real element — nothing here is a flattened picture of a page.
 */

export type Add = (type: CanvasEl["type"], over?: Partial<CanvasEl>) => CanvasEl;
type Style = CanvasEl["style"];

export const DISPLAY = "Tajawal";
export const BODY = "Noto Naskh Arabic";
export const META = "IBM Plex Sans Arabic";
export const CEREMONY = "Amiri";

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
  add("text", {
    name,
    content,
    x,
    y,
    w,
    h,
    style: { textBoxMode: "fixed", lineHeight: 1.35, ...style },
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

/** Quiet running head: section on the right, a single rule, no banner. */
export function runningHead(add: Add, theme: Theme, section: string, w = 210) {
  paint(add, "قسم الصفحة", section, 16, 12, w - 32, 6, {
    fontFamily: META,
    fontSize: 8,
    fontWeight: 600,
    color: theme.muted,
    textAlign: "right",
    letterSpacing: 0.4,
  });
  hairline(add, "خط الرأس", 16, 20, w - 32, theme.line, 0.35);
}

/** Page number on the outer edge, entity on the inner edge. */
export function folio(
  add: Add,
  theme: Theme,
  org: string,
  pageNo: string,
  w = 210,
  h = 297,
) {
  const y = h - 12;
  hairline(add, "خط التذييل", 16, y - 4, w - 32, theme.line, 0.3);
  paint(add, "رقم الصفحة", pageNo, 16, y, 22, 6, {
    fontFamily: META,
    fontSize: 8,
    fontWeight: 600,
    color: theme.muted,
    textAlign: "left",
  });
  paint(add, "تذييل الجهة", org || "اسم الجهة", 42, y, w - 58, 6, {
    fontFamily: META,
    fontSize: 8,
    fontWeight: 600,
    color: theme.muted,
    textAlign: "right",
  });
}

/**
 * Designed image plates — architectural and editorial fields, not labelled
 * placeholders. The author replaces the source; the crop and scale stay.
 */
export function plate(
  kind: "facade" | "court" | "archive" | "press" | "dune" | "night" | "field",
): string {
  const art: Record<typeof kind, string> = {
    facade: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 860"><rect width="640" height="860" fill="#1a2836"/><rect y="640" width="640" height="220" fill="#101820"/><rect x="36" y="150" width="54" height="610" fill="#243646"/><rect x="108" y="230" width="42" height="530" fill="#2d455c"/><rect x="168" y="120" width="96" height="640" fill="#1c3144"/><rect x="284" y="260" width="36" height="500" fill="#34506a"/><rect x="338" y="80" width="120" height="680" fill="#24384c"/><rect x="476" y="210" width="70" height="550" fill="#182838"/><g fill="#e7d3a8" opacity="0.85"><rect x="196" y="180" width="14" height="18"/><rect x="222" y="180" width="14" height="18"/><rect x="196" y="220" width="14" height="18"/><rect x="222" y="220" width="14" height="18"/><rect x="368" y="140" width="16" height="22"/><rect x="396" y="140" width="16" height="22"/><rect x="368" y="184" width="16" height="22"/><rect x="396" y="184" width="16" height="22"/><rect x="368" y="228" width="16" height="22"/><rect x="396" y="228" width="16" height="22"/></g><rect y="812" width="640" height="5" fill="#c6a05a"/></svg>`,
    court: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#0c3d2c"/><rect y="360" width="800" height="160" fill="#08281d"/><path d="M0 360 Q400 250 800 360" fill="#145c42"/><circle cx="640" cy="120" r="46" fill="#d4af37"/><rect x="70" y="250" width="18" height="200" fill="#d4af37" opacity="0.85"/><rect x="120" y="290" width="460" height="8" fill="#d4af37" opacity="0.55"/><rect x="150" y="180" width="90" height="230" fill="#0a3024"/><rect x="260" y="140" width="70" height="270" fill="#103f30"/></svg>`,
    archive: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#efe6d6"/><rect x="0" y="0" width="280" height="520" fill="#1b4d3e"/><rect x="300" y="70" width="430" height="8" fill="#c6a05a"/><rect x="300" y="110" width="360" height="4" fill="#d9cbb6"/><rect x="300" y="140" width="390" height="4" fill="#d9cbb6"/><rect x="300" y="170" width="330" height="4" fill="#d9cbb6"/><rect x="300" y="220" width="200" height="220" fill="#1b4d3e"/><rect x="520" y="220" width="200" height="100" fill="#c6a05a"/><rect x="520" y="340" width="200" height="100" fill="#172033"/></svg>`,
    press: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 860"><rect width="640" height="860" fill="#111318"/><rect x="0" y="520" width="640" height="340" fill="#1c1917"/><circle cx="470" cy="230" r="90" fill="#c2410c" opacity="0.9"/><rect x="60" y="300" width="240" height="420" fill="#2a241f"/><rect x="80" y="330" width="200" height="12" fill="#f5f0ea"/><rect x="80" y="360" width="160" height="6" fill="#a8a29e"/><rect x="80" y="380" width="180" height="6" fill="#a8a29e"/><rect x="80" y="400" width="140" height="6" fill="#a8a29e"/></svg>`,
    dune: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#e7d7be"/><path d="M0 340 C180 260 280 400 460 320 C620 250 700 300 800 250 L800 520 L0 520 Z" fill="#c4a574"/><path d="M0 400 C200 340 360 460 560 390 C680 350 740 380 800 360 L800 520 L0 520 Z" fill="#3f2e1f"/><circle cx="150" cy="120" r="28" fill="#f4efe6"/></svg>`,
    night: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520"><rect width="800" height="520" fill="#14120f"/><rect x="180" y="80" width="220" height="360" fill="#1c1917"/><rect x="210" y="120" width="70" height="90" fill="#c6a05a"/><rect x="300" y="120" width="70" height="90" fill="#8a6232"/><rect x="460" y="160" width="180" height="280" fill="#231e1a"/><rect x="500" y="200" width="100" height="60" fill="#e7d3a8" opacity="0.8"/><rect y="470" width="800" height="50" fill="#0c0a09"/></svg>`,
    field: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420"><rect width="800" height="420" fill="#e9f3ed"/><rect y="250" width="800" height="170" fill="#006c35"/><rect x="40" y="80" width="16" height="250" fill="#0c3d2c"/><rect x="90" y="140" width="16" height="190" fill="#145c42"/><rect x="150" y="60" width="220" height="270" fill="#0c3d2c"/><rect x="400" y="110" width="160" height="220" fill="#1b4d3e"/><rect x="590" y="160" width="90" height="170" fill="#0c3d2c"/><rect y="400" width="800" height="6" fill="#c9a86a"/></svg>`,
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
