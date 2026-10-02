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
}

export interface PsdEffectNotes {
  /** box-shadow string in the editor's mm vocabulary, when mapped. */
  shadow?: string;
  strokeColor?: string;
  strokeWidthMm?: number;
  mapped: string[];
  unsupported: string[];
}

export type PsdNodeKind =
  | "group"
  | "text"
  | "pixels"
  | "shape"
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
  text?: PsdTextRun;
  /** Solid fill discovered from a vector fill or a uniform bitmap. */
  shape?: {
    fill: string;
    radiusPx: number;
    kind: "rect" | "circle" | "rounded";
  };
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
