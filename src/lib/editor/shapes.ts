/**
 * Shape geometry for the `shape` element.
 *
 * Definitions are structured primitives rather than markup so the canvas
 * (React) and the exported HTML (string builder) render the exact same
 * geometry without either one interpolating author-supplied SVG.
 *
 * Every coordinate lives in a 100×100 box; the renderer scales it to the
 * element box with `preserveAspectRatio="none"`, so a shape stretches with
 * its frame the way a rectangle does.
 */

export type ShapePart =
  | { k: "rect"; x: number; y: number; w: number; h: number; rx?: number; ry?: number }
  | { k: "circle"; cx: number; cy: number; r: number }
  | { k: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { k: "poly"; points: string }
  | { k: "path"; d: string };

export interface ShapeDef {
  id: string;
  label: string;
  group: string;
  parts: ShapePart[];
  aspectRatio?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Regular star polygon: alternating outer/inner vertices, first spike at the top. */
function star(spikes: number, innerRatio: number, rotate = -90): ShapePart {
  const rOuter = 50;
  const rInner = rOuter * innerRatio;
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? rInner : rOuter;
    const a = ((rotate + (180 / spikes) * i) * Math.PI) / 180;
    pts.push(`${r2(50 + r * Math.cos(a))},${r2(50 + r * Math.sin(a))}`);
  }
  return { k: "poly", points: pts.join(" ") };
}

/** Regular n-gon inscribed in the 100×100 box, flat-top for even sides. */
function ngon(sides: number, rotate = -90): ShapePart {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((rotate + (360 / sides) * i) * Math.PI) / 180;
    pts.push(`${r2(50 + 50 * Math.cos(a))},${r2(50 + 50 * Math.sin(a))}`);
  }
  return { k: "poly", points: pts.join(" ") };
}

/** Scalloped circle (ختم) — a near-circular star gives the notched seal edge. */
const seal = star(16, 0.9);

const poly = (points: string): ShapePart => ({ k: "poly", points });

export const SHAPE_GROUPS = [
  "أساسية",
  "متعددة الأضلاع",
  "زخرفة إسلامية",
  "أسهم",
  "شارات وفقاعات",
  "إطارات",
] as const;

