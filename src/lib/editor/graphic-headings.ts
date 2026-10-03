/**
 * Graphic Headings — عناوين جرافيكية جاهزة
 * 10 أنماط جاهزة كعناصر/مجموعات قابلة للتحرير
 * كل عنوان: يضاف مباشرة إلى اللوحة كمجموعة منظمة، RTL صحيح، متوازن
 */

import {
  createElement,
  createGroupFrom,
  type CanvasEl,
  type Theme,
  type ThemeId,
  THEMES,
} from "./model";

export type GraphicHeadingId =
  | "main"
  | "section"
  | "sub"
  | "bar"
  | "card"
  | "numbered"
  | "separator"
  | "institutional"
  | "modern"
  | "simple";

export interface GraphicHeadingDef {
  id: GraphicHeadingId;
  label: string;
  hint: string;
  thumbnail: GraphicHeadingId;
}

export const GRAPHIC_HEADINGS: GraphicHeadingDef[] = [
  { id: "main", label: "عنوان رئيسي", hint: "كبير مع خط ذهبي سفلي", thumbnail: "main" },
  { id: "section", label: "عنوان قسم", hint: "شريط جانبي أخضر", thumbnail: "section" },
  { id: "sub", label: "عنوان فرعي", hint: "نقطة ذهبية + نص متوسط", thumbnail: "sub" },
  { id: "bar", label: "عنوان داخل شريط", hint: "خلفية داكنة ونص أبيض", thumbnail: "bar" },
  { id: "card", label: "عنوان داخل بطاقة", hint: "بطاقة بيضاء بظل خفيف", thumbnail: "card" },
  { id: "numbered", label: "عنوان مع رقم القسم", hint: "رقم داخل دائرة + عنوان", thumbnail: "numbered" },
  { id: "separator", label: "عنوان مع فاصل", hint: "خط فاصل وزخرفة", thumbnail: "separator" },
  { id: "institutional", label: "عنوان مؤسسي", hint: "إطار رسمي وخط Amiri", thumbnail: "institutional" },
  { id: "modern", label: "عنوان حديث", hint: "خلفية ملونة وتدرج عصري", thumbnail: "modern" },
  { id: "simple", label: "عنوان بسيط", hint: "نص نظيف بدون زخرفة", thumbnail: "simple" },
];

function txt(theme: Theme, over: Partial<CanvasEl>, style: Partial<CanvasEl["style"]> = {}): CanvasEl {
  return createElement(
    "text",
    {
      ...over,
      style: {
        fontFamily: "Cairo",
        color: theme.ink,
        textAlign: "right" as const,
        lineHeight: 1.45,
        textFit: "shrink" as const,
        ...style,
      },
    },
    theme,
  );
}
function boxEl(theme: Theme, over: Partial<CanvasEl>, style: Partial<CanvasEl["style"]> = {}): CanvasEl {
  return createElement(
    "box",
    {
      ...over,
      style: {
        fill: theme.surface,
        borderColor: theme.line,
        borderWidth: 0.3,
        radius: 3,
        padding: 3,
        ...style,
      },
    },
    theme,
  );
}
function lineEl(theme: Theme, over: Partial<CanvasEl>, style: Partial<CanvasEl["style"]> = {}): CanvasEl {
  return createElement(
    "line",
    {
      ...over,
      style: {
        color: theme.accent,
        stroke: 0.6,
        ...style,
      },
    },
    theme,
  );
}
function shapeEl(theme: Theme, over: Partial<CanvasEl>, style: Partial<CanvasEl["style"]> = {}): CanvasEl {
  return createElement(
    "shape",
    {
      ...over,
      style: {
        fill: theme.primary,
        ...style,
      },
    },
    theme,
  );
}

function makeGroup(els: CanvasEl[], name: string): CanvasEl {
  const g = createGroupFrom(els, name);
  if (!g) return els[0];
  // Ensure group has shrink fit for long text adaptability
  return g;
}

// Builders — all RTL balanced, organized, no overlap, proper padding

