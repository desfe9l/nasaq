import type { CanvasEl } from "./model";

/**
 * The editor's tool model — ONE table, ONE selection tool.
 *
 * WHY THIS EXISTS (the root cause this fixes):
 *
 * The selection/crop family used to be nine near-identical tools — select,
 * marquee-rect, marquee-square, marquee-ellipse, lasso, select-shape,
 * select-image, select-layer and crop — nine header buttons drawing the same
 * rubber band, four of which ended in the same crop engine. Tool state had
 * also once been split three ways (a `drawTool` string in the canvas, refs fed
 * by window events, a mirrored `activeTool` in the header), so the header and
 * the canvas could disagree about what was armed.
 *
 * Now there is exactly ONE «تحديد / قص» tool. The shape of the region
 * (rectangle, square, ellipse, freeform) is a MODE of that tool — a compact
 * dropdown next to its button — not a tool of its own. Crop is not a tool at
 * all: it is what a region does when it lands on an image, with an ephemeral
 * Apply/Cancel that disappears the moment the operation ends. Brush, eraser,
 * text and shape remain because they are not selection verbs.
 *
 * Everything here is pure and dependency-free so the routing rules — region
 * mode, 1:1 constraint, target scope, shortcuts — are unit-testable without a
 * DOM.
 */

export type ToolId =
  /** The ONE pointer tool: click selects, drag moves, empty drag marquee-selects. */
  | "select"
  /** Paint into a raster layer. */
  | "brush"
  /** Erase pixels (alpha) from raster artwork. */
  | "eraser"
  /** Drag a text box. */
  | "text"
  /** Drag a rectangle shape. */
  | "shape";

/**
 * Region shape the ONE select tool draws.
 *
 * `off` is the plain pointer: a drag on empty space rubber-band-selects
 * elements and vanishes on release. Any other mode keeps the finished region
 * alive with editable handles, and «قص» becomes available the moment the
 * region lands on an image — the crop affordance belongs to the region, never
 * to a permanent toolbar.
 */
export type RegionMode = "off" | "rect" | "square" | "ellipse" | "lasso";

export type ToolFamily = "pointer" | "raster" | "draw";

/** Which elements a tool may touch. `layer` means "any element, topmost first". */
export type ToolTarget = "layer" | "image";

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
  /** Region the drag paints for `draw` tools. `select` paints its region mode. */
  marquee: "rect" | null;
}

const IMAGE_TYPES: CanvasEl["type"][] = ["image", "logo", "qr"];

