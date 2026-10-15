import type { Gradient } from "../gradient";
import type { LayerShadow, LayerGlow, BevelEmbossStyle, SatinStyle, ColorOverlayStyle, GradientOverlayStyle, PatternOverlayStyle } from "../model";

/**
 * Intermediate PSD document and the NASAQ conversion report.
 *
 * The parser (ag-psd) fills a `PsdDocument`. The converter turns that into a
 * native NASAQ `Project` plus an honest report of what stayed editable and
 * what had to fall back. Neither step trusts layer names as paths.
 */

export interface PsdLibraryRef {
  hash: string;
  assetId: string;
  name: string;
}

export interface PsdTextRun {
  content: string;
  /** PostScript / face name as stored in the file. */
  fontName: string;
  fontSize: number;
  fauxBold: boolean;
  fauxItalic: boolean;
  underline: boolean;
  color: string;
  align: "left" | "center" | "right" | "justify";
  /** Unitless multiple of the font size. */
  lineHeight: number;
  /** Millimetres. */
  letterSpacingMm: number;
  direction: "rtl" | "ltr";
  /** For rich text: character-level formatting overrides. */
  runs?: PsdTextCharRun[];
}

/** Single character run within a rich-text layer. */
export interface PsdTextCharRun {
  /** Start character index (inclusive). */
  start: number;
  /** End character index (exclusive). */
  end: number;
  fontName: string;
  fontSize: number;
  fauxBold: boolean;
  fauxItalic: boolean;
  underline: boolean;
  color: string;
  /** Tracking in 1/1000 em. */
  tracking?: number;
  /** Baseline shift in points. */
  baselineShift?: number;
  /** Superscript/subscript. */
  verticalAlign?: "baseline" | "super" | "sub";
  /** Text transform. */
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize" | "small-caps";
}

export interface PsdEffectNotes {
  /** box-shadow string in the editor's mm vocabulary, when mapped. */
  shadow?: string;
  /**
   * تمويه الطبقة — a smart object's blur filter, in millimetres, when mapped.
   * One value for the whole layer (`ElStyle.blur`), so several stacked blur
   * filters arrive as their strongest radius plus an explicit note.
   */
  blurMm?: number;
  strokeColor?: string;
  strokeWidthMm?: number;
  /** Gradient fill/overlay retained as a native multi-stop NASAQ paint. */
  gradient?: Gradient;
  gradientOverlay?: boolean;
  gradientBlendMode?: string;
  /** Multiple drop/inner shadows. */
  shadows?: LayerShadow[];
  /** Multiple outer/inner glows. */
  glows?: LayerGlow[];
  /** Bevel and emboss. */
  bevelEmboss?: BevelEmbossStyle;
  /** Satin. */
  satin?: SatinStyle;
  /** Color overlay. */
  colorOverlay?: ColorOverlayStyle;
  /** Gradient overlay. */
  gradientOverlayStyle?: GradientOverlayStyle;
  /** Pattern overlay. */
  patternOverlay?: PatternOverlayStyle;
  mapped: string[];
  unsupported: string[];
}

export type PsdNodeKind =
  | "group"
  | "text"
  | "pixels"
  | "shape"
  | "vector"
  | "adjustment"
  | "empty";

export interface PsdNode {
  id: string;
  name: string;
  kind: PsdNodeKind;
  hidden: boolean;
  opacity: number;
  /** Original Photoshop blend name. */
  blendMode: string;
  /** CSS blend the canvas can paint, when it is an exact match. */
  cssBlend?: string;
  clipping: boolean;
  /** Pixel bounds in the PSD document (or artboard). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** True when the file stored a degenerate box and the size was estimated. */
  boundsEstimated: boolean;
  rotation: number;
  /** Mirror a smart-object asset whose stored pixels are not yet flipped. */
  flipX?: boolean;
  flipY?: boolean;
  text?: PsdTextRun;
  /** Solid fill discovered from a vector fill or a uniform bitmap. */
  shape?: {
    fill: string;
    radiusPx: number;
    kind: "rect" | "circle" | "rounded";
    gradient?: Gradient;
  };
  /** Sanitized SVG path data reconstructed from a PSD vector mask. */
  vector?: { content: string };
  image?: {
    dataUrl: string;
    width: number;
    height: number;
    hash: string;
  };
  effects: PsdEffectNotes;
  /** Why this node cannot be a fully native element, if any. */
  issues: string[];
  children: PsdNode[];
  /** Photoshop artboard. Its children are one NASAQ page. */
  artboard?: boolean;
}

export interface PsdPage {
  name: string;
  widthPx: number;
  heightPx: number;
  nodes: PsdNode[];
}

export interface PsdDocument {
  fileName: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  /** Flattened PSD composite, when small enough to preview. */
  compositeDataUrl?: string;
  /** Layer comps (named visibility states) from the source PSD. */
  layerComps?: { name: string; caption?: string; layerIds: string[]; visible: boolean }[];
  pages: PsdPage[];
}

export interface FontFinding {
  fontName: string;
  /** Family written onto the element. Library family, or the original name. */
  family: string;
  weight: number;
  italic: boolean;
  status: "library" | "missing";
  layerIds: string[];
}

export interface AssetFinding {
  hash: string;
  name: string;
  layerId: string;
  elementId: string;
  dataUrl: string;
  width: number;
  height: number;
  /** Set when the same bytes already live in the NASAQ library. */
  match: { assetId: string; name: string } | null;
}

export interface FallbackFinding {
  layerId: string;
  layerName: string;
  mode: "raster" | "partial" | "skipped";
  reason: string;
}

export interface ConversionReport {
  fileName: string;
  dpi: number;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
  /** Source page sizes in mm (pixels ÷ dpi), page by page — the repair truth. */
  pageSizesMm: { w: number; h: number }[];
  pageCount: number;
  layerCount: number;
  groupCount: number;
  imageCount: number;
  textCount: number;
  shapeCount: number;
  nativeCount: number;
  fallbackCount: number;
  fonts: FontFinding[];
  assets: AssetFinding[];
  fallbacks: FallbackFinding[];
  /** Share of layers that became native elements, 0–100. */
  completion: number;
}

export interface ValidationIssue {
  severity: "error" | "warn";
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export type PsdProgress = (
  stage: string,
  percent: number,
  detail?: string,
) => void;