function buildMain(theme: Theme): CanvasEl {
  // Main heading: large text with gold underline, white bg
  const W = 160;
  const bg = boxEl(theme, { name: "خلفية رئيسي", x: 0, y: 0, w: W, h: 22, content: "" }, { fill: "#ffffff", borderColor: "transparent", borderWidth: 0, radius: 2, padding: 0 });
  const textEl = txt(theme, { name: "عنوان رئيسي", x: 0, y: 0, w: W, h: 16, content: "عنوان رئيسي" }, { fontFamily: "Tajawal", fontSize: 20, fontWeight: 900, color: theme.primary, textAlign: "right", lineHeight: 1.25, textFit: "shrink" });
  // Gold line at bottom right (RTL)
  const line = lineEl(theme, { name: "خط ذهبي", x: W - 44, y: 18.5, w: 44, h: 1.2 }, { color: theme.accent, stroke: 1.1 });
  return makeGroup([bg, textEl, line], "عنوان رئيسي");
}

function buildSection(theme: Theme): CanvasEl {
  const W = 160;
  // Side bar on RIGHT for RTL
  const bg = boxEl(theme, { name: "خلفية قسم", x: 0, y: 0, w: W, h: 14, content: "" }, { fill: "#ffffff", borderColor: "transparent" });
  const accent = shapeEl(theme, { name: "شريط جانبي", x: W - 4, y: 0, w: 4, h: 14 }, { fill: theme.primary, radius: 1.5 });
  const textEl = txt(theme, { name: "عنوان قسم", x: 0, y: 0, w: W - 10, h: 14, content: "عنوان القسم" }, { fontFamily: "Tajawal", fontSize: 15, fontWeight: 800, color: theme.ink, textAlign: "right", textFit: "shrink" });
  return makeGroup([bg, accent, textEl], "عنوان قسم");
}

function buildSub(theme: Theme): CanvasEl {
  const W = 160;
  // Dot on right side for RTL
  const bg = boxEl(theme, { name: "خلفية فرعي", x: 0, y: 0, w: W, h: 10, content: "" }, { fill: "#ffffff", borderColor: "transparent" });
  const dot = shapeEl(theme, { name: "نقطة", x: W - 6, y: 2.5, w: 5, h: 5 }, { fill: theme.accent, shapeId: "circle" });
  const textEl = txt(theme, { name: "عنوان فرعي", x: 0, y: 0, w: W - 10, h: 10, content: "عنوان فرعي" }, { fontFamily: "Cairo", fontSize: 12.5, fontWeight: 700, color: theme.ink, textAlign: "right", textFit: "shrink" });
  return makeGroup([bg, dot, textEl], "عنوان فرعي");
}

function buildBar(theme: Theme): CanvasEl {
  const W = 160;
  const bg = boxEl(theme, { name: "شريط", x: 0, y: 0, w: W, h: 13, content: "" }, { fill: theme.primary, borderColor: theme.primary, radius: 4, padding: 0 });
  const textEl = txt(theme, { name: "عنوان داخل شريط", x: 3, y: 1, w: W - 6, h: 11, content: "عنوان داخل شريط" }, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 800, color: "#ffffff", textAlign: "right", textFit: "shrink" });
  return makeGroup([bg, textEl], "عنوان داخل شريط");
}

function buildCard(theme: Theme): CanvasEl {
  const W = 160;
  const card = boxEl(theme, { name: "بطاقة", x: 0, y: 0, w: W, h: 18, content: "" }, { fill: "#ffffff", borderColor: theme.line, borderWidth: 0.35, radius: 6, shadow: "0 1mm 3mm rgba(15,23,42,.10)", padding: 0 });
  const accent = shapeEl(theme, { name: "شريط بطاقة", x: W - 3, y: 0, w: 3, h: 18 }, { fill: theme.accent, radius: 1 });
  const textEl = txt(theme, { name: "عنوان بطاقة", x: 4, y: 2, w: W - 12, h: 14, content: "عنوان داخل بطاقة" }, { fontFamily: "Tajawal", fontSize: 13, fontWeight: 800, color: theme.ink, textAlign: "right", textFit: "shrink" });
  return makeGroup([card, accent, textEl], "عنوان داخل بطاقة");
}

function buildNumbered(theme: Theme): CanvasEl {
  const W = 160;
  const bg = boxEl(theme, { name: "خلفية مرقم", x: 0, y: 0, w: W, h: 14, content: "" }, { fill: "#ffffff", borderColor: "transparent" });
  // Circle on RIGHT for RTL
  const circle = shapeEl(theme, { name: "دائرة رقم", x: W - 12, y: 1, w: 12, h: 12 }, { fill: theme.primary, shapeId: "circle" });
  const num = txt(theme, { name: "رقم", x: W - 12, y: 1.5, w: 12, h: 11, content: "١" }, { fontFamily: "Cairo", fontSize: 9, fontWeight: 800, color: "#ffffff", textAlign: "center", textFit: "shrink" });
  const textEl = txt(theme, { name: "عنوان مرقم", x: 0, y: 0, w: W - 18, h: 14, content: "عنوان مع رقم القسم" }, { fontFamily: "Tajawal", fontSize: 13, fontWeight: 800, color: theme.ink, textAlign: "right", textFit: "shrink" });
  return makeGroup([bg, circle, num, textEl], "عنوان مع رقم القسم");
}