export const SHAPES: ShapeDef[] = [
  // ── أساسية ─────────────────────────────────────────────────────────────
  {
    id: "rect",
    label: "مستطيل",
    group: "أساسية",
    parts: [{ k: "rect", x: 0, y: 0, w: 100, h: 100 }],
  },
  {
    id: "rounded",
    label: "مستطيل مستدير",
    group: "أساسية",
    parts: [{ k: "rect", x: 0, y: 0, w: 100, h: 100, rx: 14 }],
  },
  {
    id: "circle",
    label: "دائرة",
    group: "أساسية",
    aspectRatio: 1,
    parts: [{ k: "circle", cx: 50, cy: 50, r: 50 }],
  },
  {
    id: "ellipse",
    label: "بيضاوي",
    group: "أساسية",
    aspectRatio: 50 / 32,
    parts: [{ k: "ellipse", cx: 50, cy: 50, rx: 50, ry: 32 }],
  },
  {
    id: "triangle",
    label: "مثلث",
    group: "أساسية",
    parts: [poly("50,2 98,98 2,98")],
  },
  {
    id: "triangle-down",
    label: "مثلث مقلوب",
    group: "أساسية",
    parts: [poly("2,2 98,2 50,98")],
  },
  {
    id: "diamond",
    label: "معيّن",
    group: "أساسية",
    parts: [poly("50,2 98,50 50,98 2,50")],
  },
  {
    id: "parallelogram",
    label: "متوازي أضلاع",
    group: "أساسية",
    parts: [poly("20,2 100,2 80,98 0,98")],
  },
  {
    id: "trapezoid",
    label: "شبه منحرف",
    group: "أساسية",
    parts: [poly("20,2 80,2 100,98 0,98")],
  },

  // ── متعددة الأضلاع ─────────────────────────────────────────────────────
  { id: "pentagon", label: "خماسي", group: "متعددة الأضلاع", parts: [ngon(5)] },
  {
    id: "hexagon",
    label: "سداسي",
    group: "متعددة الأضلاع",
    parts: [ngon(6, 0)],
  },
  {
    id: "octagon",
    label: "ثماني",
    group: "متعددة الأضلاع",
    parts: [ngon(8, 22.5)],
  },
  {
    id: "star5",
    label: "نجمة خماسية",
    group: "متعددة الأضلاع",
    parts: [star(5, 0.44)],
  },
  {
    id: "star6",
    label: "نجمة سداسية",
    group: "متعددة الأضلاع",
    parts: [star(6, 0.577, 30)],
  },
  {
    id: "star12",
    label: "نجمة ١٢",
    group: "متعددة الأضلاع",
    parts: [star(12, 0.62)],
  },
  { id: "seal", label: "ختم مسنّن", group: "متعددة الأضلاع", parts: [seal] },

  // ── زخرفة إسلامية ──────────────────────────────────────────────────────
  {
    id: "rub-el-hizb",
    label: "نجمة ثمانية",
    group: "زخرفة إسلامية",
    // Union of a square and the same square rotated 45° — both filled, so the
    // outline reads as the classic eight-pointed star.
    parts: [
      { k: "rect", x: 18, y: 18, w: 64, h: 64 },
      poly("50,18 82,50 50,82 18,50"),
    ],
  },
  {
    id: "crescent",
    label: "هلال",
    group: "زخرفة إسلامية",
    parts: [{ k: "path", d: "M64 4 A46 46 0 1 0 64 96 A37 37 0 1 1 64 4 Z" }],
  },
  {
    id: "arch",
    label: "قوس محراب",
    group: "زخرفة إسلامية",
    parts: [
      { k: "path", d: "M50 2C24 2 8 24 8 48V100H92V48C92 24 76 2 50 2Z" },
    ],
  },
  {
    id: "arch-frame",
    label: "إطار محراب",
    group: "زخرفة إسلامية",
    parts: [
      {
        k: "path",
        d: "M50 2C24 2 8 24 8 48V98H92V48C92 24 76 2 50 2Z M50 14C31 14 20 30 20 48V86H80V48C80 30 69 14 50 14Z",
      },
    ],
  },
  {
    id: "ornament",
    label: "زخرفة فاصلة",
    group: "زخرفة إسلامية",
    parts: [
      poly("0,50 18,36 36,50 18,64"),
      poly("100,50 82,36 64,50 82,64"),
      { k: "circle", cx: 50, cy: 50, r: 11 },
      poly("50,32 57,43 68,50 57,57 50,68 43,57 32,50 43,43"),
    ],
  },

  // ─ أسهم ───────────────────────────────────────────────────────────────
  {
    id: "arrow-right",
    label: "سهم يمين",
    group: "أسهم",
    parts: [poly("0,26 58,26 58,2 100,50 58,98 58,74 0,74")],
  },
  {
    id: "arrow-left",
    label: "سهم يسار",
    group: "أسهم",
    parts: [poly("100,26 42,26 42,2 0,50 42,98 42,74 100,74")],
  },
  {
    id: "arrow-up",
    label: "سهم أعلى",
    group: "أسهم",
    parts: [poly("26,100 26,42 2,42 50,0 98,42 74,42 74,100")],
  },
  {
    id: "arrow-down",
    label: "سهم أسفل",
    group: "أسهم",
    parts: [poly("26,0 26,58 2,58 50,100 98,58 74,58 74,0")],
  },
  {
    id: "arrow-double",
    label: "سهم مزدوج",
    group: "أسهم",
    parts: [
      poly("0,50 26,24 26,40 74,40 74,24 100,50 74,76 74,60 26,60 26,76"),
    ],
  },
  {
    id: "chevron",
    label: "شيفرون",
    group: "أسهم",
    parts: [poly("0,2 58,2 100,50 58,98 0,98 42,50")],
  },
  {
    id: "arrow-bend",
    label: "سهم منعطف",
    group: "أسهم",
    parts: [{ k: "path", d: "M0 80H52V20H36L66 0L96 20H80V100H0Z" }],
  },

  // ── شارات وفقاعات ──────────────────────────────────────────────────────
  {
    id: "callout",
    label: "فقاعة حديث",
    group: "شارات وفقاعات",
    parts: [
      {
        k: "path",
        d: "M6 2H94A6 6 0 0 1 100 8V66A6 6 0 0 1 94 72H44L22 98V72H6A6 6 0 0 1 0 66V8A6 6 0 0 1 6 2Z",
      },
    ],
  },
  {
    id: "thought",
    label: "فقاعة تفكير",
    group: "شارات وفقاعات",
    parts: [
      { k: "ellipse", cx: 50, cy: 34, rx: 48, ry: 32 },
      { k: "circle", cx: 26, cy: 74, r: 9 },
      { k: "circle", cx: 15, cy: 92, r: 5 },
    ],
  },
  {
    id: "ribbon",
    label: "شريط",
    group: "شارات وفقاعات",
    parts: [poly("0,8 100,8 100,92 0,92 8,50")],
  },
  {
    id: "banner",
    label: "لافتة",
    group: "شارات وفقاعات",
    parts: [poly("0,0 100,0 100,78 50,100 0,78")],
  },
  {
    id: "shield",
    label: "درع",
    group: "شارات وفقاعات",
    parts: [
      {
        k: "path",
        d: "M50 0L100 14V54C100 80 78 94 50 100C22 94 0 80 0 54V14Z",
      },
    ],
  },
  {
    id: "badge",
    label: "شارة",
    group: "شارات وفقاعات",
    parts: [
      {
        k: "path",
        d: "M50 0L64 20H88L80 42L100 56L80 70L88 92H64L50 100L36 92H12L20 70L0 56L20 42L12 20H36Z",
      },
    ],
  },
  {
    id: "heart",
    label: "قلب",
    group: "شارات وفقاعات",
    aspectRatio: 100 / 92,
    parts: [
      {
        k: "path",
        d: "M50 98C18 76 0 58 0 36C0 18 12 6 28 6C38 6 46 12 50 22C54 12 62 6 72 6C88 6 100 18 100 36C100 58 82 76 50 98Z",
      },
    ],
  },
  {
    id: "cloud",
    label: "سحابة",
    group: "شارات وفقاعات",
    parts: [
      {
        k: "path",
        d: "M26 82A24 24 0 0 1 26 34A28 28 0 0 1 76 26A22 22 0 0 1 76 82Z",
      },
    ],
  },
  {
    id: "plus",
    label: "علامة زائد",
    group: "شارات وفقاعات",
    parts: [
      poly(
        "36,0 64,0 64,36 100,36 100,64 64,64 64,100 36,100 36,64 0,64 0,36 36,36",
      ),
    ],
  },
  {
    id: "cross",
    label: "علامة خطأ",
    group: "شارات وفقاعات",
    parts: [
      poly(
        "10,0 50,38 90,0 100,10 62,50 100,90 90,100 50,62 10,100 0,90 38,50 0,10",
      ),
    ],
  },

  // ─ إطارات ────────────────────────────────────────────────────────────
  {
    id: "frame-rect",
    label: "إطار مستطيل",
    group: "إطارات",
    parts: [{ k: "path", d: "M0 0H100V100H0ZM2 2V98H98V2Z" }],
  },
  {
    id: "frame-rounded",
    label: "إطار مستدير",
    group: "إطارات",
    parts: [
      {
        k: "path",
        d: "M14 0H86A14 14 0 0 1 100 14V86A14 14 0 0 1 86 100H14A14 14 0 0 1 0 86V14A14 14 0 0 1 14 0ZM14 3A11 11 0 0 0 3 14V86A11 11 0 0 0 14 97H86A11 11 0 0 0 97 86V14A11 11 0 0 0 86 3Z",
      },
    ],
  },
  {
    id: "frame-corners",
    label: "أركان",
    group: "إطارات",
    parts: [
      poly("0,0 26,0 26,4 4,4 4,26 0,26"),
      poly("100,0 100,26 96,26 96,4 74,4 74,0"),
      poly("100,100 74,100 74,96 96,96 96,74 100,74"),
      poly("0,100 0,74 4,74 4,96 26,96 26,100"),
    ],
  },
];

const BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

export const DEFAULT_SHAPE_ID = "rect";

export function shapeDef(id: string | undefined): ShapeDef {
  return BY_ID.get(String(id || "")) || BY_ID.get(DEFAULT_SHAPE_ID)!;
}

/** Grouped shape list for the picker. */
export function shapesByGroup(): { group: string; items: ShapeDef[] }[] {
  return SHAPE_GROUPS.map((group) => ({
    group,
    items: SHAPES.filter((s) => s.group === group),
  })).filter((g) => g.items.length > 0);
}

/**
 * A shape is "compound" when one of its parts carries an inner subpath that must
 * stay transparent. Those render with `fill-rule: evenodd`, otherwise the hole
 * fills in solid and the frame reads as a plain block.
 */
const COMPOUND = new Set(["frame-rect", "frame-rounded", "arch-frame"]);

export function isCompoundShape(id: string | undefined): boolean {
  return COMPOUND.has(String(id || ""));
}
