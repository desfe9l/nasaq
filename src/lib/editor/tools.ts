import type { CanvasEl } from "./model";

/**
 * The editor's tool model — ONE table.
 *
 * WHY THIS EXISTS (the root cause it fixes):
 *
 * Tool state used to be split three ways: a `drawTool` string in the canvas,
 * a `marqueeShape` ref fed by a `nasaq:marquee-shape` window event, and an
 * `eraserSize` ref fed by a `nasaq:eraser-size` event, mirrored back into the
 * shell through `nasaq:tool-state`. Nothing was the source of truth, the
 * ordering of those events decided whether a tool had its settings at the
 * first pointerdown, and "the same tool" existed twice with different names
 * (the header's «تحديد مستطيل» button and the canvas's marquee shape were two
 * independent states). That is why rectangle/ellipse/eraser tools could look
 * armed and still do nothing on the first gesture.
 *
 * Now every tool is a row in this table and a field in the tool store
 * (`tool-store.ts`); the header reads it, the canvas reads it, the properties
 * bar reads it, and the keyboard writes it. There is exactly one answer to
 * "which tool is live, and with which settings".
 *
 * Everything here is pure and dependency-free so the routing rules — family,
 * marquee shape, target scope, 1:1 constraint — are unit-testable without a
 * DOM.
 */

export type ToolId =
  /** Pointer: click selects, drag moves, empty-space drag marquees. */
  | "select"
  /** Rubber-band rectangle over the artboard. */
  | "marquee-rect"
  /** Rubber-band rectangle locked to 1:1. */
  | "marquee-square"
  /** Rubber-band ellipse. */
  | "marquee-ellipse"
  /** Freehand lasso. */
  | "lasso"
  /** Pick / marquee restricted to vector shapes. */
  | "select-shape"
  /** Pick / marquee restricted to raster artwork (images, logos, QR). */
  | "select-image"
  /** Pick the topmost object under the pointer — the layer stack. */
  | "select-layer"
  /** Draw a constrained region and crop the image under it. */
  | "crop"
  /** Paint into a raster layer. */
  | "brush"
  /** Erase pixels (alpha) from raster artwork. */
  | "eraser"
  /** Drag a text box. */
  | "text"
  /** Drag a rectangle shape. */
  | "shape";

export type ToolFamily = "pointer" | "marquee" | "raster" | "crop" | "draw";

/** Which elements a tool may touch. `layer` means "any element, topmost first". */
export type ToolTarget = "layer" | "shape" | "image";

export interface ToolDef {
  id: ToolId;
  family: ToolFamily;
  /** Arabic UI label — the ONLY label, so no two controls can disagree. */
  label: string;
  hint: string;
  /** Single-letter shortcut, rendered uppercase next to the label. */
  shortcut?: string;
  /** Elements a pick or marquee from this tool is allowed to hit. */
  target: ToolTarget;
  /** Region the drag paints. `null` means the tool never draws a region. */
  marquee: "rect" | "ellipse" | "lasso" | null;
  /** 1:1 while dragging (Shift forces it for every region tool as well). */
  square?: boolean;
  /** Keep the finished region on screen, with editable handles. */
  keepRegion?: boolean;
  /** Element types this tool's pick filter accepts, when not `layer`. */
  types?: CanvasEl["type"][];
}

const VECTOR_TYPES: CanvasEl["type"][] = [
  "shape",
  "line",
  "divider",
  "box",
  "stat",
  "progress",
  "svg",
  "icon",
];
const IMAGE_TYPES: CanvasEl["type"][] = ["image", "logo", "qr"];

export const TOOLS: Record<ToolId, ToolDef> = {
  select: {
    id: "select",
    family: "pointer",
    label: "تحديد وتحريك",
    hint: "انقر لتحديد عنصر، اسحب لتحريكه، واسحب مساحة فارغة لتحديد منطقة",
    shortcut: "V",
    target: "layer",
    marquee: "rect",
    keepRegion: false,
  },
  "marquee-rect": {
    id: "marquee-rect",
    family: "marquee",
    label: "تحديد مستطيل",
    hint: "اسحب مستطيلاً حر الأبعاد — Shift لتفعيل 1:1، Alt للرسم من المركز",
    shortcut: "M",
    target: "layer",
    marquee: "rect",
    keepRegion: true,
  },
  "marquee-square": {
    id: "marquee-square",
    family: "marquee",
    label: "تحديد مربع",
    hint: "اسحب مربعاً بنسبة 1:1 — Alt للرسم من المركز",
    shortcut: "⇧M",
    target: "layer",
    marquee: "rect",
    square: true,
    keepRegion: true,
  },
  "marquee-ellipse": {
    id: "marquee-ellipse",
    family: "marquee",
    label: "تحديد بيضاوي",
    hint: "اسحب منطقة بيضاوية — Shift لدائرة، Alt للرسم من المركز",
    target: "layer",
    marquee: "ellipse",
    keepRegion: true,
  },
  lasso: {
    id: "lasso",
    family: "marquee",
    label: "تحديد حر",
    hint: "ارسم حدوداً حرة بإصبعك أو القلم لتحديد ما داخلها",
    shortcut: "L",
    target: "layer",
    marquee: "lasso",
    keepRegion: true,
  },
  "select-shape": {
    id: "select-shape",
    family: "marquee",
    label: "تحديد شكل",
    hint: "يحدد الأشكال المتجهية فقط — انقر شكلاً أو اسحب مستطيلاً",
    target: "shape",
    types: VECTOR_TYPES,
    marquee: "rect",
    keepRegion: true,
  },
  "select-image": {
    id: "select-image",
    family: "marquee",
    label: "تحديد صورة",
    hint: "يحدد الصور والشعارات فقط — انقر صورة أو اسحب مستطيلاً",
    target: "image",
    types: IMAGE_TYPES,
    marquee: "rect",
    keepRegion: true,
  },
  "select-layer": {
    id: "select-layer",
    family: "marquee",
    label: "تحديد طبقة",
    hint: "انقر لتحديد العنصر الأعلى في الموضع، بغض النظر عن التحديد السابق",
    target: "layer",
    marquee: "rect",
    keepRegion: true,
  },
  crop: {
    id: "crop",
    family: "crop",
    label: "قص الصورة",
    hint: "اسحب منطقة فوق الصورة ثم «تطبيق القص» — القص غير متلف ويمكن التراجع عنه",
    shortcut: "C",
    target: "image",
    types: IMAGE_TYPES,
    marquee: "rect",
  },
  brush: {
    id: "brush",
    family: "raster",
    label: "فرشاة",
    hint: "ارسم على الصور والطبقات النقطية — ضغط القلم يتحكم في سماكة الخط",
    shortcut: "B",
    target: "image",
    types: IMAGE_TYPES,
    marquee: null,
  },
  eraser: {
    id: "eraser",
    family: "raster",
    label: "مسح",
    hint: "امسح بكسل الصورة بشفافية حقيقية — لا يمس عنصراً آخر",
    shortcut: "E",
    target: "image",
    types: IMAGE_TYPES,
    marquee: null,
  },
  text: {
    id: "text",
    family: "draw",
    label: "نص بالرسم",
    hint: "اسحب على اللوحة ثم اكتب",
    shortcut: "T",
    target: "layer",
    marquee: "rect",
  },
  shape: {
    id: "shape",
    family: "draw",
    label: "رسم مستطيل",
    hint: "اسحب على اللوحة لرسم مستطيل",
    shortcut: "R",
    target: "layer",
    marquee: "rect",
  },
};