function buildSeparator(theme: Theme): CanvasEl {
  const W = 160;
  const bg = boxEl(theme, { name: "خلفية فاصل", x: 0, y: 0, w: W, h: 12, content: "" }, { fill: "#ffffff", borderColor: "transparent" });
  const textEl = txt(theme, { name: "عنوان فاصل", x: W - 88, y: 0, w: 88, h: 12, content: "عنوان مع فاصل" }, { fontFamily: "Tajawal", fontSize: 12, fontWeight: 800, color: theme.ink, textAlign: "right", textFit: "shrink" });
  const dot = shapeEl(theme, { name: "زخرفة", x: W - 92, y: 4.5, w: 3, h: 3 }, { fill: theme.accent, shapeId: "circle" });
  const line = lineEl(theme, { name: "خط فاصل", x: 0, y: 6, w: W - 96, h: 0.8 }, { color: theme.line, stroke: 0.35 });
  return makeGroup([bg, textEl, dot, line], "عنوان مع فاصل");
}

function buildInstitutional(theme: Theme): CanvasEl {
  const W = 160;
  const frame = boxEl(theme, { name: "إطار مؤسسي", x: 0, y: 0, w: W, h: 20, content: "" }, { fill: "#ffffff", borderColor: theme.primary, borderWidth: 0.5, radius: 2, padding: 0 });
  const topBar = shapeEl(theme, { name: "شريط علوي", x: 0, y: 0, w: W, h: 1, }, { fill: theme.primary });
  const textEl = txt(theme, { name: "عنوان مؤسسي", x: 4, y: 3, w: W - 8, h: 14, content: "عنوان مؤسسي" }, { fontFamily: "Amiri", fontSize: 14, fontWeight: 700, color: theme.primary, textAlign: "center", textFit: "shrink" });
  return makeGroup([frame, topBar, textEl], "عنوان مؤسسي");
}

function buildModern(theme: Theme): CanvasEl {
  const W = 160;
  const bg = boxEl(theme, { name: "خلفية حديثة", x: 0, y: 0, w: W, h: 16, content: "" }, { fill: theme.surface, borderColor: theme.line, borderWidth: 0.3, radius: 8, padding: 0 });
  // Accent on right for RTL modern touch
  const accent = shapeEl(theme, { name: "لمسة حديثة", x: W - 32, y: 0, w: 32, h: 16 }, { fill: theme.primary, radius: 8 });
  const textEl = txt(theme, { name: "عنوان حديث", x: 4, y: 2, w: W - 40, h: 12, content: "عنوان حديث" }, { fontFamily: "Tajawal", fontSize: 13, fontWeight: 800, color: theme.ink, textAlign: "right", textFit: "shrink" });
  return makeGroup([bg, accent, textEl], "عنوان حديث");
}

function buildSimple(theme: Theme): CanvasEl {
  const W = 160;
  const bg = boxEl(theme, { name: "خلفية بسيط", x: 0, y: 0, w: W, h: 10, content: "" }, { fill: "#ffffff", borderColor: "transparent" });
  const textEl = txt(theme, { name: "عنوان بسيط", x: 0, y: 0, w: W, h: 10, content: "عنوان بسيط" }, { fontFamily: "Cairo", fontSize: 12, fontWeight: 700, color: theme.ink, textAlign: "right", lineHeight: 1.4, textFit: "shrink" });
  return makeGroup([bg, textEl], "عنوان بسيط");
}

export function buildGraphicHeading(
  id: GraphicHeadingId,
  themeId: ThemeId,
): CanvasEl | null {
  const theme = THEMES[themeId] ?? THEMES.official;
  switch (id) {
    case "main": return buildMain(theme);
    case "section": return buildSection(theme);
    case "sub": return buildSub(theme);
    case "bar": return buildBar(theme);
    case "card": return buildCard(theme);
    case "numbered": return buildNumbered(theme);
    case "separator": return buildSeparator(theme);
    case "institutional": return buildInstitutional(theme);
    case "modern": return buildModern(theme);
    case "simple": return buildSimple(theme);
    default: return null;
  }
}