export const TOOLS: Record<ToolId, ToolDef> = {
  select: {
    id: "select",
    family: "pointer",
    label: "تحديد / قص",
    hint: "انقر لتحديد عنصر، اسحب لتحريكه، واسحب منطقةً فوق صورة لقصّها",
    shortcut: "V",
    target: "layer",
    marquee: "rect",
  },
  brush: {
    id: "brush",
    family: "raster",
    label: "فرشاة",
    hint: "ارسم على الصور والطبقات النقطية — ضغط القلم يتحكم في سماكة الخط",
    shortcut: "B",
    target: "image",
    marquee: null,
  },
  eraser: {
    id: "eraser",
    family: "raster",
    label: "مسح",
    hint: "امسح بكسل الصورة بشفافية حقيقية — لا يمس عنصراً آخر",
    shortcut: "E",
    target: "image",
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

/**
 * The region picker's whole vocabulary — what the ONE dropdown next to the
 * select tool offers. Four region shapes plus the pointer mode to step back
 * to; nothing else. Labels stay inside the dropdown: the bar itself is an
 * icon, so no long tool name ever occupies the toolbar.
 */
export interface RegionModeDef {
  id: RegionMode;
  label: string;
  hint: string;
  /** Key hint for the menu; the binding itself resolves in `resolveToolKey`. */
  shortcut?: string;
  /** Rubber-band shape this mode paints. */
  shape: "rect" | "ellipse" | "lasso";
  /** The shape is locked 1:1 while dragging. */
  square?: boolean;
}

export const REGION_MODES: RegionModeDef[] = [
  {
    id: "off",
    label: "مؤشر — تحديد ونقر",
    hint: "انقر عنصراً أو اسحب للتحريك؛ السحب على فراغ يحدد مجموعة",
    shortcut: "V",
    shape: "rect",
  },
  {
    id: "rect",
    label: "مستطيل",
    hint: "اسحب منطقة حرة الأبعاد — Shift لنسبة 1:1 وAlt من المركز",
    shortcut: "M",
    shape: "rect",
  },
  {
    id: "square",
    label: "مربع 1:1",
    hint: "منطقة مربعة بنسبة ثابتة — Alt للرسم من المركز",
    shortcut: "⇧M",
    shape: "rect",
    square: true,
  },
  {
    id: "ellipse",
    label: "بيضاوي",
    hint: "اسحب منطقة بيضاوية — Shift لدائرة",
    shape: "ellipse",
  },
  {
    id: "lasso",
    label: "تحديد حر",
    hint: "ارسم الحدود بإصبعك أو القلم لتحديد ما داخلها",
    shortcut: "L",
    shape: "lasso",
  },
];

export const regionModeDef = (mode: RegionMode): RegionModeDef =>
  REGION_MODES.find((entry) => entry.id === mode) ?? REGION_MODES[0]!;

/** True when the select tool is armed to DRAW a region (not plain pointer). */
export const isRegionArmed = (
  tool: ToolId,
  mode: RegionMode,
): boolean => tool === "select" && mode !== "off";

/** The finished region survives the gesture in every region mode. */
export const regionKeeps = (tool: ToolId, mode: RegionMode): boolean =>
  isRegionArmed(tool, mode);

export const toolDef = (id: ToolId): ToolDef => TOOLS[id] ?? TOOLS.select;

export const isRasterTool = (id: ToolId): boolean =>
  toolDef(id).family === "raster";

/**
 * Does this live tool own the canvas gesture, so element drag must stand down?
 *
 * Plain pointer select is the ONLY state that may move artwork. A region mode
 * draws on the first finger (a press that picks an element is still allowed,
 * but a press that moves one is not), and every other tool owns the surface.
 */
export const ownsCanvas = (tool: ToolId, mode: RegionMode): boolean =>
  tool !== "select" || mode !== "off";

/** Does this tool accept the element? `layer` accepts every element. */
export function toolAccepts(id: ToolId, el: Pick<CanvasEl, "type">): boolean {
  const def = toolDef(id);
  if (def.target === "layer") return true;
  return IMAGE_TYPES.includes(el.type);
}

/** Element types the crop engine can actually operate on. */
export function isRasterElement(el: Pick<CanvasEl, "type">): boolean {
  return IMAGE_TYPES.includes(el.type);
}

/**
 * Resolve the marquee geometry for the live state + modifiers.
 *
 * Shift means "1:1" for every rectangular region (not only the square mode),
 * and Alt means "draw from the centre" — the two conventions every design tool
 * shares, resolved in one place so no gesture re-implements them. Draw tools
 * always rubber-band a rect regardless of the select tool's region mode.
 */
export function resolveMarqueeMode(
  tool: ToolId,
  mode: RegionMode,
  modifiers: { shift?: boolean; alt?: boolean } = {},
): {
  shape: "rect" | "ellipse" | "lasso" | null;
  square: boolean;
  fromCenter: boolean;
} {
  if (tool !== "select") {
    return {
      shape: toolDef(tool).marquee,
      square: false,
      fromCenter: Boolean(modifiers.alt),
    };
  }
  const def = regionModeDef(mode);
  return {
    shape: def.id === "off" ? "rect" : def.shape,
    square: Boolean(def.square) || Boolean(modifiers.shift),
    fromCenter: Boolean(modifiers.alt),
  };
}

/**
 * A tool activation — the whole answer to "which tool is live and in which
 * mode". The header, the keyboard and the command palette all produce one of
 * these and write it through the tool store, so no two entry points can arm a
 * different combination.
 */
export interface ToolActivation {
  tool: ToolId;
  regionMode: RegionMode;
}

/**
 * Physical key → activation, derived from the tables above.
 *
 * `shortcut` is the single place a tool or mode declares its key, so tooltips
 * and the keyboard handler can never drift apart, and `⇧M` resolves as
 * "shift + M" rather than a second, hidden binding.
 */
const KEY_INDEX: Array<{ key: string; shift: boolean; at: ToolActivation }> = [
  ...REGION_MODES.flatMap<{ key: string; shift: boolean; at: ToolActivation }>(
    (mode) => {
      const shortcut = mode.shortcut;
      if (!shortcut) return [];
      if (shortcut.startsWith("⇧")) {
        const key = shortcut.slice(1).toLowerCase();
        return key.length === 1
          ? [{ key, shift: true, at: { tool: "select", regionMode: mode.id } }]
          : [];
      }
      return shortcut.length === 1
        ? [{ key: shortcut.toLowerCase(), shift: false, at: { tool: "select", regionMode: mode.id } }]
        : [];
    },
  ),
  ...(Object.values(TOOLS) as ToolDef[])
    .filter((def) => def.id !== "select")
    .flatMap<{ key: string; shift: boolean; at: ToolActivation }>((def) =>
      def.shortcut && def.shortcut.length === 1
        ? [{ key: def.shortcut.toLowerCase(), shift: false, at: { tool: def.id, regionMode: "off" } }]
        : [],
    ),
];

export function resolveToolKey(
  key: string,
  shift = false,
): ToolActivation | null {
  const lower = key.toLowerCase();
  const exact = KEY_INDEX.find(
    (entry) => entry.key === lower && entry.shift === shift,
  );
  if (exact) return exact.at;
  // A shift-only variant (⇧M) also answers for plain Shift held by accident
  // only when no plain binding exists for the same key.
  if (!shift) return null;
  return KEY_INDEX.find((entry) => entry.key === lower)?.at ?? null;
}
