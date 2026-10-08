import { uid } from "@/lib/utils";
import {
  THEMES,
  createElement,
  nextZ,
  pageSize,
  sizeIdOf,
  type CanvasEl,
  type ElType,
  type Page,
  type Project,
} from "@/lib/editor/model";
import type { PaletteRoles } from "./schema";
import type { PromptAnalysis } from "./prompt-analyzer";
import { plate } from "@/lib/editor/template-layouts";
import {
  directiveForPattern,
  enforceLayoutVariety,
  planPageLayouts,
  stampLayoutMeta,
  type LayoutPatternId,
  type PageLayoutDirective,
} from "./layout-variety";
import { applyStylePreset, presetForDesignStyle } from "./style-presets";

// High quality SVG artwork stand-ins tailored to themes
function themedArtwork(topic: string): string {
  if (topic.includes("سيبران") || topic.includes("تقن") || topic.includes("معلومات")) {
    const cyberSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#07172c" />
          <stop offset="100%" stop-color="#0d2b45" />
        </linearGradient>
        <linearGradient id="glow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#00a3c4" stop-opacity="0.8" />
          <stop offset="100%" stop-color="#20c997" stop-opacity="0.8" />
        </linearGradient>
      </defs>
      <rect width="800" height="500" fill="url(#bg)" />
      <g stroke="#1b3d63" stroke-width="1" opacity="0.4">
        <path d="M0,100 H800 M0,200 H800 M0,300 H800 M0,400 H800" />
        <path d="M100,0 V500 M200,0 V500 M300,0 V500 M400,0 V500 M500,0 V500 M600,0 V500 M700,0 V500" />
      </g>
      <g fill="none" stroke="url(#glow)" stroke-width="2.5">
        <polygon points="400,120 540,200 540,360 400,440 260,360 260,200" opacity="0.9" />
        <polygon points="400,160 500,220 500,340 400,390 300,340 300,220" opacity="0.5" stroke-dasharray="6,4" />
        <circle cx="400" cy="280" r="45" fill="#0c233f" stroke="#00a3c4" stroke-width="3" />
      </g>
      <path d="M385,280 L395,290 L418,268" fill="none" stroke="#20c997" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="260" cy="200" r="6" fill="#00a3c4" />
      <circle cx="540" cy="200" r="6" fill="#00a3c4" />
      <circle cx="540" cy="360" r="6" fill="#20c997" />
      <circle cx="260" cy="360" r="6" fill="#20c997" />
      <circle cx="400" cy="120" r="7" fill="#00e5ff" />
      <circle cx="400" cy="440" r="7" fill="#20c997" />
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cyberSvg)}`;
  }
  if (topic.includes("طاقة") || topic.includes("بيئة") || topic.includes("استدامة")) {
    return plate("dune");
  }
  if (topic.includes("حكومي") || topic.includes("سنوي") || topic.includes("سيادي")) {
    return plate("facade");
  }
  if (topic.includes("شركة") || topic.includes("أعمال") || topic.includes("مالي")) {
    return plate("night");
  }
  return plate("court");
}

function sheet(name: string, w: number, h: number, paper: string): Page {
  return { id: uid("page"), name, bg: paper, w, h, elements: [] };
}

function put(page: Page, type: ElType, over: Partial<CanvasEl>): CanvasEl {
  const el = createElement(type, over, THEMES.official);
  el.z = nextZ(page);
  page.elements.push(el);
  return el;
}

function gradient(field: string, accent: string, reverse = false) {
  return {
    type: "linear" as const,
    angle: reverse ? 135 : 225,
    cx: 50,
    cy: 50,
    stops: [
      { id: "field", offset: 0, color: field, opacity: 1 },
      { id: "accent", offset: 0.62, color: accent, opacity: 0.92 },
      { id: "deep", offset: 1, color: field, opacity: 1 },
    ],
  };
}

function premiumOrnament(page: Page, intent: PromptAnalysis, index: number) {
  const { w, h } = pageSize(page);
  const p = intent.palette;
  const creative = intent.generationMode === "generate";
  const tight = intent.generationMode === "balance";
  const variant = (index + (creative ? 1 : tight ? 2 : 0)) % 3;
  page.bgGradient = gradient(p.paper, p.field, variant === 1);
  put(page, "shape", {
    name: "موجة زخرفية قابلة للتحرير",
    x: variant === 0 ? -12 : w * 0.42,
    y: h - (tight ? 42 : 64),
    w: w * 0.72,
    h: tight ? 44 : 72,
    opacity: 0.12,
    style: { fill: p.field, borderWidth: 0, shapeId: "wave" },
  });
  put(page, "shape", {
    name: "منحنى جانبي قابل للتحرير",
    x: variant === 2 ? -12 : w - 30,
    y: variant === 2 ? 22 : 8,
    w: 42,
    h: h * 0.48,
    opacity: 0.1,
    style: { fill: p.accent, borderWidth: 0, shapeId: "curve-side" },
  });
  put(page, "shape", {
    name: "معين زخرفي",
    x: variant === 1 ? w * 0.22 : w - 28,
    y: 22 + variant * 8,
    w: 9,
    h: 9,
    opacity: 0.9,
    style: { fill: p.accent, borderWidth: 0, shapeId: "diamond" },
  });
  put(page, "line", {
    name: "خيط الإيقاع البصري",
    x: variant === 1 ? w * 0.2 : w * 0.58,
    y: h * 0.22,
    w: w * 0.22,
    h: 0,
    opacity: 0.85,
    style: { color: p.accent, stroke: 0.8 },
  });
}

function write(
  page: Page,
  name: string,
  content: string,
  x: number,
  y: number,
  w: number,
  h: number,
  style: CanvasEl["style"],
): CanvasEl {
  return put(page, "text", {
    name,
    content,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    w: Math.round(w * 10) / 10,
    h: Math.round(h * 10) / 10,
    style: {
      textAlign: "right",
      direction: "rtl",
      textBoxMode: "fixed",
      overflowVisible: false,
      ...style,
    },
  });
}

function marginOf(w: number): number {
  return Math.min(16, Math.max(10, Math.round(w * 0.06)));
}

/** Visible, editable fields instead of claims the prompt did not establish. */
function placeholder(field: string): string {
  return `[${field} يحدده المالك]`;
}

function runningHead(page: Page, palette: PaletteRoles, section: string, org: string) {
  const { w } = pageSize(page);
  const m = marginOf(w);

  // Top header bar
  put(page, "shape", {
    name: "خلفية الترويسة",
    x: 0,
    y: 0,
    w,
    h: 14,
    hfRole: "header",
    style: { fill: palette.field, borderWidth: 0, radius: 0, shape: "rect" },
  });

  // Golden thread hairline
  put(page, "line", {
    name: "خيط الترويسة",
    x: 0,
    y: 14,
    w,
    h: 0.6,
    hfRole: "header",
    style: { color: palette.accent, stroke: 0.6 },
  });

  // Section title in header
  const titleEl = write(page, "عنوان الترويسة", section, m + 40, 2.5, w - m * 2 - 40, 8, {
    fontFamily: "Tajawal",
    fontSize: 9,
    fontWeight: 700,
    color: palette.onField,
    lineHeight: 1.1,
  });
  titleEl.hfRole = "header";

  // Entity label
  if (org) {
    const orgEl = write(page, "جهة الترويسة", org, m, 2.5, 36, 8, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 7.5,
      fontWeight: 600,
      color: palette.accent,
      textAlign: "left",
      direction: "rtl",
      lineHeight: 1.1,
    });
    orgEl.hfRole = "header";
  }
}

function footerBar(
  page: Page,
  palette: PaletteRoles,
  org: string,
  pageNum: number,
  total: number,
  docType: string,
) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const barH = 14;
  const y = h - barH;

  // Bottom footer band
  put(page, "shape", {
    name: "تذييل الصفحة",
    x: 0,
    y,
    w,
    h: barH,
    hfRole: "footer",
    style: { fill: palette.field, borderWidth: 0, radius: 0, shape: "rect" },
  });

  // Golden accent line
  put(page, "line", {
    name: "خيط التذييل",
    x: 0,
    y,
    w,
    h: 0.4,
    hfRole: "footer",
    style: { color: palette.accent, stroke: 0.4 },
  });

  // Entity & doc type text
  const label = `${org || placeholder("اسم الجهة")} · ${docType}`;
  const orgEl = write(page, "بيانات التذييل", label, m + 24, y + 3.5, w - m * 2 - 30, 7, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 7.5,
    fontWeight: 600,
    color: palette.onField,
    lineHeight: 1.1,
  });
  orgEl.hfRole = "footer";

  // Folio circle
  const circleSize = 8;
  const cy = y + (barH - circleSize) / 2;
  put(page, "shape", {
    name: "دائرة الرقم",
    x: m,
    y: cy,
    w: circleSize,
    h: circleSize,
    hfRole: "footer",
    style: { fill: palette.accent, borderWidth: 0, radius: 99, shape: "circle" },
  });

  const folioEl = write(page, "رقم الصفحة", String(pageNum), m, cy + 0.8, circleSize, circleSize, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 6.5,
    fontWeight: 700,
    color: palette.field,
    textAlign: "center",
    direction: "rtl",
    lineHeight: 1,
  });
  folioEl.hfRole = "footer";
}

// -------------------------------------------------------------
// Page Builder Functions
// -------------------------------------------------------------

export function buildOfficialCover(page: Page, intent: PromptAnalysis) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;
  const cover = intent.coverStyle;
  const creative = intent.generationMode === "generate";
  const darkCover = ["premium", "gradient", "wave", "geometric", "image-led", "media"].includes(cover);
  page.bgGradient = darkCover ? gradient(p.field, p.accent, creative) : gradient(p.paper, p.field);
  if (darkCover) {
    put(page, "shape", {
      name: "طبقة الغلاف المتدرجة",
      x: 0,
      y: 0,
      w,
      h,
      style: { fill: p.field, gradient: gradient(p.field, p.accent, creative), borderWidth: 0, shapeId: "rect" },
    });
  }
  if (["wave", "media", "annual-report"].includes(cover)) {
    put(page, "shape", {
      name: "موجة الغلاف الرئيسية",
      x: -12,
      y: h * 0.58,
      w: w * 0.78,
      h: h * 0.38,
      opacity: 0.92,
      style: { fill: p.field, gradient: gradient(p.field, p.accent), borderWidth: 0, shapeId: "wave" },
    });
  }
  if (["geometric", "annual-report", "legal"].includes(cover)) {
    put(page, "shape", {
      name: "كتلة هندسية للغلاف",
      x: w * 0.58,
      y: 0,
      w: w * 0.48,
      h: h * 0.42,
      opacity: 0.82,
      style: { fill: p.accent, gradient: gradient(p.accent, p.field, true), borderWidth: 0, shapeId: "diagonal" },
    });
  }
  if (cover === "minimal" || cover === "legal") {
    put(page, "shape", {
      name: "إطار الغلاف الهادئ",
      x: m,
      y: m,
      w: w - m * 2,
      h: h - m * 2,
      opacity: 0.8,
      style: { fill: "none", borderColor: p.accent, borderWidth: 0.45, radius: 2, shapeId: "frame-rounded" },
    });
  }

  // Header band
  const bandH = darkCover ? Math.round(h * 0.42) : Math.round(h * 0.36);
  put(page, "shape", {
    name: "حقل الغلاف الرئيسي",
    x: 0,
    y: 0,
    w,
    h: bandH,
    style: { fill: p.field, gradient: darkCover ? gradient(p.field, p.accent, creative) : undefined, borderWidth: 0, radius: 0, shape: "rect" },
  });

  // Golden separator line
  put(page, "line", {
    name: "خيط ذهبي فاصل",
    x: 0,
    y: bandH,
    w,
    h: 1.2,
    style: { color: p.accent, stroke: 1.2 },
  });

  // Classification badge (top-right)
  put(page, "shape", {
    name: "شريط التصنيف",
    x: w - m - 46,
    y: 12,
    w: 46,
    h: 7,
    style: { fill: p.field, borderColor: p.accent, borderWidth: 0.4, radius: 3, shape: "rect" },
  });
  write(page, "نص التصنيف", intent.classification, w - m - 45, 13.2, 44, 5, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 6.5,
    fontWeight: 700,
    color: p.accent,
    textAlign: "center",
  });

  // Organization name
  write(page, "اسم الجهة في الغلاف", intent.org, m, 18, w - m * 2, 8, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 9.5,
    fontWeight: 600,
    color: p.accent,
    textAlign: "right",
    letterSpacing: 0.4,
  });

  // Main Title
  write(page, "العنوان", intent.title, m, 29, w - m * 2, 28, {
    fontFamily: "Tajawal",
    fontSize: 24,
    fontWeight: 800,
    color: p.onField,
    lineHeight: 1.15,
  });

  // Subtitle
  write(page, "المقدمة", intent.subtitle, m, 58, w - m * 2, 18, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 11,
    fontWeight: 500,
    color: p.onField,
    lineHeight: 1.5,
  });

  // Visual Image Plate (Middle)
  const plateY = bandH + 12;
  const plateH = Math.round(h * 0.38);
  put(page, "image", {
    name: "صورة الغلاف الرسمية",
    x: m,
    y: plateY,
    w: w - m * 2,
    h: plateH,
    src: themedArtwork(intent.topic),
    style: {
      radius: 4,
      borderColor: p.accent,
      borderWidth: 0.5,
      objectFit: "cover",
      frameId: ["wave", "media", "image-led"].includes(cover) ? "arch-frame" : "frame-rounded",
      fade: darkCover ? { from: "transparent", to: p.field, direction: "toBottom", opacity: 0.7, blend: "normal" } : undefined,
      brightness: darkCover ? 88 : 100,
      contrast: darkCover ? 112 : 100,
    },
  });

  // Footer Metadata Box
  const metaY = plateY + plateH + 10;
  put(page, "shape", {
    name: "إطار البيانات",
    x: m,
    y: metaY,
    w: w - m * 2,
    h: 22,
    style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 4 },
  });

  // Left accent tick on meta box
  put(page, "shape", {
    name: "علامة البيانات",
    x: w - m - 3,
    y: metaY,
    w: 3,
    h: 22,
    style: { fill: p.accent, borderWidth: 0, radius: 2 },
  });

  write(page, "تاريخ الإصدار", `تاريخ الإصدار: ${intent.dateString}`, m + 6, metaY + 4, (w - m * 2) / 2, 6, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 7.5,
    fontWeight: 600,
    color: p.muted,
  });

  write(page, "رقم الوثيقة", `الرقم المرجعي: ${placeholder("الرقم المرجعي")}`, m + (w - m * 2) / 2, metaY + 4, (w - m * 2) / 2 - 8, 6, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 7.5,
    fontWeight: 600,
    color: p.muted,
    textAlign: "left",
  });

  write(page, "الاعتماد", placeholder("حالة الاعتماد"), m + 6, metaY + 12, w - m * 2 - 12, 6, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 8,
    fontWeight: 700,
    color: p.ink,
  });
}

export function buildExecutiveOverview(page: Page, intent: PromptAnalysis, pageIndex: number, total: number) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;

  runningHead(page, p, "الملخص التنفيذي والرؤية العامة", intent.org);

  let y = 24;

  // Page Header
  write(page, "عنوان القسم", "المستخلص التنفيذي ومسارات العمل", m, y, w - m * 2, 10, {
    fontFamily: "Tajawal",
    fontSize: 16,
    fontWeight: 800,
    color: p.field,
  });
  y += 12;

  // Executive summary card with right accent border
  const cardH = 34;
  put(page, "shape", {
    name: "بطاقة المستخلص",
    x: m,
    y,
    w: w - m * 2,
    h: cardH,
    style: { fill: "#ffffff", borderColor: "#e4e9f0", borderWidth: 0.5, radius: 3 },
  });
  put(page, "shape", {
    name: "حد البطاقة الأيمن",
    x: w - m - 3,
    y,
    w: 3,
    h: cardH,
    style: { fill: p.field, borderWidth: 0, radius: 2 },
  });

  const summaryText = "[أضف ملخصًا موثقًا من المحتوى أو المصدر المعتمد]";

  write(page, "متن المستخلص", summaryText, m + 6, y + 4, w - m * 2 - 12, cardH - 8, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 9.5,
    fontWeight: 500,
    color: p.ink,
    lineHeight: 1.6,
  });
  y += cardH + 10;

  // Editorial Pull-Quote Block
  const quoteH = 22;
  put(page, "shape", {
    name: "إطار المقولة",
    x: m,
    y,
    w: w - m * 2,
    h: quoteH,
    style: { fill: p.paper, borderColor: p.accent, borderWidth: 0.6, radius: 3 },
  });
  write(page, "رمز الاقتباس", "«", w - m - 10, y + 2, 8, 8, {
    fontFamily: "Tajawal",
    fontSize: 18,
    fontWeight: 800,
    color: p.accent,
    textAlign: "center",
  });
  write(page, "نص المقولة", "[أضف اقتباسًا أو رسالة معتمدة من المصدر]", m + 6, y + 4, w - m * 2 - 18, quoteH - 8, {
    fontFamily: "Tajawal",
    fontSize: 10.5,
    fontWeight: 700,
    color: p.field,
    textAlign: "right",
    lineHeight: 1.4,
  });
  y += quoteH + 12;

  // Key Takeaways (3 Bullet Cards)
  write(page, "عنوان الركائز", "الركائز الأساسية لنتائج التقرير", m, y, w - m * 2, 8, {
    fontFamily: "Tajawal",
    fontSize: 12,
    fontWeight: 700,
    color: p.field,
  });
  y += 10;

  const takeawayH = 18;
  intent.summaryTakeaways.slice(0, 3).forEach((item, index) => {
    const itemY = y + index * (takeawayH + 4);
    put(page, "shape", {
      name: `بطاقة ركيزة ${index + 1}`,
      x: m,
      y: itemY,
      w: w - m * 2,
      h: takeawayH,
      style: { fill: "#ffffff", borderColor: "#edf2f7", borderWidth: 0.4, radius: 2 },
    });
    // Gold diamond mark
    put(page, "shape", {
      name: `معين ركيزة ${index + 1}`,
      x: w - m - 8,
      y: itemY + 6,
      w: 4,
      h: 4,
      style: { fill: p.accent, borderWidth: 0, radius: 0, shape: "rect", shapeId: "diamond" },
    });
    write(page, `نص ركيزة ${index + 1}`, item, m + 6, itemY + 3.5, w - m * 2 - 18, takeawayH - 6, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 9,
      fontWeight: 600,
      color: p.ink,
      lineHeight: 1.4,
    });
  });

  y += 3 * (takeawayH + 4) + 6;

  // Sign-off / Endorsement Box
  if (h - y > 40) {
    const signH = 26;
    put(page, "shape", {
      name: "إطار التوقيع",
      x: m,
      y,
      w: w - m * 2,
      h: signH,
      style: { fill: "#fafbfd", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 3 },
    });
    write(page, "صفة المعتمد", placeholder("صفة المعتمد"), m + 6, y + 4, (w - m * 2) / 2, 6, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 8,
      fontWeight: 700,
      color: p.field,
    });
    write(page, "اسم المعتمد", placeholder("اسم المعتمد"), m + 6, y + 11, (w - m * 2) / 2, 6, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 8,
      fontWeight: 500,
      color: p.muted,
    });
    write(page, "حالة الوثيقة", placeholder("حالة الوثيقة"), m + (w - m * 2) / 2, y + 7, (w - m * 2) / 2 - 8, 8, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 8,
      fontWeight: 700,
      color: p.accent,
      textAlign: "left",
    });
  }

  footerBar(page, p, intent.org, pageIndex, total, intent.docTypeLabel);
}

export function buildKpiDashboard(page: Page, intent: PromptAnalysis, pageIndex: number, total: number) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;

  runningHead(page, p, "مؤشرات الأداء ومقاييس الإنجاز", intent.org);

  let y = 24;

  write(page, "عنوان لوحة المؤشرات", "لوحة قياس الأداء والنتائج التشغيلية", m, y, w - m * 2, 10, {
    fontFamily: "Tajawal",
    fontSize: 16,
    fontWeight: 800,
    color: p.field,
  });
  y += 12;

  // Description
  write(page, "وصف المؤشرات", "رصد دوري لمؤشرات الأداء الرئيسية ومقارنتها بالمستهدفات المقررة لقياس أثر التنفيذ.", m, y, w - m * 2, 8, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 9,
    fontWeight: 500,
    color: p.muted,
  });
  y += 12;

  // 4 KPI Cards in a 2x2 grid (or 1x4 if slide)
  const isLandscape = w > h;
  const cols = isLandscape ? 4 : 2;
  const gap = 4;
  const totalW = w - m * 2;
  const cardW = (totalW - gap * (cols - 1)) / cols;
  const cardH = 34;

  const metrics = intent.keyMetrics.slice(0, 4);
  metrics.forEach((metric, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cardX = m + col * (cardW + gap);
    const cardY = y + row * (cardH + gap);

    put(page, "shape", {
      name: `بطاقة مؤشر ${index + 1}`,
      x: cardX,
      y: cardY,
      w: cardW,
      h: cardH,
      style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 3 },
    });

    // Top subtle color strip
    put(page, "shape", {
      name: `شريط مؤشر ${index + 1}`,
      x: cardX,
      y: cardY,
      w: cardW,
      h: 2.5,
      style: { fill: index % 2 === 0 ? p.field : p.accent, borderWidth: 0, radius: 2 },
    });

    // Metric Value
    write(page, `قيمة مؤشر ${index + 1}`, metric.value, cardX + 4, cardY + 5, cardW - 8, 14, {
      fontFamily: "Tajawal",
      fontSize: 18,
      fontWeight: 800,
      color: p.field,
      lineHeight: 1.1,
    });

    // Metric Label
    write(page, `تسمية مؤشر ${index + 1}`, metric.label, cardX + 4, cardY + 20, cardW - 8, 6, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 7.5,
      fontWeight: 600,
      color: p.ink,
      lineHeight: 1.1,
    });

    // Trend tag
    if (metric.trend) {
      write(page, `اتجاه مؤشر ${index + 1}`, metric.trend, cardX + 4, cardY + 26, cardW - 8, 5, {
        fontFamily: "IBM Plex Sans Arabic",
        fontSize: 6.5,
        fontWeight: 600,
        color: p.accent,
        lineHeight: 1.1,
      });
    }
  });

  const cardsRows = Math.ceil(metrics.length / cols);
  y += cardsRows * (cardH + gap) + 12;

  // Analysis / Insight block below KPI cards
  const insightH = Math.min(60, h - y - 30);
  if (insightH > 24) {
    put(page, "shape", {
      name: "إطار التحليل البياني",
      x: m,
      y,
      w: w - m * 2,
      h: insightH,
      style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 3 },
    });

    write(page, "عنوان التحليل", "التحليل الاستراتيجي لنتائج المؤشرات", m + 6, y + 4, w - m * 2 - 12, 7, {
      fontFamily: "Tajawal",
      fontSize: 11,
      fontWeight: 700,
      color: p.field,
    });

    const analysisText = "[أضف تحليلًا موثقًا للبيانات أو المؤشرات]";

    write(page, "متن التحليل", analysisText, m + 6, y + 13, w - m * 2 - 12, insightH - 16, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 9,
      fontWeight: 500,
      color: p.ink,
      lineHeight: 1.6,
    });
  }

  footerBar(page, p, intent.org, pageIndex, total, intent.docTypeLabel);
}

export function buildDataMatrix(page: Page, intent: PromptAnalysis, pageIndex: number, total: number) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;

  runningHead(page, p, "مصفوفة البيانات والتحليل التفصيلي", intent.org);

  let y = 24;

  write(page, "عنوان مصفوفة البيانات", "المصفوفة التفصيلية لمجالات العمل والمخرجات", m, y, w - m * 2, 10, {
    fontFamily: "Tajawal",
    fontSize: 16,
    fontWeight: 800,
    color: p.field,
  });
  y += 12;

  write(page, "مقدمة الجدول", "[أضف وصفًا موثقًا للبيانات أو نطاق الجدول]", m, y, w - m * 2, 8, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 9,
    fontWeight: 500,
    color: p.muted,
  });
  y += 12;

  // Table element
  const t = intent.tableData;
  const tableContent = [t.headers, ...t.rows].map((row) => row.join("\t")).join("\n");
  const tableH = Math.min(75, h - y - 48);

  put(page, "table", {
    name: "جدول البيانات الرسمي",
    x: m,
    y,
    w: w - m * 2,
    h: tableH,
    content: tableContent,
    style: {
      cols: t.headers.length,
      rows: t.rows.length + 1,
      headerBg: p.field,
      headerColor: p.onField,
      tableBg: "#ffffff",
      stripeBg: "#f8fafc",
      borderColor: "#cbd5e1",
      borderWidth: 0.4,
      color: p.ink,
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 9,
      cellAlign: "right",
    },
  });

  y += tableH + 12;

  // Observations Card below table
  if (h - y > 35) {
    const obsH = Math.min(32, h - y - 20);
    put(page, "shape", {
      name: "بطاقة ملاحظات الجدول",
      x: m,
      y,
      w: w - m * 2,
      h: obsH,
      style: { fill: p.paper, borderColor: p.accent, borderWidth: 0.5, radius: 3 },
    });

    write(page, "عنوان الملاحظات", "ملاحظات الحوكمة والتدقيق:", m + 6, y + 4, w - m * 2 - 12, 6, {
      fontFamily: "Tajawal",
      fontSize: 9.5,
      fontWeight: 700,
      color: p.field,
    });

    write(
      page,
      "نص الملاحظات",
      "[أضف ملاحظات التحقق أو مصدر البيانات بعد المراجعة]",
      m + 6,
      y + 11,
      w - m * 2 - 12,
      obsH - 14,
      {
        fontFamily: "Noto Naskh Arabic",
        fontSize: 8.5,
        fontWeight: 500,
        color: p.ink,
        lineHeight: 1.4,
      },
    );
  }

  footerBar(page, p, intent.org, pageIndex, total, intent.docTypeLabel);
}

export function buildFrameworkPage(page: Page, intent: PromptAnalysis, pageIndex: number, total: number) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;

  runningHead(page, p, "المحاور الاستراتيجية ومسارات التطوير", intent.org);

  let y = 24;

  write(page, "عنوان المحاور", "محاور الإطار الاستراتيجي والبرامج المعتمدة", m, y, w - m * 2, 10, {
    fontFamily: "Tajawal",
    fontSize: 16,
    fontWeight: 800,
    color: p.field,
  });
  y += 12;

  write(page, "مقدمة المحاور", "[أضف مقدمة موثقة للمحاور والبرامج]", m, y, w - m * 2, 8, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 9,
    fontWeight: 500,
    color: p.muted,
  });
  y += 12;

  // 3 Vertical Pillar Cards
  const pillars = intent.frameworkPillars.slice(0, 3);
  const cardW = (w - m * 2 - 8) / 3;
  const cardH = Math.min(130, h - y - 36);

  pillars.forEach((pillar, i) => {
    const cardX = m + i * (cardW + 4);

    put(page, "shape", {
      name: `بطاقة محور ${i + 1}`,
      x: cardX,
      y,
      w: cardW,
      h: cardH,
      style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 4 },
    });

    // Top field ribbon
    put(page, "shape", {
      name: `شريط محور ${i + 1}`,
      x: cardX,
      y,
      w: cardW,
      h: 5,
      style: { fill: i === 1 ? p.accent : p.field, borderWidth: 0, radius: 2 },
    });

    // Pillar Number
    write(page, `رقم محور ${i + 1}`, `المحور ٠${i + 1}`, cardX + 4, y + 8, cardW - 8, 7, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 8.5,
      fontWeight: 700,
      color: p.accent,
    });

    // Pillar Title
    write(page, `عنوان محور ${i + 1}`, pillar.title, cardX + 4, y + 17, cardW - 8, 14, {
      fontFamily: "Tajawal",
      fontSize: 12,
      fontWeight: 800,
      color: p.field,
      lineHeight: 1.2,
    });

    // Divider line
    put(page, "line", {
      name: `فاصل محور ${i + 1}`,
      x: cardX + 4,
      y: y + 33,
      w: cardW - 8,
      h: 0.4,
      style: { color: "#e2e8f0", stroke: 0.4 },
    });

    // Pillar Description
    write(page, `وصف محور ${i + 1}`, pillar.desc, cardX + 4, y + 36, cardW - 8, cardH - 42, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 9,
      fontWeight: 500,
      color: p.ink,
      lineHeight: 1.5,
    });
  });

  footerBar(page, p, intent.org, pageIndex, total, intent.docTypeLabel);
}

/**
 * «شبكة غير متماثلة» (asymmetric-editorial) — a 7/5 grid: a wide prose column
 * on the right (RTL start) and a narrow sidebar of stat + callout + image on
 * the left. Breaks the stacked full-width rhythm of the summary page.
 */
export function buildAsymmetricStory(page: Page, intent: PromptAnalysis, pageIndex: number, total: number) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;
  const scale = presetForDesignStyle(intent.style).typographyScale;

  runningHead(page, p, "المحتوى التحليلي", intent.org);

  const contentW = w - m * 2;
  const gap = 6;
  const mainW = Math.round(contentW * 0.62);
  const sideW = contentW - mainW - gap;
  const mainX = w - m - mainW; // RTL: the reading column starts on the right
  const sideX = m;

  // ── Main column (right): heading, prose, takeaway rows ──────────────────
  write(page, "عنوان القسم", "[عنوان القسم من المصدر]", mainX, 24, mainW, 10, {
    fontFamily: "Tajawal",
    fontSize: scale.h1,
    fontWeight: 800,
    color: p.field,
  });
  put(page, "line", {
    name: "خيط القسم",
    x: mainX + mainW - 42,
    y: 38,
    w: 42,
    h: 0.5,
    style: { color: p.accent, stroke: 0.5 },
  });
  write(page, "متن القسم", "[أضف متنًا موثقًا من المحتوى أو المصدر المعتمد]", mainX, 44, mainW, 44, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: scale.body,
    fontWeight: 500,
    color: p.ink,
    lineHeight: 1.7,
  });

  intent.summaryTakeaways.slice(0, 2).forEach((item, index) => {
    const rowY = 96 + index * 20;
    put(page, "shape", {
      name: `بطاقة مقتطف ${index + 1}`,
      x: mainX,
      y: rowY,
      w: mainW,
      h: 16,
      style: { fill: "#ffffff", borderColor: "#edf2f7", borderWidth: 0.4, radius: 3 },
    });
    put(page, "shape", {
      name: `معين مقتطف ${index + 1}`,
      x: mainX + mainW - 8,
      y: rowY + 6,
      w: 4,
      h: 4,
      style: { fill: p.accent, borderWidth: 0, radius: 0, shape: "rect", shapeId: "diamond" },
    });
    write(page, `نص مقتطف ${index + 1}`, item, mainX + 6, rowY + 4.5, mainW - 18, 8, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 9,
      fontWeight: 600,
      color: p.ink,
      lineHeight: 1.4,
    });
  });

  // ── Sidebar (left): stat card, summary callout, image plate ─────────────
  const statH = 36;
  put(page, "shape", {
    name: "بطاقة مؤشر جانبية",
    x: sideX,
    y: 24,
    w: sideW,
    h: statH,
    style: { fill: p.field, borderWidth: 0, radius: 4 },
  });
  write(page, "قيمة المؤشر الجانبي", intent.keyMetrics[0]?.value ?? "[القيمة 1]", sideX + 5, 29, sideW - 10, 12, {
    fontFamily: "Tajawal",
    fontSize: scale.display,
    fontWeight: 800,
    color: p.onField,
    lineHeight: 1.1,
  });
  write(page, "تسمية المؤشر الجانبي", intent.keyMetrics[0]?.label ?? "[اسم المؤشر 1]", sideX + 5, 44, sideW - 10, 6, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 7.5,
    fontWeight: 600,
    color: p.accent,
    lineHeight: 1.1,
  });
  write(page, "اتجاه المؤشر الجانبي", intent.keyMetrics[0]?.trend ?? "", sideX + 5, 51, sideW - 10, 5, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 6.5,
    fontWeight: 600,
    color: p.onField,
    lineHeight: 1.1,
  });

  const calloutY = 24 + statH + 6;
  const calloutH = 48;
  put(page, "shape", {
    name: "إطار المقولة الجانبية",
    x: sideX,
    y: calloutY,
    w: sideW,
    h: calloutH,
    style: { fill: p.paper, borderColor: p.accent, borderWidth: 0.6, radius: 3 },
  });
  write(page, "رمز الاقتباس", "«", sideX + sideW - 10, calloutY + 2, 8, 8, {
    fontFamily: "Tajawal",
    fontSize: 16,
    fontWeight: 800,
    color: p.accent,
    textAlign: "center",
  });
  write(page, "نص المقولة", "[أضف اقتباسًا معتمدًا من المصدر]", sideX + 5, calloutY + 8, sideW - 14, calloutH - 12, {
    fontFamily: "Tajawal",
    fontSize: 9.5,
    fontWeight: 700,
    color: p.field,
    lineHeight: 1.4,
  });

  const imgY = calloutY + calloutH + 6;
  put(page, "image", {
    name: "صورة جانبية",
    x: sideX,
    y: imgY,
    w: sideW,
    h: Math.min(54, h - imgY - 40),
    src: themedArtwork(intent.topic),
    style: { radius: 4, borderColor: "#cbd5e1", borderWidth: 0.5, objectFit: "cover" },
  });

  // ── Full-width summary callout band ─────────────────────────────────────
  const bandY = 180;
  const bandH = 30;
  put(page, "shape", {
    name: "بطاقة المقتطف الختامي",
    x: m,
    y: bandY,
    w: contentW,
    h: bandH,
    style: { fill: "#ffffff", borderColor: "#e4e9f0", borderWidth: 0.5, radius: 3 },
  });
  put(page, "shape", {
    name: "حد البطاقة الأيمن",
    x: w - m - 3,
    y: bandY,
    w: 3,
    h: bandH,
    style: { fill: p.accent, borderWidth: 0, radius: 2 },
  });
  write(page, "عنوان المقتطف", "مقتطف", m + 6, bandY + 4, 60, 6, {
    fontFamily: "Tajawal",
    fontSize: 9.5,
    fontWeight: 800,
    color: p.field,
  });
  write(page, "نص المقتطف", "[أضف ملخصًا ختاميًا موثقًا من المصدر]", m + 6, bandY + 12, 158, 14, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 9,
    fontWeight: 500,
    color: p.ink,
    lineHeight: 1.5,
  });

  footerBar(page, p, intent.org, pageIndex, total, intent.docTypeLabel);
}

/**
 * «مقتطفات ومساحات بيضاء» (summary-callout) — an airy page: one display
 * pull-quote, two callout cards, and deliberate empty space. The visual rest
 * between the dense data pages.
 */
export function buildSummaryCallout(page: Page, intent: PromptAnalysis, pageIndex: number, total: number) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;
  const scale = presetForDesignStyle(intent.style).typographyScale;
  const contentW = w - m * 2;

  runningHead(page, p, "مقتطفات وملاحظات ختامية", intent.org);

  // Display pull-quote
  write(page, "المقولة", "[أضف مقولة أو اقتباسًا معتمدًا من المصدر]", m, 44, contentW, 30, {
    fontFamily: "Tajawal",
    fontSize: scale.display,
    fontWeight: 800,
    color: p.field,
    lineHeight: 1.25,
  });
  put(page, "shape", {
    name: "معين زخرفي",
    x: w - m - 10,
    y: 36,
    w: 8,
    h: 8,
    style: { fill: p.accent, borderWidth: 0, radius: 0, shape: "rect", shapeId: "diamond" },
  });
  put(page, "line", {
    name: "خيط الإيقاع البصري",
    x: m,
    y: 80,
    w: 60,
    h: 0.5,
    style: { color: p.accent, stroke: 0.5 },
  });

  // Two summary callout cards in a balanced 2-column grid
  const cardY = 96;
  const cardH = 44;
  const cardW = (contentW - 6) / 2;
  intent.summaryTakeaways.slice(0, 2).forEach((item, index) => {
    const cardX = index === 0 ? m : m + cardW + 6;
    put(page, "shape", {
      name: `بطاقة مقتطف ${index + 1}`,
      x: cardX,
      y: cardY,
      w: cardW,
      h: cardH,
      style: { fill: p.paper, borderColor: p.accent, borderWidth: 0.6, radius: 3 },
    });
    write(page, `عنوان مقتطف ${index + 1}`, index === 0 ? "مقتطف أول" : "مقتطف ثانٍ", cardX + 5, cardY + 5, cardW - 10, 6, {
      fontFamily: "Tajawal",
      fontSize: 9.5,
      fontWeight: 800,
      color: p.field,
    });
    write(page, `نص مقتطف ${index + 1}`, item, cardX + 5, cardY + 14, cardW - 10, cardH - 20, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 9,
      fontWeight: 500,
      color: p.ink,
      lineHeight: 1.5,
    });
  });

  // Deliberate whitespace, then one quiet meta line above the footer
  write(page, "مصدر الاقتباس", "[مصدر الاقتباس يحدده المالك]", m, h - 42, contentW, 6, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 8,
    fontWeight: 600,
    color: p.muted,
  });

  footerBar(page, p, intent.org, pageIndex, total, intent.docTypeLabel);
}

export function buildClosingEndorsement(page: Page, intent: PromptAnalysis, pageIndex: number, total: number) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;

  runningHead(page, p, "التوصيات الختامية والتوقيع", intent.org);

  let y = 24;

  write(page, "عنوان الخاتمة", "التوصيات الختامية وخطة التحسين المستمر", m, y, w - m * 2, 10, {
    fontFamily: "Tajawal",
    fontSize: 16,
    fontWeight: 800,
    color: p.field,
  });
  y += 12;

  // 3 Recommendations
  intent.recommendations.forEach((rec, idx) => {
    const recH = 16;
    put(page, "shape", {
      name: `بطاقة توصية ${idx + 1}`,
      x: m,
      y,
      w: w - m * 2,
      h: recH,
      style: { fill: "#ffffff", borderColor: "#e4e9f0", borderWidth: 0.5, radius: 3 },
    });

    put(page, "shape", {
      name: `رقم توصية ${idx + 1}`,
      x: w - m - 12,
      y: y + 4,
      w: 8,
      h: 8,
      style: { fill: p.accent, borderWidth: 0, radius: 99, shape: "circle" },
    });

    write(page, `رقم نص ${idx + 1}`, String(idx + 1), w - m - 12, y + 4.8, 8, 8, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 6.5,
      fontWeight: 800,
      color: p.field,
      textAlign: "center",
    });

    write(page, `نص توصية ${idx + 1}`, rec, m + 6, y + 3.5, w - m * 2 - 22, recH - 6, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 9,
      fontWeight: 600,
      color: p.ink,
      lineHeight: 1.4,
    });
    y += recH + 5;
  });

  y += 10;

  // Official Endorsement and Stamp section
  const certH = Math.min(80, h - y - 25);
  put(page, "shape", {
    name: "إطار التوقيع",
    x: m,
    y,
    w: w - m * 2,
    h: certH,
    style: { fill: "#fbfcfd", borderColor: p.accent, borderWidth: 0.8, radius: 4 },
  });

  write(page, "عنوان الاعتماد", placeholder("عنوان قسم الاعتماد"), m + 6, y + 6, w - m * 2 - 12, 8, {
    fontFamily: "Tajawal",
    fontSize: 13,
    fontWeight: 800,
    color: p.field,
  });

  write(
    page,
    "صيغة الاعتماد",
    "[أضف صيغة الاعتماد بعد التفويض والمراجعة]",
    m + 6,
    y + 16,
    w - m * 2 - 46,
    20,
    {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 9,
      fontWeight: 500,
      color: p.ink,
      lineHeight: 1.5,
    },
  );

  // Official Stamp Element
  put(page, "stamp", {
    name: "ختم التوقيع",
    content: placeholder("نص الختم"),
    x: w - m - 42,
    y: y + 20,
    w: 32,
    h: 32,
    rotation: -12,
    style: {
      color: p.accent,
      borderColor: p.accent,
      borderWidth: 0.8,
      fontSize: 8.5,
      fontWeight: 800,
      fontFamily: "Amiri",
    },
  });

  // Two signature lines
  const sigY = y + certH - 24;
  write(page, "توقيع رئيس اللجنة", `${placeholder("صفة الموقّع الأول")}\n____________________`, m + 10, sigY, (w - m * 2) / 2 - 20, 14, {
    fontFamily: "Tajawal",
    fontSize: 9,
    fontWeight: 700,
    color: p.field,
    textAlign: "center",
    lineHeight: 1.6,
  });

  write(page, "توقيع الأمين العام", `${placeholder("صفة الموقّع الثاني")}\n____________________`, m + (w - m * 2) / 2 + 10, sigY, (w - m * 2) / 2 - 45, 14, {
    fontFamily: "Tajawal",
    fontSize: 9,
    fontWeight: 700,
    color: p.field,
    textAlign: "center",
    lineHeight: 1.6,
  });

  footerBar(page, p, intent.org, pageIndex, total, intent.docTypeLabel);
}

// -------------------------------------------------------------
// Presentation Slides (16:9 Landscape)
// -------------------------------------------------------------

export function buildSlideCover(page: Page, intent: PromptAnalysis) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;

  // Split slide: Right 42% field, left paper with artwork
  const splitW = Math.round(w * 0.44);

  put(page, "shape", {
    name: "حقل الشريحة الأيمن",
    x: w - splitW,
    y: 0,
    w: splitW,
    h,
    style: { fill: p.field, borderWidth: 0, radius: 0, shape: "rect" },
  });

  put(page, "line", {
    name: "خيط الشريحة الفاصل",
    x: w - splitW,
    y: 0,
    w: 1.2,
    h,
    style: { color: p.accent, stroke: 1.2 },
  });

  // In the right dark field: Org, Title, Subtitle
  write(page, "جهة العرض", intent.org, w - splitW + 14, 28, splitW - 28, 8, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 10,
    fontWeight: 700,
    color: p.accent,
  });

  write(page, "العنوان", intent.title, w - splitW + 14, 42, splitW - 28, 48, {
    fontFamily: "Tajawal",
    fontSize: 26,
    fontWeight: 800,
    color: p.onField,
    lineHeight: 1.15,
  });

  write(page, "المقدمة", intent.subtitle, w - splitW + 14, 98, splitW - 28, 32, {
    fontFamily: "Noto Naskh Arabic",
    fontSize: 12,
    fontWeight: 500,
    color: p.onField,
    lineHeight: 1.5,
  });

  write(page, "تاريخ الشريحة", intent.dateString, w - splitW + 14, h - 24, splitW - 28, 8, {
    fontFamily: "IBM Plex Sans Arabic",
    fontSize: 8.5,
    fontWeight: 600,
    color: p.accent,
  });

  // In the left lighter area: Artwork plate + stats
  const imgW = w - splitW - m * 2;
  const imgH = h - 40;
  put(page, "image", {
    name: "صورة شريحة الغلاف",
    x: m,
    y: 20,
    w: imgW,
    h: imgH,
    src: themedArtwork(intent.topic),
    style: { radius: 4, borderWidth: 0.5, borderColor: "#cbd5e1", objectFit: "cover" },
  });
}

export function buildSlideContent(
  page: Page,
  intent: PromptAnalysis,
  slideType: "agenda" | "kpis" | "pillars" | "matrix" | "closing" | "asymmetric" | "callout",
  index: number,
  total: number,
) {
  const { w, h } = pageSize(page);
  const m = marginOf(w);
  const p = intent.palette;

  // Running head for slide
  runningHead(page, p, intent.title, intent.org);

  let y = 24;

  if (slideType === "agenda") {
    write(page, "عنوان شريحة الأجندة", "المحاور الرئيسية لجدول الأعمال", m, y, w - m * 2, 12, {
      fontFamily: "Tajawal",
      fontSize: 20,
      fontWeight: 800,
      color: p.field,
    });
    y += 18;

    const agendaItems = Array.from({ length: 4 }, (_, index) => ({
      num: `٠${index + 1}`,
      title: `[عنوان المحور ${index + 1}]`,
      desc: `[أضف وصفًا موثقًا للمحور ${index + 1}]`,
    }));

    const cardW = (w - m * 2 - 12) / 4;
    const cardH = h - y - 30;

    agendaItems.forEach((item, i) => {
      const cardX = m + i * (cardW + 4);
      put(page, "shape", {
        name: `بطاقة أجندة ${i + 1}`,
        x: cardX,
        y,
        w: cardW,
        h: cardH,
        style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 4 },
      });

      put(page, "shape", {
        name: `شريط أجندة ${i + 1}`,
        x: cardX,
        y,
        w: cardW,
        h: 4,
        style: { fill: i === 0 ? p.accent : p.field, borderWidth: 0, radius: 2 },
      });

      write(page, `رقم أجندة ${i + 1}`, item.num, cardX + 6, y + 8, cardW - 12, 12, {
        fontFamily: "Tajawal",
        fontSize: 16,
        fontWeight: 800,
        color: p.accent,
      });

      write(page, `عنوان أجندة ${i + 1}`, item.title, cardX + 6, y + 24, cardW - 12, 22, {
        fontFamily: "Tajawal",
        fontSize: 12,
        fontWeight: 800,
        color: p.field,
        lineHeight: 1.25,
      });

      write(page, `وصف أجندة ${i + 1}`, item.desc, cardX + 6, y + 50, cardW - 12, cardH - 58, {
        fontFamily: "Noto Naskh Arabic",
        fontSize: 9.5,
        fontWeight: 500,
        color: p.ink,
        lineHeight: 1.5,
      });
    });
  } else if (slideType === "kpis") {
    write(page, "عنوان شريحة المؤشرات", "المؤشرات القيادية ومقاييس الإنجاز المحققة", m, y, w - m * 2, 12, {
      fontFamily: "Tajawal",
      fontSize: 20,
      fontWeight: 800,
      color: p.field,
    });
    y += 18;

    const cardW = (w - m * 2 - 12) / 4;
    const cardH = 50;

    intent.keyMetrics.slice(0, 4).forEach((metric, i) => {
      const cardX = m + i * (cardW + 4);
      put(page, "shape", {
        name: `بطاقة شريحة مؤشر ${i + 1}`,
        x: cardX,
        y,
        w: cardW,
        h: cardH,
        style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.6, radius: 4 },
      });

      write(page, `قيمة شريحة مؤشر ${i + 1}`, metric.value, cardX + 6, y + 6, cardW - 12, 18, {
        fontFamily: "Tajawal",
        fontSize: 22,
        fontWeight: 800,
        color: p.field,
      });

      write(page, `تسمية شريحة مؤشر ${i + 1}`, metric.label, cardX + 6, y + 26, cardW - 12, 10, {
        fontFamily: "IBM Plex Sans Arabic",
        fontSize: 9,
        fontWeight: 700,
        color: p.ink,
      });

      if (metric.trend) {
        write(page, `اتجاه شريحة مؤشر ${i + 1}`, metric.trend, cardX + 6, y + 38, cardW - 12, 8, {
          fontFamily: "IBM Plex Sans Arabic",
          fontSize: 7.5,
          fontWeight: 600,
          color: p.accent,
        });
      }
    });

    y += cardH + 12;

    // Insight card below
    const insightH = h - y - 26;
    put(page, "shape", {
      name: "إطار تحليل الشريحة",
      x: m,
      y,
      w: w - m * 2,
      h: insightH,
      style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 4 },
    });

    write(page, "نص تحليل الشريحة", "[أضف تحليلًا موثقًا للبيانات والقرارات المقترحة]", m + 10, y + 10, w - m * 2 - 20, insightH - 20, {
      fontFamily: "Noto Naskh Arabic",
      fontSize: 11,
      fontWeight: 500,
      color: p.ink,
      lineHeight: 1.7,
    });
  } else if (slideType === "pillars") {
    write(page, "عنوان شريحة الركائز", "[عنوان المحاور والبرامج من المصدر]", m, y, w - m * 2, 12, {
      fontFamily: "Tajawal",
      fontSize: 20,
      fontWeight: 800,
      color: p.field,
    });
    y += 18;

    const cardW = (w - m * 2 - 8) / 3;
    const cardH = h - y - 30;

    intent.frameworkPillars.slice(0, 3).forEach((pillar, i) => {
      const cardX = m + i * (cardW + 4);
      put(page, "shape", {
        name: `بطاقة شريحة ركيزة ${i + 1}`,
        x: cardX,
        y,
        w: cardW,
        h: cardH,
        style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 4 },
      });

      put(page, "shape", {
        name: `شريط شريحة ركيزة ${i + 1}`,
        x: cardX,
        y,
        w: cardW,
        h: 4,
        style: { fill: i === 1 ? p.accent : p.field, borderWidth: 0, radius: 2 },
      });

      write(page, `عنوان شريحة ركيزة ${i + 1}`, pillar.title, cardX + 8, y + 12, cardW - 16, 20, {
        fontFamily: "Tajawal",
        fontSize: 14,
        fontWeight: 800,
        color: p.field,
      });

      write(page, `وصف شريحة ركيزة ${i + 1}`, pillar.desc, cardX + 8, y + 36, cardW - 16, cardH - 46, {
        fontFamily: "Noto Naskh Arabic",
        fontSize: 10,
        fontWeight: 500,
        color: p.ink,
        lineHeight: 1.6,
      });
    });
  } else if (slideType === "matrix") {
    write(page, "عنوان شريحة البيانات", "مصفوفة المتابعة ومستوى الإنجاز التشغيلي", m, y, w - m * 2, 12, {
      fontFamily: "Tajawal",
      fontSize: 20,
      fontWeight: 800,
      color: p.field,
    });
    y += 16;

    const t = intent.tableData;
    const tableContent = [t.headers, ...t.rows].map((row) => row.join("\t")).join("\n");
    const tableH = h - y - 30;

    put(page, "table", {
      name: "جدول بيانات الشريحة",
      x: m,
      y,
      w: w - m * 2,
      h: tableH,
      content: tableContent,
      style: {
        cols: t.headers.length,
        rows: t.rows.length + 1,
        headerBg: p.field,
        headerColor: p.onField,
        tableBg: "#ffffff",
        stripeBg: "#f8fafc",
        borderColor: "#cbd5e1",
        borderWidth: 0.4,
        color: p.ink,
        fontFamily: "IBM Plex Sans Arabic",
        fontSize: 10,
        cellAlign: "right",
      },
    });
  } else if (slideType === "asymmetric") {
    // Asymmetric slide: wide content column on the right, stat sidebar on the left
    write(page, "عنوان شريحة المحتوى", "[عنوان المحتوى من المصدر]", m, y, w - m * 2, 12, {
      fontFamily: "Tajawal",
      fontSize: 20,
      fontWeight: 800,
      color: p.field,
    });
    y += 18;

    const contentW = w - m * 2;
    const mainW = Math.round(contentW * 0.58);
    const sideW = contentW - mainW - 6;
    const mainX = w - m - mainW;
    const sideX = m;

    intent.summaryTakeaways.slice(0, 3).forEach((item, i) => {
      const rowY = y + i * 20;
      put(page, "shape", {
        name: `دائرة رقم ${i + 1}`,
        x: mainX + mainW - 10,
        y: rowY + 1,
        w: 8,
        h: 8,
        style: { fill: p.accent, borderWidth: 0, radius: 99, shape: "circle" },
      });
      write(page, `رقم ${i + 1}`, String(i + 1), mainX + mainW - 10, rowY + 1.8, 8, 8, {
        fontFamily: "IBM Plex Sans Arabic",
        fontSize: 6.5,
        fontWeight: 800,
        color: p.field,
        textAlign: "center",
      });
      write(page, `نص ${i + 1}`, item, mainX, rowY + 2, mainW - 18, 12, {
        fontFamily: "Noto Naskh Arabic",
        fontSize: 10,
        fontWeight: 600,
        color: p.ink,
        lineHeight: 1.4,
      });
    });

    put(page, "shape", {
      name: "بطاقة مؤشر الشريط الجانبي",
      x: sideX,
      y,
      w: sideW,
      h: 40,
      style: { fill: p.field, borderWidth: 0, radius: 4 },
    });
    write(page, "قيمة مؤشر الشريط", intent.keyMetrics[0]?.value ?? "[القيمة 1]", sideX + 6, y + 5, sideW - 12, 16, {
      fontFamily: "Tajawal",
      fontSize: 22,
      fontWeight: 800,
      color: p.onField,
    });
    write(page, "تسمية مؤشر الشريط", intent.keyMetrics[0]?.label ?? "[اسم المؤشر 1]", sideX + 6, y + 24, sideW - 12, 8, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 8.5,
      fontWeight: 600,
      color: p.accent,
    });
    write(page, "اتجاه مؤشر الشريط", intent.keyMetrics[0]?.trend ?? "", sideX + 6, y + 32, sideW - 12, 6, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 7,
      fontWeight: 600,
      color: p.onField,
    });

    put(page, "shape", {
      name: "إطار مقولة الشريط",
      x: sideX,
      y: y + 46,
      w: sideW,
      h: Math.max(30, h - (y + 46) - 30),
      style: { fill: p.paper, borderColor: p.accent, borderWidth: 0.6, radius: 3 },
    });
    write(page, "نص مقولة الشريط", "[أضف اقتباسًا معتمدًا من المصدر]", sideX + 6, y + 52, sideW - 12, Math.max(20, h - (y + 52) - 36), {
      fontFamily: "Tajawal",
      fontSize: 10,
      fontWeight: 700,
      color: p.field,
      lineHeight: 1.4,
    });
  } else if (slideType === "callout") {
    // Airy callout slide: one display quote, attribution, two chips
    write(page, "المقولة", "[أضف مقولة أو اقتباسًا معتمدًا من المصدر]", m, y + 8, w - m * 2, 36, {
      fontFamily: "Tajawal",
      fontSize: 24,
      fontWeight: 800,
      color: p.field,
      lineHeight: 1.25,
    });
    put(page, "shape", {
      name: "معين زخرفي",
      x: w - m - 10,
      y: y,
      w: 8,
      h: 8,
      style: { fill: p.accent, borderWidth: 0, radius: 0, shape: "rect", shapeId: "diamond" },
    });
    write(page, "مصدر الاقتباس", "[مصدر الاقتباس يحدده المالك]", m, y + 52, w - m * 2, 8, {
      fontFamily: "IBM Plex Sans Arabic",
      fontSize: 9,
      fontWeight: 600,
      color: p.muted,
    });

    const chipY = y + 70;
    [0, 1].forEach((i) => {
      const label = `[عنوان المحور ${i + 1}]`;
      const chipW = 70;
      const chipX = i === 0 ? m : m + chipW + 6;
      put(page, "shape", {
        name: `شريحة ${i + 1}`,
        x: chipX,
        y: chipY,
        w: chipW,
        h: 10,
        style: { fill: p.paper, borderColor: p.accent, borderWidth: 0.5, radius: 5 },
      });
      write(page, `نص شريحة ${i + 1}`, label, chipX + 4, chipY + 2, chipW - 8, 6, {
        fontFamily: "IBM Plex Sans Arabic",
        fontSize: 8,
        fontWeight: 700,
        color: p.field,
        textAlign: "center",
      });
    });
  } else {
    // Closing slide
    write(page, "عنوان شريحة القرارات", "القرارات المطلوبة والخطوات القادمة", m, y, w - m * 2, 12, {
      fontFamily: "Tajawal",
      fontSize: 20,
      fontWeight: 800,
      color: p.field,
    });
    y += 18;

    const cardH = (h - y - 36) / 3;
    intent.recommendations.forEach((rec, idx) => {
      const cardY = y + idx * (cardH + 4);
      put(page, "shape", {
        name: `بطاقة قرار ${idx + 1}`,
        x: m,
        y: cardY,
        w: w - m * 2,
        h: cardH,
        style: { fill: "#ffffff", borderColor: "#e2e8f0", borderWidth: 0.5, radius: 4 },
      });

      write(page, `رقم قرار ${idx + 1}`, `القرار ${idx + 1}`, w - m - 32, cardY + 6, 28, 8, {
        fontFamily: "IBM Plex Sans Arabic",
        fontSize: 9,
        fontWeight: 700,
        color: p.accent,
      });

      write(page, `نص قرار ${idx + 1}`, rec, m + 8, cardY + 6, w - m * 2 - 46, cardH - 12, {
        fontFamily: "Noto Naskh Arabic",
        fontSize: 11,
        fontWeight: 600,
        color: p.ink,
        lineHeight: 1.5,
      });
    });
  }

  footerBar(page, p, intent.org, index, total, intent.docTypeLabel);
}

// -------------------------------------------------------------
// Main Generator Entrypoint
// -------------------------------------------------------------

type PageBuilder = (page: Page, intent: PromptAnalysis, pageIndex: number, total: number) => void;

/**
 * Pattern → builder, per orientation. Every pattern maps to a REAL builder of
 * editable elements — the anti-monotony guarantee lives in the plan, the
 * builders only draw.
 */
const PORTRAIT_BUILDERS: Record<LayoutPatternId, PageBuilder> = {
  "hero-cover": (page, intent) => buildOfficialCover(page, intent),
  "executive-summary": buildExecutiveOverview,
  "asymmetric-editorial": buildAsymmetricStory,
  "multi-column-cards": buildFrameworkPage,
  "stat-cards": buildKpiDashboard,
  "table-matrix": buildDataMatrix,
  "summary-callout": buildSummaryCallout,
  "closing-endorsement": buildClosingEndorsement,
};

const SLIDE_BUILDERS: Record<LayoutPatternId, PageBuilder> = {
  "hero-cover": (page, intent) => buildSlideCover(page, intent),
  "executive-summary": (page, intent, i, t) => buildSlideContent(page, intent, "agenda", i, t),
  "asymmetric-editorial": (page, intent, i, t) => buildSlideContent(page, intent, "asymmetric", i, t),
  "multi-column-cards": (page, intent, i, t) => buildSlideContent(page, intent, "pillars", i, t),
  "stat-cards": (page, intent, i, t) => buildSlideContent(page, intent, "kpis", i, t),
  "table-matrix": (page, intent, i, t) => buildSlideContent(page, intent, "matrix", i, t),
  "summary-callout": (page, intent, i, t) => buildSlideContent(page, intent, "callout", i, t),
  "closing-endorsement": (page, intent, i, t) => buildSlideContent(page, intent, "closing", i, t),
};

/**
 * THE entrypoint. Anti-Monotony & Dynamic Layout Rules, enforced:
 *
 *   1. planPageLayouts assigns one pattern per page — page 1 is a hero cover,
 *      no two consecutive pages share a pattern, long documents end with a
 *      closing endorsement. Provider directives (from the AI design brief)
 *      are honored only when they obey the same rule.
 *   2. Every page is stamped with per-element layout metadata (positioning,
 *      visual hierarchy, accent cards, summary callouts) and painted with the
 *      style preset's radius/shadow elevation.
 *   3. The Layout Variety Check runs over the finished project; if two
 *      consecutive pages still share a structure, the later page is rebuilt
 *      with a secondary pattern AUTOMATICALLY.
 */
export function generateFromIntent(intent: PromptAnalysis): Project {
  const p = intent.palette;
  const isSlide = intent.format === "wide-slide";
  const pagesCount = intent.pages;
  const preset = presetForDesignStyle(intent.style);
  const builders = isSlide ? SLIDE_BUILDERS : PORTRAIT_BUILDERS;

  const plan = planPageLayouts({
    pages: pagesCount,
    format: intent.format,
    mode: intent.generationMode,
    density: intent.contentDensity,
    style: intent.style,
    styleBias: preset.layoutBias,
    directives: intent.pageLayouts,
  });

  const buildPage = (index: number, directive: PageLayoutDirective): Page => {
    const page = sheet(
      index === 0 ? "الغلاف" : `صفحة ${index + 1}`,
      intent.dimensions.w,
      intent.dimensions.h,
      p.paper,
    );
    builders[directive.pattern](page, intent, index + 1, pagesCount);
    if (index > 0) premiumOrnament(page, intent, index);
    stampLayoutMeta(page, directive.pattern);
    applyStylePreset(page, preset);
    return page;
  };

  const pages: Page[] = [];
  for (let i = 0; i < pagesCount; i++) {
    pages.push(buildPage(i, plan[i] ?? directiveForPattern("executive-summary", i + 1)));
  }

  const enforced = enforceLayoutVariety(
    {
      version: 2,
      name: intent.title,
      theme: "official",
      orgName: intent.org,
      defaultSize: sizeIdOf(pages[0]),
      pages,
    },
    { rebuildPage: (pageIndex, directive) => buildPage(pageIndex, directive) },
  );

  return {
    version: 2,
    name: intent.title,
    theme: "official",
    orgName: intent.org,
    defaultSize: sizeIdOf(enforced.project.pages[0]),
    pages: enforced.project.pages,
  };
}