/** Toolbar order: groups are separated by a hairline in the UI. */
export const TOOL_GROUPS: ToolId[][] = [
  ["select", "marquee-rect", "marquee-square"],
  ["marquee-ellipse", "lasso"],
  ["select-shape", "select-image", "select-layer"],
  ["crop", "brush", "eraser"],
  ["text", "shape"],
];

export const TOOL_ORDER: ToolId[] = TOOL_GROUPS.flat();

export const toolDef = (id: ToolId): ToolDef => TOOLS[id] ?? TOOLS.select;

export const isMarqueeTool = (id: ToolId): boolean =>
  toolDef(id).family === "marquee";
export const isRasterTool = (id: ToolId): boolean =>
  toolDef(id).family === "raster";
export const isRegionTool = (id: ToolId): boolean => toolDef(id).marquee !== null;
/** Tools that own the canvas gesture, so element drag must stand down. */
export const ownsCanvas = (id: ToolId): boolean =>
  id !== "select" && id !== "select-layer";

/** Does this tool accept the element? `layer` accepts every element. */
export function toolAccepts(id: ToolId, el: Pick<CanvasEl, "type">): boolean {
  const def = toolDef(id);
  if (def.target === "layer") return true;
  return (def.types || []).includes(el.type);
}

/** Element types the crop tool can actually operate on. */
export function isRasterElement(el: Pick<CanvasEl, "type">): boolean {
  return IMAGE_TYPES.includes(el.type);
}

/**
 * Resolve the marquee geometry for a tool + live modifiers.
 *
 * Shift means "1:1" for every region tool (not only the square one), and Alt
 * means "draw from the centre" — the two conventions every design tool shares,
 * resolved in one place so no tool re-implements them.
 */
export function resolveMarqueeMode(
  id: ToolId,
  modifiers: { shift?: boolean; alt?: boolean } = {},
): { shape: "rect" | "ellipse" | "lasso" | null; square: boolean; fromCenter: boolean } {
  const def = toolDef(id);
  return {
    shape: def.marquee,
    square: Boolean(def.square) || Boolean(modifiers.shift),
    fromCenter: Boolean(modifiers.alt),
  };
}

/** Tools whose finished region can be turned into a crop. */
export const regionCanCrop = (id: ToolId): boolean =>
  toolDef(id).keepRegion === true;

/**
 * Physical key → tool, derived from the table above.
 *
 * `shortcut` is the single place a tool declares its key, so the header tooltip
 * and the keyboard handler can never drift apart — and `⇧M` is resolved as
 * "shift + M" rather than a second, hidden binding.
 */
interface ShortcutEntry {
  key: string;
  shift: boolean;
  id: ToolId;
}

const SHORTCUT_INDEX: ShortcutEntry[] = TOOL_ORDER.flatMap<ShortcutEntry>((id) => {
  const shortcut = TOOLS[id].shortcut;
  if (!shortcut) return [];
  if (shortcut.startsWith("⇧")) {
    const key = shortcut.slice(1).toLowerCase();
    return key.length === 1 ? [{ key, shift: true, id }] : [];
  }
  return shortcut.length === 1
    ? [{ key: shortcut.toLowerCase(), shift: false, id }]
    : [];
});

export function resolveToolShortcut(
  key: string,
  shift = false,
): ToolId | null {
  const lower = key.toLowerCase();
  const exact = SHORTCUT_INDEX.find(
    (entry) => entry.key === lower && entry.shift === shift,
  );
  if (exact) return exact.id;
  // A shift-only variant (⇧M) also answers for plain Shift held by accident
  // only when no plain binding exists for the same key.
  if (!shift) return null;
  return SHORTCUT_INDEX.find((entry) => entry.key === lower)?.id ?? null;
}
