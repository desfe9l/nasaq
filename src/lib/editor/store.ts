import { clearUploadedFonts } from "../nsq/fonts";
import { create } from "zustand";
import { toast } from "sonner";
import {
  A4,
  MIN_SIZE,
  THEMES,
  absoluteBounds,
  alignmentMoves,
  centerFor,
  clone,
  constrainElement,
  createElement,
  createElementDefaults,
  createGroupFrom,
  distributePositions,
  explodeGroup,
  findElement,
  nextZ,
  normalizeZ,
  pageSize,
  projectMeta,
  scaleChildren,
  sizePreset,
  type AlignEdge,
  type CanvasEl,
  type ElStyle,
  type ElType,
  type Page,
  type PackId,
  type Project,
  type ProjectMeta,
  type ProjectSnapshot,
  type SizeId,
  type ThemeId,
} from "./model";
import { DEFAULT_FADE, normalizeFade } from "./fade";
import {
  deleteAsset as removeAsset,
  deleteProject as removeProject,
  duplicateProject as copyProject,
  getProject,
  getSetting,
  listAssets,
  listProjects,
  migrateLegacyProject,
  renameAsset as renameAssetRow,
  saveAsset,
  saveProject,
  setSetting,
  storageMode,
  type Asset,
  type AssetFolder,
  type SettingsKey,
} from "./storage";
import {
  ANON_OWNER,
  getStorageOwner,
  hasSignedInOwner,
} from "./storage-owner";
import {
  createProject,
  createTemplatePage,
  PACKS,
  templateById,
} from "./templates";
import {
  FONTS,
  LEGACY_STORE_KEY,
  LEGACY_UI_KEY,
  TYPE_NAME,
  UI_KEY,
} from "./model";
import { detectDeviceFonts, type DetectedFont } from "./fonts";
import { resolveTextBox, setTextContext } from "./text-render";
import { DEFAULT_PRINT_GUIDES, type PrintGuideSettings } from "./print-guides";
import {
  SHOW_OUTSIDE_PAGE_DEFAULT,
  normalizeShowOutsidePage,
} from "./page-visibility";
import { splitArtboard } from "./artboard";
import {
  applyFurniture,
  boundsOf,
  clearFurniture,
  clearPageNumbers as dropPageNumbers,
  kpiCard,
  numberPages,
  placeElements,
  signatureZoneForPage,
  type KpiKind,
} from "./report-tools";
import {
  applyTypographyPreset,
  typographyPreset,
  type TypographyPresetId,
} from "./typography";
import {
  buildReportBlock,
  buildReportDraftBlock,
  type ReportBlockId,
} from "./report-blocks";
import { buildGraphicHeading, type GraphicHeadingId } from "./graphic-headings";
import { framedImageOverrides, imageFrameDef } from "./image-frames";
import type { ReportDraft } from "../ai/contract";
import { insertPageAfter, resolveNewPageSize, type NewPageRequest } from "./page-order";
import { safeImageSrc } from "./images";
import { clampZoom } from "./document-space";
import {
  visiblePageRect as measuredVisiblePageRect,
  revealInsertedElement,
  insertionPage,
} from "./canvas-space";
import { normalizeGradient, type Gradient } from "./gradient";
import { normalizeCrop } from "./image-crop";
import {
  insertLibraryDrop,
  normalizeLibraryDrop,
  type LibraryDropPayload,
} from "./library-dnd";
import { captureThumbnail, thumbnailCaptureDue } from "./thumbnail";
import type { LibraryImportPlan } from "./library-export";
import { DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME } from "./library-manager";
import {
  applyStoredTheme,
  readStoredTheme,
  writeStoredTheme,
  type AppearanceMode,
} from "@/lib/theme";
import { clamp, uid } from "@/lib/utils";
import {
  exceedsProjectPageLimit,
  exceedsSavedProjectLimit,
  projectAccessBlock,
  requiresLicensedTemplate,
  requiresPremiumPack,
} from "./access-limits";
import { LICENSE_ENTITLEMENTS, type FeatureId } from "@/lib/license/types";
import {
  PAGES_PANEL_DEFAULT,
  clampPagesHeight,
  extractSvgMarkup,
  isOverlayViewport,
} from "./ui-state";
import { nudgeStack, restack, type LayerDropSide } from "./layers";
// Dependency-free (no DOMParser) so it is safe in this module's Node tests.
import { safeLibrarySvg } from "./svg-scrub";
import {
  disarmUnloadBypass,
  hasLeaveGuard,
  requestLeave,
} from "./leave-controller";
import { hasUnsavedChanges } from "./unsaved-leave";

/*
 * The shell's pure layout/import helpers live in `ui-state.ts` (alias-free and
 * unit-tested); re-exported here so existing import sites — and the panels that
 * already pull them from the store — keep working unchanged.
 */
export {
  OVERLAY_BREAKPOINT,
  PAGES_PANEL_DEFAULT,
  PAGES_PANEL_MIN,
  clampPagesHeight,
  extractSvgMarkup,
  isOverlayViewport,
} from "./ui-state";

export type LeftTab =
  | "tools"
  | "elements"
  | "shapes"
  | "library"
  | "templates"
  | "theme"
  | "pages"
  | "fonts"
  | "settings";
export type RightTab = "properties" | "layers";
export type View = "home" | "editor";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** Export formats the studio can produce (mirrors `export.ts`). */
export type ExportPreset =
  "pdf" | "png" | "jpg" | "docx" | "pptx" | "html" | "svg" | "json" | "nsq";

/**
 * Where a right-click menu was opened from.
 *
 * Canvas and layer-row menus share ONE overlay implementation, but they act on
 * different things: a canvas menu follows the selection, while a layers menu
 * must act on the row the author right-clicked (which may not be selected yet).
 * Carrying the origin lets the menu resolve its target correctly.
 */
export type ContextMenuSource = "canvas" | "layers";

export interface ContextMenuPoint {
  x: number;
  y: number;
  targetId: string | null;
  source: ContextMenuSource;
}

/** A vector asset the author added from their own device (icon or divider). */
export interface CustomLibraryItem {
  id: string;
  name: string;
  kind: "icon" | "divider";
  /** Raw `<svg …>` markup — sanitised on render and export like every SVG. */
  svg: string;
  createdAt: number;
}

/** Bundled families as the initial (pre-probe) font list. */
function bundledFontChoices(): FontChoice[] {
  return FONTS.map((family) => ({
    family,
    note: "مضمّن في المنصة",
    source: "bundled" as const,
  }));
}

/**
 * Order the font list: bundled first (always present), then families found on
 * this device, then anything the author uploaded. De-duplicated by family so a
 * system font that is also bundled does not appear twice.
 */
function mergeFontChoices(
  detected: DetectedFont[],
  uploaded: FontChoice[],
): FontChoice[] {
  const bundled: FontChoice[] = FONTS.map((family) => ({
    family,
    note: "مضمّن في المنصة",
    source: "bundled" as const,
  }));
  const seen = new Set(bundled.map((f) => f.family));
  const system: FontChoice[] = [];
  for (const f of detected) {
    if (seen.has(f.family) || f.bundled) continue;
    seen.add(f.family);
    system.push({ family: f.family, note: f.note, source: "system" });
  }
  const extra = uploaded.filter((f) => {
    if (seen.has(f.family)) return false;
    seen.add(f.family);
    return true;
  });
  return [...bundled, ...system, ...extra];
}

interface Ui {
  activePageId: string;
  /**
   * Monotonic camera-reset signal. It changes only when a different document
   * is placed in the editor (open, create, template, import, blank reset), not
   * for edits or undo/redo, so the shell can establish a fresh device-specific
   * viewport exactly once per opening.
   */
  documentRevision: number;
  /** Primary selection: the element whose properties the panel shows. */
  selectedId: string | null;
  /** Full selection, primary first. Contains `selectedId` when it is non-null. */
  selectedIds: string[];
  /** Group whose children are directly selectable, set by entering a group. */
  enteredGroupId: string | null;
  /**
   * Element with an active in-place text editor, if any.
   *
   * The selection overlay reads this to step aside (no pointer capture, no
   * handles) while the caret is inside a text node.
   */
  editingId: string | null;
  /** Begin/end in-place text editing for an element. */
  setEditing: (id: string | null) => void;
  zoom: number;
  showGrid: boolean;
  snapGrid: boolean;
  snapElements: boolean;
  /**
   * «إظهار العناصر خارج الصفحة» — the workspace-wide answer to "may artwork
   * that hangs off the sheet still be seen?".
   *
   * ON (the default) paints every element wherever its geometry puts it, so a
   * bleed, an arc or a half-placed photo stays visible while it is being
   * edited. OFF clips each artboard to its own rectangle. It is a VIEW
   * preference only: nothing is deleted, moved, resized or reordered, the
   * document keeps every element either way, and the export keeps its own
   * independent «قص التصدير» switch.
   */
  showOutsidePage: boolean;
  previewAll: boolean;
  focusMode: boolean;
  appearance: AppearanceMode;
  leftTab: LeftTab;
  rightTab: RightTab;
  leftOpen: boolean;
  rightOpen: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /**
   * The right inspector is SPLIT into three independent windows that can all
   * be open at once (the old tab switch hid two of them behind the third):
   * `rightOpen` = الخصائص (properties), plus the two dedicated flags below.
   */
  layersOpen: boolean;
  reportToolsOpen: boolean;
  /**
   * The left panel is equally split: the asset library and the element-tools
   * palette are their own windows; `leftOpen` keeps the remaining tabs
   * (عناصر/أشكال/قوالب/صفحات/سمة/خطوط/إعدادات) in one window.
   */
  libraryOpen: boolean;
  toolsOpen: boolean;
  /** Number of artboard grid columns for multi-artboard canvas layout. */
  artboardGridCols: number;
  /** Height (px) of the bottom pages panel — drag-resizable, persisted. */
  pagesPanelHeight: number;
  /**
   * Collapsed pages rail: the bottom tray shrinks to a thin strip of page
   * chips so the artboard keeps the height. Persisted with the rest of the
   * workspace layout.
   */
  pagesRailCollapsed: boolean;
  /**
   * Hidden pages rail: the tray leaves the layout entirely (height 0) so the
   * canvas reclaims every pixel of it. Distinct from `pagesRailCollapsed`,
   * which keeps a 36px chip strip. Persisted with the workspace layout.
   */
  pagesRailHidden: boolean;
  /** Toggle the pages rail between the thumbnail tray and the thin strip. */
  togglePagesRail: () => void;
  /** Show/hide the pages rail completely (compact rail + max canvas). */
  togglePagesRailHidden: () => void;
  /** Right-click menu shared by the canvas and the layers panel. */
  contextMenu: ContextMenuPoint | null;
  /**
   * Whether the floating contextual bubble (Phase 4 toolbar) is shown.
   *
   * Designers who work with the properties panel open often find the bubble
   * redundant — it follows the selection and can sit over artwork. The toggle
   * (header eye, or the bubble's own close button) turns it off globally and
   * the choice is remembered.
   */
  bubbleEnabled: boolean;
  /**
   * Manual placement offset for the floating bubble, in screen pixels.
   *
   * The bubble positions itself (above, then below/sideways, never over the
   * artwork), but an author working on a crowded page often wants it parked
   * somewhere of their own choosing. Dragging its grip stores the offset here
   * (persisted); double-clicking the grip — or «ضبط وتنسيق مساحة العمل» —
   * returns it to automatic placement.
   */
  bubbleOffset: { dx: number; dy: number } | null;
  exportOpen: boolean;
  /**
   * Format the export dialog should open on.
   *
   * The dialog owns its own form state, but several surfaces (properties →
   * «تصدير», toolbar, command palette) know *what* the author wants to export
   * before the dialog exists. Carrying the intent as a preset removes the
   * "press export, then pick the format you already picked" step.
   */
  exportPreset: ExportPreset | null;
  pageManagerOpen: boolean;
  /**
   * The table builder / Excel-CSV importer is open.
   *
   * An intent in the store rather than local state, because three surfaces ask
   * for it (the elements palette, the smart library, and «أدوات التقرير» →
   * «استيراد من Excel/CSV»). They all mean the same thing, so they all raise the
   * same flag and one overlay answers — no duplicated import UI.
   */
  tablePickerOpen: boolean;
  /**
   * Print guides painted over the artboard: safe type area, binding margin and
   * bleed. Persisted, because an author preparing a bound report turns them on
   * once and expects them to still be there tomorrow.
   */
  printGuides: PrintGuideSettings;
  /** Export clips artwork to the page unless the author turns this off. */
  clipExport: boolean;
  saveState: SaveState;
  savedAt: number | null;
  /** Re-renders the "saved N minutes ago" label without polling the store. */
  clockTick: number;
  /**
   * The offscreen capture DOM (`#export-root`) is needed only while a
   * thumbnail is actually being rasterised (or an export is running) — it
   * renders the whole document a second time, so it must not exist during
   * ordinary editing. `saveNow` raises this flag for the capture window.
   */
  captureArmed: boolean;
}

interface History {
  /**
   * Undo stack — STRUCTURAL snapshots, not serialised documents.
   *
   * See `pushHistory` for why: a JSON string per entry cost a full
   * `JSON.stringify` of every page (images included) on every single commit,
   * and up to 60 whole documents of memory. Structural snapshots share every
   * page object the edit did not touch, so one entry costs one page.
   */
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
}

export interface StorageInfo {
  mode: "indexeddb" | "localstorage";
  persistent: boolean;
}

/** A font the author can pick: bundled webfont, detected system face, or uploaded. */
export interface FontChoice {
  family: string;
  note: string;
  source: "bundled" | "system" | "uploaded";
}

interface EditorStore extends Project, Ui, History {
  hydrated: boolean;
  /**
   * Read-only showcase boot (`?showcase=1`): fully interactive, but nothing
   * is ever persisted — autosave and explicit saves are no-ops and the
   * onboarding surface (tour, intake, account menu) stays out of the way.
   */
  showcase: boolean;
  /**
   * The storage owner (account id, or the anonymous tag) this store's data was
   * hydrated for — `null` until the first session sync. `hydrate()` compares it
   * against the live session so an identity change without a page reload (popup
   * sign-in) drops the previous session's library instead of keeping it.
   */
  sessionOwner: string | null;
  /**
   * Drop every user-scoped slice (open document, projects list, asset shelf,
   * custom vectors, clipboard/history) and mark the store un-hydrated. Run at
   * auth boundaries — sign-out, identity switch — so the previous account's
   * data leaves memory and the UI immediately; the next `hydrate()` reloads
   * whatever the NEW owner may see.
   */
  resetUserScopedState: () => void;
  /** Server-derived access flags mirrored into the client editor state. */
  entitlements: Record<FeatureId, boolean>;
  /** False until the current storage owner's server-verified status is resolved. */
  entitlementsResolved: boolean;
  entitlementsOwner: string | null;
  setEntitlements: (
    entitlements: Record<FeatureId, boolean>,
    owner?: string,
  ) => void;
  clipboard: CanvasEl | null;
  /** Session-local formatting clipboard, separate from whole-element copy/paste. */
  styleClipboard: ElStyle | null;
  projects: ProjectMeta[];
  projectsLoading: boolean;
  storage: StorageInfo;
  /** Reusable uploaded images, newest first. */
  assets: Asset[];
  assetsLoading: boolean;
  assetFolders: AssetFolder[];
  assetFolderId: string | null;
  selectedAssetIds: string[];
  refreshAssets: () => Promise<void>;
  addAsset: (asset: {
    name: string;
    src: string;
    w: number;
    h: number;
    folderId?: string | null;
  }) => Promise<Asset | null>;
  removeAsset: (id: string) => Promise<void>;
  /** Batch delete for the multi-select — assets only, never folders. */
  removeAssets: (ids: string[]) => Promise<void>;
  /** Replace the selection wholesale (shift+click range, select-all). */
  selectAssets: (ids: string[]) => void;
  renameAsset: (id: string, name: string) => Promise<void>;
  setAssetFolder: (id: string | null) => void;
  toggleAssetSelect: (id: string) => void;
  clearAssetSelection: () => void;
  createAssetFolder: (name: string, parentId?: string | null) => Promise<void>;
  renameAssetFolder: (id: string, name: string) => Promise<void>;
  deleteAssetFolder: (id: string) => Promise<void>;
  moveAssetsToFolder: (ids: string[], folderId: string | null) => Promise<void>;
  /**
   * Independent copies of assets and, when folder ids are passed, their trees.
   * Originals stay put. Remote objects are copied in the background.
   */
  duplicateLibrary: (assetIds: string[], folderIds?: string[]) => Promise<void>;
  /**
   * Apply a planned library import (`planLibraryImport`) in one store update:
   * the plan's folders keep the exact ids its assets reference, and folders +
   * assets land in a single `set()` so the shelf re-renders atomically. The
   * old path re-created folders under fresh ids, orphaning every imported
   * asset's `folderId` — the items were written to storage but matched no
   * folder chip and no «الكل» filter, so they never appeared.
   */
  importLibraryPlan: (
    plan: LibraryImportPlan,
  ) => Promise<{ added: number; failed: number }>;
  /** Bundled + detected + uploaded families, in display order. */
  fontChoices: FontChoice[];
  /** True once the one-off device probe has run. */
  fontsProbed: boolean;
  probeFonts: () => void;
  registerFont: (family: string, note?: string) => void;
  hydrate: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (pack: PackId, theme?: ThemeId) => Promise<boolean>;
  /**
   * Persist a fully built document (new-document flow, «استخدام القالب») as a
   * NEW project and open it. The source (template, pack) is never touched —
   * the project gets its own id. `autoName` numbers a default title so it
   * never collides with an existing one. Same entitlement ceilings as
   * `createProject`; resolves `false` when refused.
   */
  createDocument: (
    project: Project,
    options?: { autoName?: boolean },
  ) => Promise<boolean>;
  /** Opens only when the current owner and entitlements permit this file. */
  openProject: (id: string) => Promise<boolean>;
  saveNow: () => Promise<void>;
  /** Cancel a pending debounced save timer without locking future edits. */
  cancelPendingSaveTimer: () => void;
  /** Drop a debounced autosave that has not started. In-flight saves still finish. */
  pauseScheduledSave: () => void;
  /** Re-arm autosave after a cancelled leave prompt. */
  resumeScheduledSave: () => void;
  /** True while scheduled autosave is explicitly paused. */
  isSavePaused: () => boolean;
  /** Explicitly discard unsaved changes and restore the last persisted/clean state. */
  discardUnsavedChanges: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  /** Flip a document's star — persists on the row, independent of auto-save. */
  toggleProjectFavorite: (id: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  /**
   * Add a project file's contents to the library as a NEW document and open
   * it. Nothing existing is overwritten; a failed save applies nothing.
   * Resolves `true` once the project is saved and open.
   */
  importProject: (
    data: Partial<Project>,
    opts?: {
      activePageIndex?: number;
      successMessage?: string | null;
      expectedOwner?: string;
      importId?: string;
    },
  ) => Promise<boolean>;
  setZoom: (z: number) => void;
  setArtboardGridCols: (cols: number) => void;
  toggleArtboardLock: (id?: string) => void;
  toggleArtboardHidden: (id?: string) => void;
  splitArtboardPage: (
    id?: string,
    direction?: "horizontal" | "vertical",
  ) => void;
  addArtboardAdjacent: (
    targetId: string,
    direction: "row" | "col" | "top" | "bottom" | "left" | "right",
  ) => void;
  toggle: (
    key: keyof Pick<
      Ui,
      | "showGrid"
      | "snapGrid"
      | "snapElements"
      | "previewAll"
      | "leftOpen"
      | "rightOpen"
      | "leftCollapsed"
      | "rightCollapsed"
      | "focusMode"
      | "exportOpen"
      | "pageManagerOpen"
      | "layersOpen"
      | "reportToolsOpen"
      | "libraryOpen"
      | "toolsOpen"
      | "pagesRailHidden"
    >,
  ) => void;
  /** Set one of the three shared, persistent interface appearance modes. */
  setAppearance: (appearance: AppearanceMode) => void;
  setLeftTab: (t: LeftTab) => void;
  setRightTab: (t: RightTab) => void;
  /**
   * One sidebar switch for every screen size.
   *
   * Desktop docks the panels (so the toggle flips `*Collapsed`), while
   * tablet/phone floats them over the canvas (so it flips `*Open`). The header
   * button therefore behaves like "show/hide this sidebar" everywhere.
   */
  toggleSidebar: (side: "left" | "right") => void;
  /** Dismiss both floating sidebars (backdrop tap, canvas tap, Escape). */
  closeFloatingPanels: () => void;
  /** Open the export dialog, optionally preselecting a format. */
  openExport: (format?: ExportPreset) => void;
  openContextMenu: (point: ContextMenuPoint) => void;
  closeContextMenu: () => void;
  /** Show/hide the floating contextual bubble (persisted). */
  toggleBubble: (enabled?: boolean) => void;
  /** Park the floating bubble at a manual offset, or `null` for automatic. */
  setBubbleOffset: (offset: { dx: number; dy: number } | null) => void;
  /**
   * 🪄 ضبط وتنسيق مساحة العمل — restore the side panels, the pages tray and
   * the floating bubble to their default dock positions (persisted). The
   * shell pairs it with a fit-to-screen so the artboard is centred too.
   */
  resetWorkspaceLayout: () => void;
  /**
   * Bring the smart library up from anywhere (the header button).
   *
   * Docked screens un-collapse the components panel and select the tab — the
   * grid columns are unchanged, so the artboard does not move. Floating screens
   * open the drawer instead.
   */
  openLibrary: () => void;
  /** Clamp + persist the pages panel height (drag handle on its top border). */
  setPagesPanelHeight: (height: number) => void;
  /** Custom SVG icons/dividers the author added to the smart library. */
  customIcons: CustomLibraryItem[];
  addCustomIcon: (input: {
    name: string;
    svg: string;
    kind: CustomLibraryItem["kind"];
  }) => Promise<CustomLibraryItem | null>;
  removeCustomIcon: (id: string) => Promise<void>;
  setTheme: (id: ThemeId) => void;
  setName: (name: string) => void;
  setOrg: (org: string) => void;
  /** Official transaction / outgoing number, printed by {رقم_المعاملة}. */
  setTransactionNo: (value: string) => void;
  setActivePage: (id: string) => void;
  /**
   * Open the table builder. `source` names the window that hosts the overlay
   * ("elements" basics palette or "tools" smart library) so exactly one
   * builder shows when both windows are open.
   */
  openTablePicker: (source?: "elements" | "tools") => void;
  closeTablePicker: () => void;
  select: (id: string | null) => void;
  /** Add or remove one element from the selection (shift-click). */
  toggleSelect: (id: string) => void;
  /** Replace the selection wholesale (marquee, layers, select-all). */
  selectMany: (ids: string[]) => void;
  /**
   * Select every pickable element on the active page.
   *
   * Shared by the Cmd/Ctrl+A shortcut and the toolbar button so both apply the
   * same rule: a group counts as one element, matching what a marquee over
   * everything would pick up.
   */
  selectAll: () => void;
  /**
   * Invert the selection within the same universe `selectAll` draws from:
   * every unlocked, visible element that is NOT currently selected.
   */
  invertSelection: () => void;
  linkSelected: () => void;
  unlinkSelected: () => void;
  /** Step into a group so its children can be picked individually. */
  enterGroup: (id: string | null) => void;
  /** Selected elements of the active page, primary first. */
  selectedElements: () => CanvasEl[];
  /** Returns the new group's id (also the live selection), or null when nothing was grouped. */
  group: () => string | null;
  ungroup: () => void;
  align: (edge: AlignEdge, frame: "selection" | "page") => void;
  distribute: (axis: "h" | "v") => void;
  /**
   * Match every selected element's size to the PRIMARY selection's
   * (Same Width / Same Height / Same Size). Top-level, unlocked elements only.
   */
  matchSize: (dim: "width" | "height" | "both") => void;
  /** Rename an element from the layers panel. */
  renameElement: (id: string, name: string) => void;
  setElementFlag: (
    id: string,
    flag: "locked" | "hidden",
    value?: boolean,
  ) => void;
  moveLayer: (id: string, dir: -1 | 1) => void;
  /** Reorder sibling layers using their visible (front-to-back) list order. */
  reorderLayers: (
    fromId: string,
    toId: string,
    side?: "before" | "after",
  ) => void;
  addElement: (type: ElType, over?: Partial<CanvasEl>) => string | undefined;
  /** Show or hide one print guide across every artboard. */
  togglePrintGuide: (kind: keyof PrintGuideSettings) => void;
  /**
   * Copy the active page's header and footer onto every other page of the same
   * size (and mark them as furniture, so the action is idempotent).
   */
  applyHeaderFooter: () => void;
  /** Remove every applied header/footer element from the document. */
  removeHeaderFooter: () => void;
  /** Add live «صفحة n من m» numbering to every page that lacks it. */
  addPageNumbers: () => void;
  /** Remove that numbering again. */
  removePageNumbers: () => void;
  /** Drop a ready-made stamp & signature zone on the active page. */
  insertSignatureZone: () => void;
  /** Drop a KPI card (progress / target vs actual / stat badge) on the page. */
  insertKpiCard: (
    kind: KpiKind,
    options: { caption: string; value: number; target?: number },
  ) => void;
  /** Insert a reusable structured report block as one editable group. */
  insertReportBlock: (id: ReportBlockId) => string | undefined;
  /** Insert a ready-made graphic heading (editable group) onto the page. */
  insertGraphicHeading: (id: GraphicHeadingId) => string | undefined;
  /**
   * «أشكال و إطارات الصور» — drop a framed picture on the active page.
   *
   * One click inserts a real `image` element carrying `style.frameId`, so the
   * picture is immediately editable in every way an inserted image is
   * (replace, crop, resize, rotate) and keeps the chosen silhouette.
   */
  insertImageFrame: (frameId: string) => string | undefined;
  insertGraphicHeadingAt: (
    id: GraphicHeadingId,
    at: { x: number; y: number },
  ) => string | undefined;
  /** Insert or replace an AI draft as an editable hierarchy of report elements. */
  insertReportDraft: (
    draft: ReportDraft,
    existingId?: string,
  ) => string | undefined;
  /** Apply an Arabic typography preset to the selection (or the next text). */
  applyPreset: (presetId: TypographyPresetId) => void;
  /** Insert a macro token into the selected text element. */
  insertMacro: (token: string) => void;
  /**
   * Same insertion, but returns the created element and accepts an optional
   * centre point — the drop target for a library card dragged onto the canvas.
   * `addElement` is a thin wrapper over this, so both share one code path.
   */
  addElementAt: (
    type: ElType,
    over?: Partial<CanvasEl>,
    center?: { x: number; y: number },
    pageId?: string,
  ) => CanvasEl | undefined;
  insertLibraryElements: (
    payload: LibraryDropPayload,
    at?: { x: number; y: number } | null,
    pageId?: string,
  ) => string[];
  /** Create a text element at an exact drawn box (the «نص بالرسم» tool). */
  addTextAt: (
    box: { x: number; y: number; w: number; h: number },
    pageId?: string,
  ) => string | undefined;
  updateElement: (id: string, patch: Partial<CanvasEl>, live?: boolean) => void;
  updateStyle: (id: string, patch: CanvasEl["style"], live?: boolean) => void;
  replaceElement: (el: CanvasEl, live?: boolean) => void;
  /**
   * تعزيز الصور — patch one element of a SPECIFIC page as a single undo step.
   * Unlike `updateElement` (which writes the active page), this targets the
   * page captured when an async job started: image enhancement can finish
   * after the author navigated elsewhere, and the result must still land on
   * the element it was requested for. Returns false when the element is gone
   * (deleted while processing) so the caller can report instead of silently
   * dropping the work.
   */
  patchElementOnPage: (
    pageId: string,
    id: string,
    patch: Partial<CanvasEl>,
  ) => boolean;
  /**
   * Commit a finished gesture: apply several COMPLETE elements of one page in a
   * single store write with ONE history entry.
   *
   * Live pointer feedback no longer writes the document per frame (see
   * `interaction-store.ts`); when the gesture ends the canvas calls this with
   * the final geometry of every element it moved. Writing each through
   * `replaceElement` would fire N store notifications and N history pushes for
   * what is one author action.
   */
  applyElements: (
    pageId: string,
    els: CanvasEl[],
    opts?: { live?: boolean },
  ) => void;
  /**
   * Keyboard nudge as one undoable step. The old path called `updateElement`
   * per selected element (one store write each); a multi-selection arrow press
   * now produces exactly one write and one history entry.
   */
  nudgeSelection: (dx: number, dy: number) => void;
  fitTextBox: (id: string) => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  copyStyle: () => void;
  pasteStyle: () => void;
  /**
   * اللصق — `inPlace` pastes exactly on top of the original (Paste in Place),
   * the default keeps the +8mm nudge so a plain ⌘V never hides the copy.
   * Either way it is ONE history entry and the group's layer order survives.
   */
  pasteClipboard: (inPlace?: boolean) => void;
  deleteSelected: () => void;
  bring: (dir: "forward" | "back" | "front" | "bottom") => void;
  /**
   * قناع القص (Clipping Mask): mask `sourceId` (image-family) by `shapeId`.
   * The relationship is one `clippedBy` pointer — it follows undo/redo for
   * free and removes cleanly.
   */
  applyClipMask: (sourceId: string, shapeId: string) => void;
  removeClipMask: (shapeId: string) => void;
  toggleLock: () => void;
  /**
   * قفل التحجيم — per-element resize lock on the current selection.
   *
   * Toggles `CanvasEl.resizeLocked` on each selected element (no group
   * cascade: it is an independent, per-element state). Blocking happens at
   * the gesture layer — the flag itself only records the author's intent and
   * travels with the element through save/copy/undo.
   */
  toggleResizeLock: () => void;
  /** قفل عرض مستقل — يمنع تغيير العرض فقط */
  toggleWidthLock: () => void;
  /** قفل ارتفاع مستقل */
  toggleHeightLock: () => void;
  /** قفل نسبة العرض إلى الارتفاع لكل عنصر */
  toggleAspectLock: () => void;
  toggleHidden: () => void;
  /**
   * قلب أفقي / قلب رأسي — mirror the selection on an axis (step 7).
   * The flag lives in the element style, so it travels with copy/paste, undo,
   * the layer tree and every save.
   */
  flipSelected: (axis: "x" | "y") => void;
  /**
   * إضافة / إزالة طبقة التلاشي (step 8). Adding uses the default scrim; the
   * properties panel then edits direction, colours, opacity and blend in place.
   */
  toggleFadeOverlay: () => void;
  /**
   * Copy an element straight into another page. The clipboard alone can do this
   * (copy → switch page → paste), but that loses the current selection and the
   * source page context, so the layers panel offers a direct action.
   */
  copyElementToPage: (elId: string, pageId: string) => void;
  addPage: (request?: NewPageRequest) => void;
  addTemplatePage: (id: string) => void;
  duplicatePage: (id?: string) => void;
  deletePage: (id?: string) => void;
  /**
   * Delete specific elements of the active page by id, as ONE history entry.
   *
   * Used by the pre-flight checker's offered fixes: a batch of empty boxes is
   * one decision by the author, so it should be one undo — and unlike
   * `deleteSelected` it does not depend on the current selection, which the
   * dialog must not have to change to clean up after itself.
   */
  deleteElementsById: (ids: string[]) => void;
  /** Replace contiguous, unlocked top-level layers with their merged raster. */
  mergeSelection: (image: {
    src: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }) => boolean;
  movePage: (dir: -1 | 1) => void;
  movePageById: (id: string, dir: -1 | 1) => void;
  reorderPages: (from: number, to: number) => void;
  renamePage: (id: string, name: string) => void;
  setPageBackground: (
    id: string,
    paint: {
      bg?: string;
      bgGradient?: Gradient;
      bgImage?: string;
      bgImageFit?: "cover" | "contain";
      bgImageX?: number;
      bgImageY?: number;
      clipContent?: boolean;
    },
    live?: boolean,
  ) => void;
  setClipExport: (on: boolean) => void;
  /** Show/hide artwork that sits outside the page rectangle (view only). */
  setShowOutsidePage: (on: boolean) => void;
  setPageSize: (
    id: string,
    sizeId: SizeId,
    custom?: { w: number; h: number },
  ) => void;
  setAllPageSizes: (sizeId: SizeId, custom?: { w: number; h: number }) => void;
  alignPage: (
    edge: "left" | "right" | "center" | "top" | "middle" | "bottom",
  ) => void;
  undo: () => void;
  redo: () => void;
  commit: () => void;
}

function hasResolvedEditorAccess(
  state: Pick<
    EditorStore,
    | "hydrated"
    | "showcase"
    | "entitlementsResolved"
    | "entitlementsOwner"
    | "sessionOwner"
  >,
  owner: string,
): boolean {
  if (!state.hydrated) return false;
  if (state.showcase) return true;
  return (
    state.entitlementsResolved &&
    state.entitlementsOwner === owner &&
    state.sessionOwner === owner
  );
}

function projectSlice(s: ProjectSnapshot): ProjectSnapshot {
  return {
    version: s.version,
    nativeFormat: s.nativeFormat,
    nativeSourceProjectId: s.nativeSourceProjectId,
    editorSettings: s.editorSettings,
    transactionNo: s.transactionNo,
    pack: s.pack,
    licensedTemplateId: s.licensedTemplateId,
    name: s.name,
    theme: s.theme,
    orgName: s.orgName,
    pages: s.pages,
    id: s.id,
    createdAt: s.createdAt,
    defaultSize: s.defaultSize,
    // History entries need to remember which page was active so Undo/Redo
    // can restore it — see the field's doc comment on Project.
    activePageId: s.activePageId,
  };
}

const blank = createProject("official");

/**
 * Boot parameters — the marketing site embeds a LIVE editor as its product
 * preview:
 *
 *   /editor?template=official&showcase=1
 *
 * `template` selects the pack `createProject` boots with (anything unknown
 * falls back to "official"); `showcase=1` makes the whole session
 * non-persisting: no autosave, no explicit save, no draft, nothing written
 * to the visitor's storage. The visitor gets a fully interactive document
 * that vanishes with the tab — a real editor, not a screenshot.
 */
const BOOT_PARAMS =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : null;
const BOOT_SHOWCASE = BOOT_PARAMS?.get("showcase") === "1";
const BOOT_TEMPLATE = BOOT_PARAMS?.get("template") ?? "";
const BOOT_ADMIN_TEMPLATE = BOOT_PARAMS?.get("adminTemplate")?.trim() ?? "";

/**
 * The part of `page` (in document mm, page-relative) currently visible in the
 * canvas viewport. Used by centered inserts so new elements appear where the
 * author is looking. When the viewport is unknown (SSR, tests) or the page is
 * entirely off-screen, falls back to the whole page so insertion stays visible.
 */
function visiblePageRect(
  stage: HTMLElement | null,
  page: Page,
  _zoom?: number,
  _previewAll?: boolean,
): { x: number; y: number; w: number; h: number } {
  return (
    measuredVisiblePageRect(stage, page) || { x: 0, y: 0, ...pageSize(page) }
  );
}
function canvasStage() {
  return typeof document === "undefined"
    ? null
    : document.querySelector<HTMLElement>(".editor-canvas-stage");
}

const activePageOf = (s: { pages: Page[]; activePageId: string }) =>
  s.pages.find((p) => p.id === s.activePageId) || s.pages[0];

/**
 * Replace an element in place, wherever it sits in the page's group tree.
 *
 * Group members live in nested `children` arrays, so a plain `map` over
 * `page.elements` silently misses every element inside a group. Every mutation
 * that targets one element goes through here so grouped content stays editable.
 */
function mapElement(
  page: Page,
  id: string,
  fn: (el: CanvasEl) => CanvasEl,
): Page {
  const walk = (list: CanvasEl[]): CanvasEl[] =>
    list.map((el) =>
      el.id === id
        ? fn(el)
        : el.children?.length
          ? { ...el, children: walk(el.children) }
          : el,
    );
  return { ...page, elements: walk(page.elements) };
}

function mapElements(
  page: Page,
  ids: Set<string>,
  fn: (el: CanvasEl) => CanvasEl,
): Page {
  const walk = (list: CanvasEl[]): CanvasEl[] =>
    list.map((el) => {
      const next = ids.has(el.id) ? fn(el) : el;
      return next.children?.length
        ? { ...next, children: walk(next.children) }
        : next;
    });
  return { ...page, elements: walk(page.elements) };
}

/** Where an element lives: the array holding it and its index there. */
function locate(page: Page, id: string) {
  return findElement(page.elements, id);
}

/** Swap one sibling array (top-level or a group's children) for a restacked copy. */
function replaceSiblingList(page: Page, list: CanvasEl[], nextList: CanvasEl[]): Page {
  const rewrite = (nodes: CanvasEl[]): CanvasEl[] => {
    if (nodes === list) return nextList;
    return nodes.map((el) =>
      el.children?.length ? { ...el, children: rewrite(el.children) } : el,
    );
  };
  return { ...page, elements: rewrite(page.elements) };
}

function cloneWithFreshIds(el: CanvasEl): CanvasEl {
  const copy = clone(el);
  copy.id = uid(copy.type === "group" ? "grp" : "el");
  if (copy.children?.length)
    copy.children = copy.children.map(cloneWithFreshIds);
  return copy;
}

/** Element types a fade overlay applies to (the image family). */
const FADE_TYPES = new Set<CanvasEl["type"]>(["image", "logo", "qr"]);

/** Drop the fade key without mutating the original style object. */
function omitFade(style: ElStyle | undefined): ElStyle {
  const { fade: _fade, ...rest } = style ?? {};
  void _fade;
  return rest;
}

/** True when `ancestorId` contains `id` at any depth. */
function isDescendant(page: Page, ancestorId: string, id: string): boolean {
  const found = findElement(page.elements, ancestorId);
  if (!found?.el.children?.length) return false;
  return Boolean(findElement(found.el.children, id));
}

/**
 * Apply a flag to an element *and its whole subtree*.
 *
 * Folders (مجموعات) are containers: hiding or locking one must reach every
 * descendant, not just the direct children, or a folder nested inside a folder
 * would keep painting locked artwork on the canvas. The tree view indents to
 * any depth, so the cascade has to match that depth.
 */
/**
 * Toggle a mirror flag on an element *and its whole subtree*.
 *
 * Groups have no artwork of their own, but flipping the folder still has to
 * reach the children — otherwise flipping a group would look like it did
 * nothing at all.
 */
function flipTree(el: CanvasEl, key: "flipX" | "flipY"): CanvasEl {
  const flipped: CanvasEl = {
    ...el,
    style: { ...el.style, [key]: !el.style?.[key] },
  };
  if (el.children?.length)
    flipped.children = el.children.map((c) => flipTree(c, key));
  return flipped;
}

function cascadeFlag(
  el: CanvasEl,
  flag: "hidden" | "locked",
  value: boolean,
): CanvasEl {
  return {
    ...el,
    [flag]: value,
    ...(el.children?.length
      ? { children: el.children.map((c) => cascadeFlag(c, flag, value)) }
      : {}),
  };
}

/**
 * Element ids the user can actually click given the current group context.
 *
 * A group behaves as one element from outside, so clicking it selects the whole
 * group; stepping into it (double-click) narrows the picks to its children.
 */
function pickable(
  page: Page,
  enteredGroupId: string | null,
  id: string,
): boolean {
  if (!enteredGroupId) {
    // Top level only: children of a group are reached by entering it.
    return page.elements.some((e) => e.id === id);
  }
  return (
    isDescendant(page, enteredGroupId, id) ||
    page.elements.some((e) => e.id === id)
  );
}

/**
 * Smart default titles: the first «تقرير رسمي» becomes «تقرير رسمي 1», the
 * next free slot is picked, and an existing custom title wins the bare name.
 */
function nextDefaultName(base: string, existing: string[]): string {
  const taken = new Set(existing.map((name) => name.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return `${base} 1`;
  let n = 1;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

/** Normalises anything loaded from disk, a file, or an older schema version. */
function normalizeProject(incoming: ProjectSnapshot): ProjectSnapshot {
  const pages = incoming.pages?.length
    ? incoming.pages
    : createProject("blank").pages;
  incoming.transactionNo ||= "";
  pages.forEach((p) => {
    p.elements ||= [];
    // The editing-clip preference is a per-page EXCEPTION, never a default:
    // a page with no stored value follows the workspace preference
    // «إظهار العناصر خارج الصفحة» (`page-visibility.ts`), so opening an older
    // project can never silently start hiding artwork its author could see.
    // An explicit value — true or false — is the author's saved choice.
    if (p.bgGradient !== undefined)
      p.bgGradient = normalizeGradient(p.bgGradient);
    p.w = pageSize(p).w;
    p.h = pageSize(p).h;
    const size = pageSize(p);
    // Groups added a second level of elements; normalize elements at any depth
    // so a project written before groups existed loads unchanged.
    const normalizeEl = (el: CanvasEl) => {
      el.style ||= {};
      if (el.style.gradient !== undefined)
        el.style.gradient = normalizeGradient(el.style.gradient);
      if (el.style.crop !== undefined)
        el.style.crop = normalizeCrop(el.style.crop);
      el.opacity ??= 1;
      el.rotation ??= 0;
      el.name ||= TYPE_NAME[el.type] || "عنصر";
      // Imported projects carry image sources as plain strings; drop any that
      // could execute script before they reach the canvas or an export.
      if (el.src) el.src = safeImageSrc(el.src);
      if (el.children?.length) el.children.forEach(normalizeEl);
      if (!incoming.nativeFormat) constrainElement(el, size);
    };
    p.elements.forEach(normalizeEl);
    if (!incoming.nativeFormat) normalizeZ(p);
  });
  return {
    version: incoming.version || 2,
    nativeFormat: incoming.nativeFormat,
    nativeSourceProjectId: incoming.nativeSourceProjectId,
    embeddedFonts: incoming.embeddedFonts,
    editorSettings: incoming.editorSettings,
    name: incoming.name || "تقرير",
    theme: incoming.theme || "official",
    orgName: incoming.orgName || "",
    transactionNo: incoming.transactionNo || "",
    pages,
    id: incoming.id,
    createdAt: incoming.createdAt,
    updatedAt: incoming.updatedAt,
    // Preserved so undo/redo can restore the page the user was on — see
    // Project.activePageId. Fresh loads (library/template open) never set
    // it, so applyProject still falls back to the first page for those.
    activePageId: incoming.activePageId,
    defaultSize: incoming.defaultSize || "a4-portrait",
    pack: incoming.pack,
    licensedTemplateId:
      typeof incoming.licensedTemplateId === "string"
        ? incoming.licensedTemplateId.slice(0, 120)
        : undefined,
    favorite: incoming.favorite,
    thumbnail: incoming.thumbnail,
    nsqOrigin: incoming.nsqOrigin,
  };
}

let librarySyncTimer: ReturnType<typeof setTimeout> | null = null;

/** Push the account catalog after local edits. Never runs for a guest.
 * Offline-first: enqueues a deduplicated sync operation so reconnect automatically pushes.
 */
function queueLibrarySync() {
  if (!hasSignedInOwner()) return;
  if (librarySyncTimer) clearTimeout(librarySyncTimer);
  librarySyncTimer = setTimeout(() => {
    librarySyncTimer = null;
    const state = useEditor.getState();
    void (async () => {
      const removedAssets = await getSetting<Array<{ id: string; at: number }>>(
        "libraryRemovedAssets",
      );
      const removedFolders = await getSetting<Array<{ id: string; at: number }>>(
        "libraryRemovedFolders",
      );
      const { toCatalog } = await import("@/lib/storage/library-client");
      const catalog = toCatalog({
        folders: state.assetFolders,
        assets: state.assets,
        customItems: state.customIcons,
        removedAssets: Array.isArray(removedAssets) ? removedAssets : [],
        removedFolders: Array.isArray(removedFolders) ? removedFolders : [],
      });
      // Enqueue for reliable offline sync (deduplicated)
      try {
        const { enqueueSync } = await import("@/lib/offline/sync-queue");
        await enqueueSync("library:catalog", catalog, { dedupeKey: "library:catalog", version: Date.now() });
        void import("@/lib/offline/workspace-cache").then(m=>void m.refreshWorkspaceCache());
      } catch {}
      // Best-effort immediate push when online
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        try { const { triggerSync } = await import("@/lib/offline/connectivity"); triggerSync(); } catch {}
        return;
      }
      try {
        const { pushLibraryCatalog } = await import("@/lib/storage/mirror");
        const ok = await pushLibraryCatalog(catalog);
        if (ok) {
          // On success the queue can drain; trigger connectivity sync to clean queue
          try { const { triggerSync } = await import("@/lib/offline/connectivity"); triggerSync(); } catch {}
        }
      } catch {}
    })();
  }, 800);
}

async function rememberLibraryRemoval(key: "libraryRemovedAssets" | "libraryRemovedFolders", id: string) {
  const current = await getSetting<Array<{ id: string; at: number }>>(key);
  const rows = Array.isArray(current) ? current : [];
  await setSetting(key, [...rows.filter((row) => row.id !== id), { id, at: Date.now() }].slice(-800));
}

export const useEditor = create<EditorStore>((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let savePaused = false;
  let activeSave: Promise<void> | null = null;
  let activeSaveGen = -1;
  let saveSessionGen = 0;
  let cleanSnapshot: ProjectSnapshot = projectSlice(blank);

  /** Debounced autosave. Kept off the render path: no store writes until it fires. */
  const scheduleSave = (delay = 900) => {
    // Store geometry is also used during SSR/unit checks; autosave is browser-only.
    if (typeof window === "undefined") return;
    if (get().showcase) return; // showcase boot: the document never persists
    if (!hasResolvedEditorAccess(get(), getStorageOwner())) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    disarmUnloadBypass();
    if (get().saveState !== "saving") set({ saveState: "dirty" });
    writeDraftSnapshot();
    if (savePaused) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get().saveNow();
    }, delay);
  };

  const HISTORY_LIMIT = 60;

  /** Document content equality (ignores UI-only activePageId/id metadata). */
  const sameDocumentContent = (a: ProjectSnapshot, b: ProjectSnapshot) =>
    a.pages === b.pages &&
    a.name === b.name &&
    a.theme === b.theme &&
    a.orgName === b.orgName &&
    a.editorSettings === b.editorSettings &&
    a.transactionNo === b.transactionNo &&
    a.defaultSize === b.defaultSize &&
    a.pack === b.pack &&
    a.licensedTemplateId === b.licensedTemplateId;

  let historyBatch = 0;
  const pushHistory = () => {
    if (historyBatch) return;
    const snapshot = projectSlice(get());
    const { past } = get();
    // Dedupe WITHOUT serialising: a commit that changes nothing (a blur after a
    // live edit already recorded its state, a double `commit()` after
    // `updateStyle`, or UI focus without content change) must not push a second
    // identical entry or mark a clean project dirty.
    if (past.length && sameDocumentContent(past[past.length - 1], snapshot)) {
      return;
    }
    const nextPast = [...past, snapshot];
    if (nextPast.length > HISTORY_LIMIT) nextPast.shift();
    set({ past: nextPast, future: [] });
    scheduleSave();
  };

  const applyProject = (
    incoming: ProjectSnapshot,
    extra: Partial<EditorStore> = {},
  ) => {
    const project = normalizeProject(incoming);
    // Prefer an explicit caller override, then the page the snapshot itself
    // remembers being on (undo/redo), then fall back to the first page for
    // a genuinely fresh load. Guard against a stale id pointing at a page
    // that no longer exists in this particular snapshot.
    const wanted = extra.activePageId || project.activePageId;
    const activePageId =
      (wanted && project.pages.some((p) => p.id === wanted)
        ? wanted
        : undefined) || project.pages[0]?.id;
    // Keep the persisted "current page" in step with every resolution path
    // (load, undo/redo, reset) so a reload reopens exactly where the author
    // stood — not merely where the last auto-save happened to land.
    if (activePageId) debounceSetting("activePageId", activePageId, 350);
    set({
      ...project,
      ...project.editorSettings,
      activePageId,
      selectedId: null,
      selectedIds: [],
      enteredGroupId: null,
      editingId: null,
      ...extra,
    });
  };

  /**
   * Replace the live document and announce a genuine opening to the workspace
   * camera. `applyProject` itself also serves undo/redo and therefore must stay
   * viewport-neutral; every create/open/import/reset path goes through this
   * wrapper instead.
   */
  const openProjectState = (
    incoming: ProjectSnapshot,
    extra: Partial<EditorStore> = {},
  ) =>
    applyProject(incoming, {
      ...extra,
      documentRevision: get().documentRevision + 1,
    });

  const restoreFonts = async (project: Project) => {
    if (!project.embeddedFonts?.length) return;
    const owner = getStorageOwner();
    const { loadEmbeddedFonts } = await import("../nsq/fonts");
    await loadEmbeddedFonts(
      project.embeddedFonts,
      (family) => get().registerFont(family, "خط من ملف نَسَق"),
      () => getStorageOwner() === owner,
    );
  };

  /**
   * Undo/Redo restore — keep the author's selection when the ids still exist
   * in the restored snapshot (Figma-class behaviour: undoing a move must not
   * deselect the thing you just moved). Ids that the snapshot no longer
   * contains drop out; an empty result falls back to the cleared selection
   * `applyProject` installs.
   */
  const restoreSelectionExtra = (
    incoming: ProjectSnapshot,
  ): Partial<EditorStore> => {
    const s = get();
    const alive = new Set<string>();
    const walk = (list: CanvasEl[]) => {
      for (const el of list) {
        alive.add(el.id);
        if (el.children?.length) walk(el.children);
      }
    };
    for (const page of incoming.pages) walk(page.elements);
    const kept = s.selectedIds.filter((id) => alive.has(id));
    const primary =
      s.selectedId && alive.has(s.selectedId)
        ? s.selectedId
        : kept.length
          ? kept[kept.length - 1]
          : null;
    const keptGroup =
      s.enteredGroupId && alive.has(s.enteredGroupId) ? s.enteredGroupId : null;
    return {
      selectedIds: kept,
      selectedId: primary,
      enteredGroupId: keptGroup,
      embeddedFonts: s.embeddedFonts,
      nsqOrigin: s.nsqOrigin,
    };
  };

  const editorAccessReady = () =>
    hasResolvedEditorAccess(get(), getStorageOwner());
  const requireEditorAccess = () => {
    if (editorAccessReady()) return true;
    toast.error("جارٍ التحقق من الحساب والترخيص؛ أعد المحاولة بعد اكتمال التحميل", {
      id: "editor-access-not-ready",
    });
    return false;
  };

  /** Apply a batch of new positions as one undoable step.
   *
   * Align and distribute move several elements at once; writing each through
   * `updateElement` would push one history entry per element and make Undo
   * rewind them one at a time.
   */
  const applyPositions = (moves: { id: string; x: number; y: number }[]) => {
    const s = get();
    const page = activePageOf(s);
    if (!page) return;
    const byId = new Map(moves.map((m) => [m.id, m]));
    const walk = (list: CanvasEl[]): CanvasEl[] =>
      list.map((el) => {
        const move = byId.get(el.id);
        const next = move ? { ...el, x: move.x, y: move.y } : el;
        const withChildren = next.children?.length
          ? { ...next, children: walk(next.children) }
          : next;
        return withChildren;
      });
    set({
      pages: s.pages.map((p) =>
        p.id === page.id ? { ...p, elements: walk(p.elements) } : p,
      ),
    });
    pushHistory();
  };

  return {
    ...blank,
    transactionNo: blank.transactionNo ?? "",
    activePageId: blank.pages[0].id,
    documentRevision: 0,
    selectedId: null,
    selectedIds: [],
    enteredGroupId: null,
    editingId: null,
    zoom: 0.82,
    showGrid: false,
    showOutsidePage: SHOW_OUTSIDE_PAGE_DEFAULT,
    printGuides: { ...DEFAULT_PRINT_GUIDES },
    clipExport: true,
    snapGrid: true,
    snapElements: true,
    previewAll: true,
    focusMode: false,
    appearance: readStoredTheme() ?? "light",
    leftTab: "library",
    rightTab: "properties",
    leftOpen: false,
    rightOpen: false,
    leftCollapsed: false,
    rightCollapsed: false,
    layersOpen: false,
    reportToolsOpen: false,
    libraryOpen: false,
    toolsOpen: false,
    artboardGridCols: 4,
    pagesPanelHeight: PAGES_PANEL_DEFAULT,
    pagesRailCollapsed: false,
    pagesRailHidden: false,
    contextMenu: null,
    bubbleEnabled: true,
    bubbleOffset: null,
    exportOpen: false,
    exportPreset: null,
    pageManagerOpen: false,
    tablePickerOpen: false,
    saveState: "idle",
    savedAt: null,
    clockTick: 0,
    captureArmed: false,
    hydrated: false,
    showcase: BOOT_SHOWCASE,
    sessionOwner: null,
    entitlements: { ...LICENSE_ENTITLEMENTS.FREE },
    entitlementsResolved: false,
    entitlementsOwner: null,
    setEntitlements: (entitlements, owner = getStorageOwner()) => {
      if (owner !== getStorageOwner()) return;
      const before = get();
      if (before.hydrated && before.sessionOwner !== owner) return;
      const resolved = { ...entitlements };
      set({
        entitlements: resolved,
        entitlementsResolved: true,
        entitlementsOwner: owner,
      });

      const current = get();
      if (
        current.showcase ||
        !current.hydrated ||
        current.sessionOwner !== owner
      )
        return;
      const block = projectAccessBlock(current, resolved);
      if (!block) return;

      // A licence downgrade revokes the active document immediately. Keep the
      // saved project row available for a later re-licence, but remove its
      // contents and history from the live editor instead of leaving a writable
      // canvas whose next save would be refused.
      saveSessionGen += 1;
      activeSave = null;
      savePaused = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      clearDraftSnapshot();
      openProjectState(createProject("blank", current.theme), { zoom: current.zoom });
      const snap = projectSlice(get());
      cleanSnapshot = snap;
      set({
        past: [snap],
        future: [],
        saveState: "saved",
        savedAt: Date.now(),
      });
      void setSetting("activeProjectId", null);
      toast.error(
        block === "premium-template"
          ? "انتهى الوصول إلى هذا المستند؛ فعّل ترخيصًا مناسبًا لمتابعة العمل"
          : "يتجاوز هذا الملف حد صفحات خطتك الحالية",
        { id: "editor-current-document-access" },
      );
    },
    clipboard: null,
    styleClipboard: null,
    past: [],
    future: [],
    projects: [],
    projectsLoading: true,
    storage: { mode: "indexeddb", persistent: true },
    assets: [],
    assetFolders: [],
    assetFolderId: null,
    selectedAssetIds: [],
    assetsLoading: true,
    fontChoices: bundledFontChoices(),
    fontsProbed: false,
    customIcons: [],

    /**
     * Probe installed fonts on first editor open.
     *
     * Detection re-rasterises probe strings, so it is deferred until the author
     * actually needs the list rather than run during boot, and `fontsProbed`
     * keeps it to one run per session.
     */
    probeFonts: () => {
      if (get().fontsProbed) return;
      let detected: DetectedFont[] = [];
      try {
        detected = detectDeviceFonts();
      } catch {
        // A blocked canvas (privacy mode) leaves the bundled list intact.
        detected = [];
      }
      const uploaded = get().fontChoices.filter((f) => f.source === "uploaded");
      set({
        fontsProbed: true,
        fontChoices: mergeFontChoices(detected, uploaded),
      });
    },

    registerFont: (family, note) => {
      const trimmed = String(family || "").trim();
      if (!trimmed) return;
      const list = get().fontChoices.filter((f) => f.family !== trimmed);
      set({
        fontChoices: [
          ...list,
          { family: trimmed, note: note || "خط مرفوع", source: "uploaded" },
        ],
      });
    },

    resetUserScopedState: () => {
      clearUploadedFonts();
      saveSessionGen += 1;
      activeSave = null;
      savePaused = false;
      // Cancel any pending autosave first — it must not fire mid-reset and
      // write the outgoing session's document under the new owner.
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      // A fresh document keeps the editor shell functional for whoever is
      // here now (the editor is open to visitors); the previous account's
      // pages, library list, asset shelf and custom vectors are all dropped.
      openProjectState(createProject("official"), { zoom: get().zoom });
      cleanSnapshot = projectSlice(get());
      set({
        hydrated: false,
        sessionOwner: null,
        fontChoices: bundledFontChoices(),
        fontsProbed: false,
        projects: [],
        projectsLoading: true,
        assets: [],
        assetsLoading: true,
        assetFolders: [],
        assetFolderId: null,
        selectedAssetIds: [],
        customIcons: [],
        clipboard: null,
        styleClipboard: null,
        past: [],
        future: [],
        entitlements: { ...LICENSE_ENTITLEMENTS.FREE },
        entitlementsResolved: false,
        entitlementsOwner: null,
        saveState: "idle",
        savedAt: null,
      });
    },

    hydrate: async () => {
      /*
       * Showcase boot (?template=…&showcase=1): the marketing site embeds a
       * live editor as its product preview. Boot straight from the requested
       * pack — no owner, no library, no drafts, no persistence — and keep
       * the read-only asset shelf + fonts so template artwork resolves.
       * The regular hydration path below is left untouched.
       */
      if (get().showcase) {
        const ui = readUi();
        const appearance = readStoredTheme() ?? "light";
        applyStoredTheme();
        const zoom = typeof ui.zoom === "number" ? clampZoom(ui.zoom) : 0.82;
        try {
          let project: Project;
          if (BOOT_ADMIN_TEMPLATE) {
            const [{ getPublishedTemplateFn }, { publishedTemplateSeed }] =
              await Promise.all([
                import("@/lib/admin/functions"),
                import("@/lib/templates/published"),
              ]);
            const result = await getPublishedTemplateFn({
              data: { id: BOOT_ADMIN_TEMPLATE },
            });
            if (!result.ok) throw new Error(result.error);
            if (result.template.tier !== "free")
              throw new Error("القالب المميز يتطلب ترخيصًا");
            const seed = publishedTemplateSeed(result.template);
            const shell = createProject(
              seed.pack ?? "blank",
              seed.theme,
              seed.orgName,
            );
            project = {
              ...shell,
              ...seed,
              pack: seed.pack ?? shell.pack,
            };
          } else {
            const pack = PACKS.some((p) => p.id === BOOT_TEMPLATE)
              ? (BOOT_TEMPLATE as PackId)
              : "official";
            project = createProject(
              pack,
              pack === "eid" ? "eid" : "official",
              "",
            );
          }
          await restoreFonts(project);
          openProjectState(project, { zoom });
        } catch (error) {
          if (BOOT_ADMIN_TEMPLATE) {
            // Never substitute a different showcase document when a catalog
            // record is missing, unpublished or unavailable to the visitor.
            const empty = createProject("blank");
            await restoreFonts(empty);
            openProjectState(empty, { zoom });
            toast.error("تعذر تحميل المستند المميز من سجل القوالب المنشور");
            console.error("[editor] homepage catalog preview failed", error);
          }
        }
        set({
          hydrated: true,
          entitlementsResolved: true,
          entitlementsOwner: null,
          appearance,
          showcase: true,
          past: [projectSlice(get())],
          future: [],
          saveState: "saved",
          savedAt: Date.now(),
        });
        try {
          await get().refreshAssets();
        } catch {
          set({ assetsLoading: false });
        }
        return;
      }
      // Never read under the wrong identity: resolve the storage owner from
      // the live session BEFORE any library read. (With auth disabled this
      // pins the shared dev user, matching the server-side verifier.)
      let owner: string;
      try {
        const { syncStorageOwner } =
          await import("@/lib/auth/storage-owner-sync");
        owner = await syncStorageOwner();
      } catch {
        // Auth bridge unavailable (unit tests, exotic bundles): keep whatever
        // owner is already pinned — storage reads stay fail-closed.
        owner = getStorageOwner();
      }
      if (get().hydrated) {
        // Same identity → already loaded, nothing to do. Identity changed
        // without a page reload (popup sign-in on the same route) → drop the
        // previous session's data before loading the new owner's library.
        if (get().sessionOwner === owner) return;
        get().resetUserScopedState();
      }
      let entitlements: Record<FeatureId, boolean> = {
        ...LICENSE_ENTITLEMENTS.FREE,
      };
      let cachedGraceEntitlements: Record<FeatureId, boolean> | null = null;
      if (owner !== ANON_OWNER) {
        try {
          const { getLicenseStatusFn } =
            await import("@/lib/license/functions");
          const status = await getLicenseStatusFn();
          entitlements = status.entitlements ?? entitlements;
          // Cache validated entitlement for offline grace
          try {
            const { cacheEntitlement } = await import("@/lib/offline/entitlement-cache");
            await cacheEntitlement({
              ownerId: owner,
              entitlements,
              validatedAt: Date.now(),
              expiresAt: (status as unknown as { license?: { expiresAt?: string | null } })?.license?.expiresAt ?? (status as unknown as { expiresAt?: string | null })?.expiresAt ?? null,
              isAdmin: Boolean((status as unknown as Record<string, unknown>).isAdmin),
              isOwner: Boolean((status as unknown as Record<string, unknown>).isOwner),
              isSuspended: Boolean((status as unknown as Record<string, unknown>).isSuspended),
              hasLicense: Boolean((status as unknown as Record<string, unknown>).hasLicense),
              source: "server",
            });
          } catch {}
        } catch {
          // Offline or network failure: try cached grace entitlement
          try {
            const { getCachedEntitlement, isEntitlementValidOffline } = await import("@/lib/offline/entitlement-cache");
            const cached = await getCachedEntitlement(owner);
            if (cached && isEntitlementValidOffline(cached)) {
              entitlements = cached.entitlements;
              cachedGraceEntitlements = cached.entitlements;
            } else {
              // No valid cached entitlement — remain FREE but allow local offline editing
              entitlements = { ...LICENSE_ENTITLEMENTS.FREE };
            }
          } catch {
            entitlements = { ...LICENSE_ENTITLEMENTS.FREE };
          }
        }
      }
      // An account switch during the network round-trip invalidates both the
      // status response and any following reads. Do not hydrate the old scope.
      if (getStorageOwner() !== owner) return;
      set({
        sessionOwner: owner,
        entitlements,
        entitlementsResolved: true,
        entitlementsOwner: owner,
      });
      // If we fell back to cached grace, surface offline notice
      if (cachedGraceEntitlements) {
        console.info("[offline] using cached entitlement grace for", owner);
      }
      // Kick off connectivity monitor and workspace snapshot refresh (offline cache)
      try {
        void import("@/lib/offline/connectivity").then((m) => m.initConnectivity());
        void import("@/lib/offline/workspace-cache").then((m) => void m.refreshWorkspaceCache());
        void import("@/lib/offline/connectivity").then((m) => m.triggerSync());
      } catch {}
      const mode = storageMode();
      set({ storage: { mode, persistent: mode === "indexeddb" } });

      try {
        const ui = readUi();
        const legacy = localStorage.getItem(LEGACY_STORE_KEY);
        let list = await listProjects();
        // The pre-library autosave blob predates ownership tracking — only a
        // signed-in account may claim it, never a signed-out visitor.
        if (!list.length && legacy && hasSignedInOwner()) {
          try {
            const migrated = await migrateLegacyProject(JSON.parse(legacy));
            if (migrated) {
              list = await listProjects();
              toast.success("تم ترحيل مشروعك المحفوظ إلى مكتبة المشاريع");
            }
          } catch {
            /* a corrupt legacy blob must not block startup */
          }
        }
        const activeId =
          (await getSetting<string>("activeProjectId")) || ui.activeProjectId;
        // Freshest page the author was on — `setActivePage` records it even
        // when no edit has triggered a save since the switch.
        const activePageSetting = await getSetting<string>("activePageId");
        let active: ProjectSnapshot | null = activeId
          ? await getProject(activeId)
          : null;
        if (!active && list[0]?.id) {
          active = await getProject(list[0].id);
        }
        /*
         * Reload safety: a synchronous draft written while the page was being
         * torn down (beforeunload/pagehide) can be newer than the last
         * IndexedDB save. It wins only for the SAME owner and the SAME
         * project, and only when it really is newer — otherwise it is stale
         * noise from a session that saved fine.
         */
        const draft = readDraftSnapshot(owner);
        let restoredFromDraft = false;
        let restoredUnsavedDraft = false;
        let preDraftSnapshot: ProjectSnapshot | null = null;
        if (draft?.projectId && (!active || active.id !== draft.projectId)) {
          const byDraftId = await getProject(draft.projectId);
          if (byDraftId) active = byDraftId;
        }
        if (
          draft &&
          active &&
          draft.projectId === active.id &&
          draft.savedAt >= (active.updatedAt ?? 0)
        ) {
          preDraftSnapshot = clone(active);
          const merged: ProjectSnapshot = { ...active, ...draft.project };
          merged.activePageId =
            draft.activePageId || draft.project.activePageId;
          active = merged;
          restoredFromDraft = true;
        } else if (
          draft &&
          !draft.projectId &&
          draft.savedAt >= (active?.updatedAt ?? 0)
        ) {
          preDraftSnapshot = active ? clone(active) : projectSlice(blank);
          active = {
            ...draft.project,
            activePageId: draft.activePageId || draft.project.activePageId,
          };
          restoredFromDraft = true;
          restoredUnsavedDraft = true;
        }
        if (preDraftSnapshot) {
          cleanSnapshot = preDraftSnapshot;
        }
        const activeBlock = active
          ? projectAccessBlock(active, get().entitlements)
          : null;
        if (active && activeBlock) {
          // Never place an inaccessible saved file (or recovery draft) into the
          // live editor state. Its saved row remains in the owner's library so
          // restoring the entitlement can make it available again.
          active = null;
          restoredFromDraft = false;
          restoredUnsavedDraft = false;
          clearDraftSnapshot();
          await setSetting("activeProjectId", null).catch(() => undefined);
          toast.error(
            activeBlock === "premium-template"
              ? "المستند الأخير يتطلب ترخيصًا مناسبًا؛ افتح ملفًا متاحًا أو فعّل الترخيص"
              : "المستند الأخير يتجاوز حد صفحات خطتك الحالية؛ افتح ملفًا متاحًا أو فعّل الترخيص",
          );
        }
        // The shared preference is the only authority, including the default.
        const appearance = readStoredTheme() ?? "light";
        applyStoredTheme();

        /*
         * The inspector is now INDEPENDENT windows: the old "only one side at
         * a time" rule is gone (nextLeftOpen no longer yields to
         * nextRightOpen), so the author's three inspector windows plus the
         * library and element-tools panels come back exactly as they were.
         */
        const nextRightOpen =
          ui.rightOpen !== undefined ? Boolean(ui.rightOpen) : get().rightOpen;
        const nextLeftOpen =
          ui.leftOpen !== undefined ? Boolean(ui.leftOpen) : get().leftOpen;

        set({
          projects: list,
          projectsLoading: false,
          appearance,
          focusMode: Boolean(ui.focusMode),
          leftOpen: nextLeftOpen,
          rightOpen: nextRightOpen,
          leftCollapsed: Boolean(ui.leftCollapsed),
          rightCollapsed: Boolean(ui.rightCollapsed),
          layersOpen: Boolean(ui.layersOpen),
          reportToolsOpen: Boolean(ui.reportToolsOpen),
          libraryOpen: Boolean(ui.libraryOpen),
          toolsOpen: Boolean(ui.toolsOpen),
          artboardGridCols:
            typeof ui.artboardGridCols === "number"
              ? clamp(ui.artboardGridCols, 1, 8)
              : 4,
          previewAll: true,
          zoom: typeof ui.zoom === "number" ? clampZoom(ui.zoom) : 0.82,
          pagesPanelHeight: clampPagesHeight(
            typeof ui.pagesPanelHeight === "number"
              ? ui.pagesPanelHeight
              : PAGES_PANEL_DEFAULT,
          ),
          pagesRailCollapsed: Boolean(ui.pagesRailCollapsed),
          pagesRailHidden: Boolean(ui.pagesRailHidden),
          bubbleEnabled: ui.bubble !== false,
          bubbleOffset:
            ui.bubbleOffset &&
            typeof ui.bubbleOffset.dx === "number" &&
            typeof ui.bubbleOffset.dy === "number"
              ? { dx: ui.bubbleOffset.dx, dy: ui.bubbleOffset.dy }
              : null,
          showGrid: ui.showGrid ?? WORKSPACE_TOGGLE_DEFAULTS.showGrid,
          showOutsidePage: normalizeShowOutsidePage(ui.showOutsidePage),
          snapGrid: ui.snapGrid ?? WORKSPACE_TOGGLE_DEFAULTS.snapGrid,
          snapElements:
            ui.snapElements ?? WORKSPACE_TOGGLE_DEFAULTS.snapElements,
          printGuides: {
            ...DEFAULT_PRINT_GUIDES,
            ...(ui.printGuides ?? {}),
          },
        });
        if (active) {
          await restoreFonts(active);
          if (getStorageOwner() === owner && get().sessionOwner === owner)
            openProjectState(active, {
              zoom: get().zoom,
              ...(restoredUnsavedDraft ? { id: undefined } : {}),
              ...(activePageSetting && !restoredFromDraft
                ? { activePageId: activePageSetting }
                : {}),
            });
          if (restoredFromDraft) {
            toast.success(
              "تمت استعادة آخر تعديلات غير محفوظة بعد إعادة التحميل",
            );
            // The restored draft IS the current document — mark it dirty so
            // the next auto-save makes the recovery durable in IndexedDB.
            set({ saveState: "dirty" });
          }
        } else if (
          activePageSetting &&
          get().pages.some((p) => p.id === activePageSetting)
        ) {
          set({ activePageId: activePageSetting });
        }
      } catch {
        set({ projectsLoading: false });
      }

      // The asset shelf is independent of the project load: a corrupt or empty
      // project list must still leave the author's saved logos reachable.
      try {
        await get().refreshAssets();
      } catch {
        set({ assetsLoading: false });
      }

      const folders = await getSetting<AssetFolder[]>("assetFolders");
      set({ assetFolders: Array.isArray(folders) ? folders : [] });

      // Author-added vector icons/dividers live beside the asset shelf: same
      // durability, but stored as SVG markup so they stay vector on the page.
      const custom = await getSetting<CustomLibraryItem[]>("customLibrary");
      /*
       * Rows written before SVG sanitising existed are still on disk (and in
       * the account catalog), so hydration scrubs them through the same
       * allow-list the importer and the renderer use. A stored icon is painted
       * inline in three different panels — none of them may be the first line
       * of defence.
       */
      set({
        customIcons: Array.isArray(custom)
          ? custom
              .filter(
                (item) =>
                  item &&
                  typeof item.svg === "string" &&
                  item.svg.includes("<svg"),
              )
              .map((item) => ({ ...item, svg: safeLibrarySvg(item.svg) }))
              .filter((item) => item.svg.includes("<svg"))
          : [],
      });

      document.documentElement.lang = "ar";
      document.documentElement.dir = "rtl";
      const recoveredDirty = get().saveState === "dirty";
      const snap = projectSlice(get());
      if (!recoveredDirty) {
        cleanSnapshot = snap;
      }
      set({
        hydrated: true,
        past: [snap],
        future: [],
        saveState: recoveredDirty ? "dirty" : "saved",
        savedAt: Date.now(),
      });
      if (recoveredDirty) scheduleSave(400);
    },

    refreshProjects: async () => {
      if (!editorAccessReady()) return;
      const owner = getStorageOwner();
      const sessionOwner = get().sessionOwner;
      set({ projectsLoading: true });
      const list = await listProjects();
      // An auth transition can finish while IndexedDB is resolving. Never let
      // the previous owner's response repopulate the newly active session.
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      set({ projects: list, projectsLoading: false });
    },

    refreshAssets: async () => {
      const owner = getStorageOwner();
      const sessionOwner = get().sessionOwner;
      const assets = await listAssets();
      // Asset shelves are owner-scoped just like projects; discard stale reads
      // after a popup login/logout or an in-tab account switch.
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      set({ assets, assetsLoading: false });

      if (hasSignedInOwner()) {
        const syncSession = get().sessionOwner;
        void import("@/lib/storage/library-client")
          .then(async ({ reconcileAccountLibrary }) => {
            const removedAssets = await getSetting<Array<{ id: string; at: number }>>(
              "libraryRemovedAssets",
            );
            const removedFolders = await getSetting<Array<{ id: string; at: number }>>(
              "libraryRemovedFolders",
            );
            const live = get();
            if (getStorageOwner() !== owner || live.sessionOwner !== syncSession) return;
            const reconciled = await reconcileAccountLibrary({
              folders: live.assetFolders,
              assets: live.assets,
              customItems: live.customIcons,
              removedAssets: Array.isArray(removedAssets) ? removedAssets : [],
              removedFolders: Array.isArray(removedFolders) ? removedFolders : [],
            });
            if (!reconciled || getStorageOwner() !== owner || get().sessionOwner !== syncSession) {
              return;
            }
            // The cloud catalog is scrubbed server-side; this is the same
            // allow-list applied again so a payload written by any other path
            // can never reach the panels unsanitised.
            const customItems = reconciled.customItems
              .map((item) => ({ ...item, svg: safeLibrarySvg(item.svg) }))
              .filter((item) => item.svg.includes("<svg"));
            set({
              assets: reconciled.assets,
              assetFolders: reconciled.folders,
              customIcons: customItems,
            });
            await setSetting("assetFolders", reconciled.folders);
            await setSetting("customLibrary", customItems);
            await setSetting("libraryRemovedAssets", reconciled.removedAssets);
            await setSetting("libraryRemovedFolders", reconciled.removedFolders);
          })
          .catch(() => undefined);
      }
    },

    addAsset: async (asset) => {
      try {
        const saved = await saveAsset(asset);
        set({
          assets: [saved, ...get().assets.filter((a) => a.id !== saved.id)],
        });
        const owner = getStorageOwner();
        // Mirror the bytes into object storage when a bucket is configured.
        // Deliberately not awaited and self-swallowing: the library stays
        // local-first, so a storage outage must never delay or fail the save
        // the author just made.
        void import("@/lib/storage/mirror")
          .then(async ({ mirrorAssetToStorage }) => {
            const remoteId = await mirrorAssetToStorage({
              name: saved.name,
              src: saved.src,
              w: saved.w,
              h: saved.h,
              projectId: get().id ?? null,
            });
            if (remoteId && getStorageOwner() === owner) {
              const withRemote = await saveAsset({ ...saved, remoteId });
              if (getStorageOwner() === owner) {
                set({
                  assets: get().assets.map((a) =>
                    a.id === saved.id ? withRemote : a,
                  ),
                });
                queueLibrarySync();
              }
            }
          })
          .catch(() => null);
        queueLibrarySync();
        return saved;
      } catch {
        // A full or unavailable store must not lose the element the author is
        // placing right now — only the "save for later" half fails.
        toast.error("تعذر حفظ العنصر في المكتبة", {
          description:
            "قد تكون مساحة التخزين ممتلئة. العنصر أُضيف إلى الصفحة على أي حال.",
        });
        return null;
      }
    },

    removeAsset: async (id) => {
      const target = get().assets.find((a) => a.id === id);
      await removeAsset(id);
      set({ assets: get().assets.filter((a) => a.id !== id) });
      if (target) await rememberLibraryRemoval("libraryRemovedAssets", target.remoteId || target.id);
      const remoteId = target?.remoteId || target?.id || id;
      if (remoteId && hasSignedInOwner()) {
        void import("@/lib/storage/mirror")
          .then(({ removeRemoteAsset }) => removeRemoteAsset(remoteId))
          .catch(() => false);
      }
      queueLibrarySync();
    },

    removeAssets: async (ids) => {
      // Resolve the EXACT entities first: only ids that are real assets are
      // deleted. A folder id (or a stale id) that slipped into the selection
      // is ignored, so a batch can never remove a folder or its parent.
      const known = new Set(get().assets.map((a) => a.id));
      const folderIds = new Set(get().assetFolders.map((f) => f.id));
      const doomed = new Set(
        ids.filter((id) => known.has(id) && !folderIds.has(id)),
      );
      if (!doomed.size) return;
      const targets = get().assets.filter((a) => doomed.has(a.id));
      // One operation: every selected row is deleted, folders are never
      // touched (deleting nested items must not cascade to their folder).
      await Promise.all([...doomed].map((id) => removeAsset(id)));
      set((state) => ({
        assets: state.assets.filter((a) => !doomed.has(a.id)),
        selectedAssetIds: state.selectedAssetIds.filter(
          (id) => !doomed.has(id),
        ),
      }));
      if (hasSignedInOwner()) {
        void import("@/lib/storage/mirror")
          .then(({ removeRemoteAsset }) =>
            Promise.all(
              targets.map((t) => removeRemoteAsset(t.remoteId || t.id)),
            ),
          )
          .catch(() => undefined);
      }
      await Promise.all(
        targets.map((target) =>
          rememberLibraryRemoval("libraryRemovedAssets", target.remoteId || target.id),
        ),
      );
      queueLibrarySync();
    },

    selectAssets: (ids) => set({ selectedAssetIds: [...new Set(ids)] }),

    renameAsset: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await renameAssetRow(id, trimmed);
      set({
        assets: get().assets.map((a) =>
          a.id === id ? { ...a, name: trimmed } : a,
        ),
      });
      queueLibrarySync();
    },

    setAssetFolder: (id) => set({ assetFolderId: id, selectedAssetIds: [] }),
    toggleAssetSelect: (id) =>
      set((state) => ({
        selectedAssetIds: state.selectedAssetIds.includes(id)
          ? state.selectedAssetIds.filter((item) => item !== id)
          : [...state.selectedAssetIds, id],
      })),
    clearAssetSelection: () => set({ selectedAssetIds: [] }),
    createAssetFolder: async (name, parentId) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const folder = {
        id: uid("folder"),
        name: trimmed,
        createdAt: Date.now(),
        parentId: parentId ?? null,
      };
      const folders = [...get().assetFolders, folder];
      set({ assetFolders: folders });
      await setSetting("assetFolders", folders);
      queueLibrarySync();
    },
    renameAssetFolder: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const folders = get().assetFolders.map((folder) =>
        folder.id === id ? { ...folder, name: trimmed } : folder,
      );
      set({ assetFolders: folders });
      await setSetting("assetFolders", folders);
      queueLibrarySync();
    },
    deleteAssetFolder: async (id) => {
      const target = get().assetFolders.find((folder) => folder.id === id);
      // Re-parent (never cascade-delete) nested folders: removing a folder
      // lifts its children one level up, so no parent above the target and no
      // sibling subtree is ever destroyed by accident.
      const parentId = target?.parentId ?? null;
      const folders = get()
        .assetFolders.filter((folder) => folder.id !== id)
        .map((folder) =>
          folder.parentId === id ? { ...folder, parentId } : folder,
        );
      // Items inside the removed folder move up to its parent (never deleted);
      // only those rows are rewritten — unrelated resources stay untouched.
      const lifted = new Set<string>();
      const assets = get().assets.map((asset) => {
        if (asset.folderId !== id) return asset;
        lifted.add(asset.id);
        return { ...asset, folderId: parentId };
      });
      await Promise.all(
        assets
          .filter((asset) => lifted.has(asset.id))
          .map((asset) => saveAsset(asset)),
      );
      set({
        assetFolders: folders,
        assets,
        assetFolderId: get().assetFolderId === id ? null : get().assetFolderId,
        selectedAssetIds: [],
      });
      await setSetting("assetFolders", folders);
      await rememberLibraryRemoval("libraryRemovedFolders", id);
      queueLibrarySync();
    },
    moveAssetsToFolder: async (ids, folderId) => {
      const selected = new Set(ids);
      const assets = get().assets.map((asset) =>
        selected.has(asset.id) ? { ...asset, folderId } : asset,
      );
      await Promise.all(
        assets
          .filter((asset) => selected.has(asset.id))
          .map((asset) => saveAsset(asset)),
      );
      set({ assets, selectedAssetIds: [] });
      queueLibrarySync();
    },

    duplicateLibrary: async (assetIds, folderIds = []) => {
      const state = get();
      const { planLibraryDuplicate } = await import("@/lib/storage/library-sync");
      const plan = planLibraryDuplicate({
        folders: state.assetFolders,
        assets: state.assets.map((asset) => ({
          id: asset.id,
          remoteId: asset.remoteId ?? null,
          name: asset.name,
          folderId: asset.folderId ?? null,
          w: asset.w,
          h: asset.h,
          addedAt: asset.addedAt,
        })),
        assetIds,
        folderIds,
      });
      if (!plan.assets.length && !plan.folders.length) return;
      const sourceById = new Map(state.assets.map((asset) => [asset.id, asset]));
      const copies: Asset[] = [];
      for (const asset of plan.assets) {
        const source = sourceById.get(asset.sourceId);
        if (!source?.src) continue;
        const saved = await saveAsset({
          id: asset.id,
          name: asset.name,
          src: source.src,
          w: source.w,
          h: source.h,
          folderId: asset.folderId,
          addedAt: asset.addedAt,
        });
        copies.push(saved);
      }
      const folders = [...state.assetFolders, ...plan.folders];
      set({
        assetFolders: folders,
        assets: [...copies, ...get().assets],
        selectedAssetIds: copies.map((asset) => asset.id),
      });
      await setSetting("assetFolders", folders);
      queueLibrarySync();
      const owner = getStorageOwner();
      const sources = plan.assets
        .filter((asset) => asset.sourceRemoteId && copies.some((copy) => copy.id === asset.id))
        .map((asset) => ({
          copyId: asset.id,
          sourceRemoteId: asset.sourceRemoteId as string,
        }));
      if (sources.length && hasSignedInOwner()) {
        void import("@/lib/storage/mirror")
          .then(async ({ copyRemoteAssets, mirrorAssetToStorage }) => {
            const copied = await copyRemoteAssets(sources.map((row) => row.sourceRemoteId));
            const bySource = new Map(copied.map((row) => [row.sourceId, row.remoteId]));
            for (const row of sources) {
              if (getStorageOwner() !== owner) return;
              const remoteId = bySource.get(row.sourceRemoteId);
              const local = get().assets.find((asset) => asset.id === row.copyId);
              if (!local) continue;
              if (remoteId) {
                const updated = await saveAsset({ ...local, remoteId });
                if (getStorageOwner() === owner) {
                  set({
                    assets: get().assets.map((asset) => (asset.id === local.id ? updated : asset)),
                  });
                }
              } else {
                const mirrored = await mirrorAssetToStorage({
                  name: local.name,
                  src: local.src,
                  w: local.w,
                  h: local.h,
                  projectId: null,
                });
                if (mirrored && getStorageOwner() === owner) {
                  const updated = await saveAsset({ ...local, remoteId: mirrored });
                  set({
                    assets: get().assets.map((asset) => (asset.id === local.id ? updated : asset)),
                  });
                }
              }
            }
            if (getStorageOwner() === owner) queueLibrarySync();
          })
          .catch(() => undefined);
      }
    },

    importLibraryPlan: async (plan) => {
      // Folders first: keep the plan's exact ids — the assets below reference
      // them, and re-minting ids here is what used to orphan the whole import.
      const folders = [...get().assetFolders];
      const knownIds = new Set(folders.map((folder) => folder.id));
      const knownNames = new Map(
        folders.map((folder) => [folder.name, folder.id]),
      );
      // Plan folder ids folded into an existing same-named folder: assets
      // referencing the plan's id must follow the fold, not fall through to
      // the default folder below.
      const folderAliases = new Map<string, string>();
      for (const folder of plan.folders) {
        if (knownIds.has(folder.id)) continue;
        // Name collision with a folder created outside the plan (same merge
        // rule `planLibraryImport` applies): reuse it rather than duplicate.
        const byName = knownNames.get(folder.name);
        if (byName) {
          folderAliases.set(folder.id, byName);
          continue;
        }
        folders.push(folder);
        knownIds.add(folder.id);
        knownNames.set(folder.name, folder.id);
      }
      // Belt-and-braces: a plan built before normalisation existed (or a
      // hand-rolled one) may reference the default folder without shipping
      // it. Assets must never land in a folder that doesn't exist.
      const unresolved = plan.assets.some((asset) => {
        const wanted =
          (asset.folderId && folderAliases.get(asset.folderId)) ||
          asset.folderId;
        return wanted != null && !knownIds.has(wanted);
      });
      if (unresolved && !knownIds.has(DEFAULT_FOLDER_ID)) {
        folders.push({
          id: DEFAULT_FOLDER_ID,
          name: DEFAULT_FOLDER_NAME,
          createdAt: Date.now(),
        });
        knownIds.add(DEFAULT_FOLDER_ID);
      }

      // Persist rows first; `saveAsset` mints an id per call, so each planned
      // entry becomes exactly one stored asset (failures are counted, not
      // fatal — a full shelf must not lose the rest of the import).
      let added = 0;
      let failed = 0;
      const savedRows: Asset[] = [];
      for (const asset of plan.assets) {
        const wanted =
          (asset.folderId && folderAliases.get(asset.folderId)) ||
          asset.folderId ||
          null;
        const folderId =
          wanted && knownIds.has(wanted)
            ? wanted
            : // Unresolvable or absent → default folder when we have one,
              // otherwise root (still reachable under «الكل»).
              knownIds.has(DEFAULT_FOLDER_ID)
              ? DEFAULT_FOLDER_ID
              : null;
        try {
          savedRows.push(
            await saveAsset({
              // Keep the planned id while it is free: a round-trip of the same
              // library file restores the exact identities, not fresh ones.
              ...(asset.id &&
              !savedRows.some((row) => row.id === asset.id) &&
              !get().assets.some((row) => row.id === asset.id)
                ? { id: asset.id }
                : {}),
              name: asset.name,
              src: asset.src,
              w: asset.w,
              h: asset.h,
              folderId,
              addedAt: asset.addedAt || Date.now(),
            }),
          );
          added += 1;
        } catch {
          failed += 1;
        }
      }

      // One atomic update: folder chips and every imported asset render in
      // the same commit, and the view jumps to «الكل» so whatever just
      // arrived is immediately visible.
      set({
        assetFolders: folders,
        assets: [...savedRows, ...get().assets],
        assetFolderId: null,
        selectedAssetIds: [],
      });
      await setSetting("assetFolders", folders);
      queueLibrarySync();
      if (savedRows.length && hasSignedInOwner()) {
        const owner = getStorageOwner();
        void import("@/lib/storage/mirror")
          .then(async ({ mirrorAssetToStorage }) => {
            for (const row of savedRows) {
              if (getStorageOwner() !== owner) return;
              const remoteId = await mirrorAssetToStorage({
                name: row.name,
                src: row.src,
                w: row.w,
                h: row.h,
                projectId: get().id ?? null,
              });
              if (remoteId && getStorageOwner() === owner) {
                const updated = await saveAsset({ ...row, remoteId });
                if (getStorageOwner() === owner) {
                  set({
                    assets: get().assets.map((a) =>
                      a.id === row.id ? updated : a,
                    ),
                  });
                }
              }
            }
            queueLibrarySync();
          })
          .catch(() => undefined);
      }
      return { added, failed };
    },

    createProject: async (pack, theme) => {
      if (!requireEditorAccess()) return false;
      const initial = get();
      if (requiresPremiumPack(pack, initial.entitlements)) {
        toast.error("هذا القالب متاح ضمن النسخة الكاملة", {
          description:
            "يمكنك استكشافه من صفحة القوالب وطلب النسخة المناسبة لجهتك.",
        });
        return false;
      }
      const owner = getStorageOwner();
      const sessionOwner = initial.sessionOwner;
      if (
        hasLeaveGuard() &&
        !initial.showcase &&
        hasUnsavedChanges(get().saveState)
      ) {
        const allowed = await requestLeave();
        if (
          !allowed ||
          getStorageOwner() !== owner ||
          get().sessionOwner !== sessionOwner ||
          !editorAccessReady()
        )
          return false;
      }
      let savedProjects = get().projects;
      if (!get().showcase && !get().entitlements.unlimited_projects) {
        try {
          savedProjects = await listProjects();
        } catch {
          toast.error("تعذر التحقق من مساحة المشاريع المحفوظة");
          return false;
        }
        if (
          getStorageOwner() !== owner ||
          get().sessionOwner !== sessionOwner
        )
          return false;
        const live = get();
        if (requiresPremiumPack(pack, live.entitlements)) {
          toast.error("هذا القالب متاح ضمن النسخة الكاملة");
          return false;
        }
        if (exceedsSavedProjectLimit(savedProjects.length, live.entitlements)) {
          toast.error("اكتملت مساحة تجربة المحرر", {
            description:
              "يتضمن العرض مشروعاً واحداً. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
          });
          return false;
        }
      }
      const current = get();
      if (requiresPremiumPack(pack, current.entitlements)) {
        toast.error("هذا القالب متاح ضمن النسخة الكاملة");
        return false;
      }
      const project = createProject(
        pack,
        theme || (pack === "eid" ? "eid" : "official"),
        current.orgName,
      );
      // Smart auto-increment: «تقرير رسمي 1», «تقرير رسمي 2», … while a
      // custom-named document never collides with an existing title.
      project.name = nextDefaultName(
        project.name,
        savedProjects.map((item) => item.name),
      );
      // Showcase boot: the document is interactive but never reaches the
      // visitor's storage — it exists in memory until the tab closes.
      const saved = current.showcase ? project : await saveProject(project);
      if (
        !current.showcase &&
        (getStorageOwner() !== owner ||
          get().sessionOwner !== sessionOwner ||
          !editorAccessReady())
      )
        return false;
      const savedBlock = current.showcase
        ? null
        : projectAccessBlock(saved, get().entitlements);
      const projectLimitChanged =
        !current.showcase &&
        !get().entitlements.unlimited_projects &&
        exceedsSavedProjectLimit(savedProjects.length, get().entitlements);
      if (savedBlock || projectLimitChanged) {
        if (saved.id && getStorageOwner() === owner)
          await removeProject(saved.id).catch(() => undefined);
        toast.error(
          savedBlock
            ? "تغيّرت صلاحيات الترخيص أثناء إنشاء المشروع؛ لم يتم فتحه"
            : "اكتملت مساحة المشاريع في الخطة الحالية؛ لم يتم إنشاء المشروع",
        );
        return false;
      }
      saveSessionGen += 1;
      activeSave = null;
      savePaused = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      clearDraftSnapshot();
      openProjectState(saved, { zoom: 0.82 });
      const snap = projectSlice(get());
      cleanSnapshot = snap;
      set({
        past: [snap],
        future: [],
        saveState: "saved",
        savedAt: Date.now(),
      });
      if (!get().showcase) {
        await setSetting("activeProjectId", saved.id);
        try {
          const { enqueueSync } = await import("@/lib/offline/sync-queue");
          await enqueueSync("project:create", saved, { dedupeKey: `project:create:${saved.id}`, version: saved.updatedAt });
          void import("@/lib/offline/workspace-cache").then(m=>void m.refreshWorkspaceCache());
          void import("@/lib/offline/asset-cache").then(m=>{ void m.cacheProjectAssets(saved as never); void m.cacheProjectFonts(saved as never); });
          void import("@/lib/offline/connectivity").then(m=>m.triggerSync());
        } catch {}
        await get().refreshProjects();
      }
      return true;
    },

    createDocument: async (project, options) => {
      if (!requireEditorAccess()) return false;
      const requestOwner = getStorageOwner();
      const initial = get();
      const requestSessionOwner = initial.sessionOwner;
      const validateProjectAccess = () => {
        const entitlements = get().entitlements;
        if (
          requiresPremiumPack(project.pack, entitlements) ||
          requiresLicensedTemplate(project.licensedTemplateId, entitlements)
        ) {
          toast.error("هذا القالب متاح ضمن النسخة الكاملة", {
            description:
              "يمكنك استكشافه من صفحة القوالب وطلب النسخة المناسبة لجهتك.",
          });
          return false;
        }
        if (exceedsProjectPageLimit(project.pages.length, entitlements)) {
          toast.error("وصلت إلى حد صفحات تجربة المحرر", {
            description:
              "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
          });
          return false;
        }
        return true;
      };
      if (!validateProjectAccess()) return false;

      if (
        hasLeaveGuard() &&
        !initial.showcase &&
        hasUnsavedChanges(get().saveState)
      ) {
        const allowed = await requestLeave();
        if (
          !allowed ||
          getStorageOwner() !== requestOwner ||
          get().sessionOwner !== requestSessionOwner ||
          !editorAccessReady()
        )
          return false;
      }

      // Preserve pending edits before counting the library or replacing the
      // current document when invoked outside the interactive leave guard.
      if (get().saveState === "dirty" || get().saveState === "saving") {
        await get().saveNow();
        if (
          get().saveState !== "saved" ||
          getStorageOwner() !== requestOwner ||
          get().sessionOwner !== requestSessionOwner
        )
          return false;
      }
      let current = get();
      if (!validateProjectAccess()) return false;
      let savedProjects = current.projects;
      if (!current.showcase && !current.entitlements.unlimited_projects) {
        try {
          savedProjects = await listProjects();
        } catch {
          toast.error("تعذر التحقق من مساحة المشاريع المحفوظة");
          return false;
        }
        if (
          getStorageOwner() !== requestOwner ||
          get().sessionOwner !== requestSessionOwner
        )
          return false;
        current = get();
        if (!validateProjectAccess()) return false;
        if (exceedsSavedProjectLimit(savedProjects.length, current.entitlements)) {
          toast.error("اكتملت مساحة تجربة المحرر", {
            description:
              "يتضمن العرض مشروعاً واحداً. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
          });
          return false;
        }
      }
      const incoming = normalizeProject({
        ...project,
        version: project.version || 2,
        name: options?.autoName
          ? nextDefaultName(
              project.name,
              savedProjects.map((item) => item.name),
            )
          : project.name,
        id: uid("proj"),
        createdAt: Date.now(),
        favorite: false,
        thumbnail: undefined,
        // A brand-new document has no .nsq file lineage of its own yet.
        nsqOrigin: undefined,
      });
      // Showcase boot: keep the new document in memory only (see createProject).
      const saved = current.showcase ? incoming : await saveProject(incoming);
      if (
        !current.showcase &&
        (getStorageOwner() !== requestOwner ||
          get().sessionOwner !== requestSessionOwner ||
          !editorAccessReady())
      )
        return false;
      const liveBlock = current.showcase
        ? null
        : projectAccessBlock(saved, get().entitlements);
      const projectLimitChanged =
        !current.showcase &&
        !get().entitlements.unlimited_projects &&
        exceedsSavedProjectLimit(savedProjects.length, get().entitlements);
      if (liveBlock || projectLimitChanged) {
        if (getStorageOwner() === requestOwner)
          await removeProject(saved.id!).catch(() => undefined);
        toast.error(
          liveBlock === "premium-template"
            ? "تغيّرت صلاحيات الترخيص أثناء إنشاء المستند؛ لم يتم فتحه"
            : liveBlock === "page-limit"
              ? "تغيّر حد صفحات الخطة أثناء إنشاء المستند؛ لم يتم فتحه"
              : "اكتملت مساحة المشاريع في الخطة الحالية؛ لم يتم إنشاء المستند",
        );
        return false;
      }
      saveSessionGen += 1;
      activeSave = null;
      savePaused = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      clearDraftSnapshot();
      openProjectState(saved, { zoom: get().zoom || 0.82 });
      const snap = projectSlice(get());
      cleanSnapshot = snap;
      set({
        past: [snap],
        future: [],
        saveState: "saved",
        savedAt: Date.now(),
      });
      if (!get().showcase) {
        await setSetting("activeProjectId", saved.id);
        try {
          const { enqueueSync } = await import("@/lib/offline/sync-queue");
          await enqueueSync("project:create", saved, { dedupeKey: `project:create:${saved.id}`, version: saved.updatedAt });
          void import("@/lib/offline/workspace-cache").then(m=>void m.refreshWorkspaceCache());
          void import("@/lib/offline/asset-cache").then(m=>{ void m.cacheProjectAssets(saved as never); void m.cacheProjectFonts(saved as never); });
          void import("@/lib/offline/connectivity").then(m=>m.triggerSync());
        } catch {}
        await get().refreshProjects();
      }
      return true;
    },

    openProject: async (id) => {
      if (!requireEditorAccess()) return false;
      const owner = getStorageOwner();
      const sessionOwner = get().sessionOwner;
      const sameOwner = () =>
        getStorageOwner() === owner && get().sessionOwner === sessionOwner;
      let project: Project | null;
      try {
        project = await getProject(id);
      } catch {
        if (sameOwner()) toast.error("تعذر قراءة المشروع المحفوظ");
        return false;
      }
      if (!sameOwner()) return false;
      if (!project) {
        toast.error("تعذر فتح المشروع");
        await get().refreshProjects();
        return false;
      }
      const denyBlockedProject = () => {
        const block = projectAccessBlock(project, get().entitlements);
        if (!block) return false;
        toast.error(
          block === "premium-template"
            ? "هذا المستند مبني على قالب يتطلب النسخة الكاملة"
            : "تجاوز هذا الملف حد صفحات خطتك الحالية",
          {
            description:
              block === "premium-template"
                ? "فعّل ترخيصًا مناسبًا لفتحه وتعديله."
                : "تسمح الخطة الحالية بثلاث صفحات لكل مشروع.",
          },
        );
        return true;
      };
      if (denyBlockedProject()) return false;
      if (
        hasLeaveGuard() &&
        !get().showcase &&
        hasUnsavedChanges(get().saveState)
      ) {
        const allowed = await requestLeave();
        if (!allowed || !sameOwner() || denyBlockedProject()) return false;
      }
      await restoreFonts(project);
      if (!sameOwner() || denyBlockedProject()) return false;
      saveSessionGen += 1;
      activeSave = null;
      savePaused = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      clearDraftSnapshot();
      openProjectState(project, { zoom: get().zoom || 0.82 });
      const snap = projectSlice(get());
      cleanSnapshot = snap;
      set({
        past: [snap],
        future: [],
        saveState: "saved",
        savedAt: Date.now(),
      });
      try {
        await setSetting("activeProjectId", project.id);
      } catch {
        // The document is open in memory even if the optional last-opened
        // preference cannot be persisted by this browser.
      }
      return true;
    },

    saveNow: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (get().showcase || !editorAccessReady()) return;
      if (activeSave && activeSaveGen === saveSessionGen) {
        await activeSave;
        return;
      }
      const gen = saveSessionGen;
      const requestOwner = getStorageOwner();
      const runSave = async () => {
        while (gen === saveSessionGen && getStorageOwner() === requestOwner) {
          const initial = get();
          if (!initial.pages?.length) return;
          const entitlements = initial.entitlements;
          if (exceedsProjectPageLimit(initial.pages.length, entitlements)) {
            set({ saveState: "error" });
            toast.error("لا يمكن حفظ مستند يتجاوز حد الصفحات في خطتك", {
              id: "editor-access-save-limit",
            });
            return;
          }
          if (
            requiresPremiumPack(initial.pack, entitlements) ||
            requiresLicensedTemplate(initial.licensedTemplateId, entitlements)
          ) {
            set({ saveState: "error" });
            toast.error("يتطلب حفظ هذا المستند ترخيصًا مناسبًا", {
              id: "editor-access-save-template",
            });
            return;
          }
          set({ saveState: "saving" });
          try {
            let captured: string | null = null;
            if (thumbnailCaptureDue()) {
              set({ captureArmed: true });
              await nextPaint();
              try {
                captured = await captureThumbnail();
              } finally {
                set({ captureArmed: false });
              }
              if (gen !== saveSessionGen || getStorageOwner() !== requestOwner)
                return;
            }
            const { uploadedFontSources } = await import("../nsq/fonts");
            const { collectFontFamilies } = await import("../nsq/format");
            if (gen !== saveSessionGen || getStorageOwner() !== requestOwner)
              return;
            const s = get();
            if (!s.pages?.length) return;
            if (exceedsProjectPageLimit(s.pages.length, s.entitlements)) {
              set({ saveState: "error" });
              toast.error("لا يمكن حفظ مستند يتجاوز حد الصفحات في خطتك", {
                id: "editor-access-save-limit",
              });
              return;
            }
            if (
              requiresPremiumPack(s.pack, s.entitlements) ||
              requiresLicensedTemplate(s.licensedTemplateId, s.entitlements)
            ) {
              set({ saveState: "error" });
              toast.error("يتطلب حفظ هذا المستند ترخيصًا مناسبًا", {
                id: "editor-access-save-template",
              });
              return;
            }
            const meta = s.projects.find((p) => p.id === s.id);
            const families = new Set(collectFontFamilies(s.pages));
            const embeddedFonts = [
              ...new Map(
                [...(s.embeddedFonts || []), ...uploadedFontSources()]
                  .filter((f) => families.has(f.family))
                  .map((f) => [f.family, f]),
              ).values(),
            ];
            const saved = await saveProject({
              ...projectSlice(s),
              embeddedFonts,
              editorSettings: {
                printGuides: s.printGuides,
                showGrid: s.showGrid,
                snapGrid: s.snapGrid,
                snapElements: s.snapElements,
                clipExport: s.clipExport !== false,
              },
              version: s.version,
              updatedAt: Date.now(),
              pack: s.pack ?? meta?.pack,
              favorite: meta?.favorite ?? s.favorite ?? false,
              thumbnail: captured ?? s.thumbnail ?? meta?.thumbnail,
              nsqOrigin: s.nsqOrigin,
            });
            if (gen !== saveSessionGen || getStorageOwner() !== requestOwner)
              return;
            const live = get();
            const changed =
              live.pages !== s.pages ||
              live.name !== s.name ||
              live.orgName !== s.orgName ||
              live.theme !== s.theme ||
              live.transactionNo !== s.transactionNo ||
              live.editorSettings !== s.editorSettings ||
              live.defaultSize !== s.defaultSize ||
              live.pack !== s.pack ||
              live.licensedTemplateId !== s.licensedTemplateId;
            await setSetting("activeProjectId", saved.id);
            if (gen !== saveSessionGen || getStorageOwner() !== requestOwner)
              return;
            set((state) => {
              const nextMeta = projectMeta(saved);
              const exists = state.projects.some((p) => p.id === saved.id);
              return {
                embeddedFonts,
                id: saved.id,
                createdAt: saved.createdAt,
                projects: exists
                  ? state.projects.map((p) =>
                      p.id === saved.id ? nextMeta : p,
                    )
                  : [nextMeta, ...state.projects],
              };
            });
            if (changed) {
              writeDraftSnapshot();
              continue;
            }
            cleanSnapshot = projectSlice(get());
            set({
              saveState: "saved",
              savedAt: Date.now(),
            });
            clearDraftSnapshot();
            // Offline-first: enqueue sync, refresh workspace shell and cache assets/fonts for offline open
            try {
              const { enqueueSync } = await import("@/lib/offline/sync-queue");
              await enqueueSync("project:update", saved, { dedupeKey: `project:update:${saved.id}`, version: saved.updatedAt });
              void import("@/lib/offline/workspace-cache").then(m=>void m.refreshWorkspaceCache());
              void import("@/lib/offline/asset-cache").then(m=>{ void m.cacheProjectAssets(saved as never); void m.cacheProjectFonts(saved as never); });
              void import("@/lib/offline/connectivity").then(m=>m.triggerSync());
            } catch {}
            return;
          } catch (err) {
            console.error("[editor] autosave failed", err);
            if (gen === saveSessionGen && getStorageOwner() === requestOwner) {
              set({ saveState: "error" });
              toast.error("تعذر حفظ المشروع — تحقق من مساحة التخزين", {
                id: "editor-save-error",
              });
            }
            return;
          }
        }
      };
      activeSaveGen = gen;
      const pending = runSave().finally(() => {
        if (activeSave === pending) {
          activeSave = null;
        }
      });
      activeSave = pending;
      await pending;
    },

    cancelPendingSaveTimer: () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
    },

    pauseScheduledSave: () => {
      savePaused = true;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
    },

    resumeScheduledSave: () => {
      savePaused = false;
      const state = get().saveState;
      if (state === "dirty" || state === "error") scheduleSave(900);
    },

    isSavePaused: () => savePaused,

    discardUnsavedChanges: async () => {
      saveSessionGen += 1;
      activeSave = null;
      savePaused = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      clearDraftSnapshot();
      const current = get();
      const owner = getStorageOwner();
      const sessionOwner = current.sessionOwner;
      let persisted: Project | null = null;
      if (current.id) {
        try {
          persisted = await getProject(current.id);
        } catch {
          persisted = null;
        }
      }
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      const target = persisted ? clone(persisted) : clone(cleanSnapshot);
      if (persisted) {
        await restoreFonts(persisted);
        if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
          return;
      }
      applyProject(target, {
        zoom: get().zoom || 0.82,
        id: persisted ? persisted.id : target.id,
      });
      const snap = projectSlice(get());
      cleanSnapshot = snap;
      set({
        past: [snap],
        future: [],
        saveState: "saved",
        savedAt: persisted?.updatedAt ?? Date.now(),
      });
    },

    renameProject: async (id, name) => {
      if (!requireEditorAccess()) return;
      const owner = getStorageOwner();
      const sessionOwner = get().sessionOwner;
      const project = await getProject(id);
      if (!project) return;
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      const block = projectAccessBlock(project, get().entitlements);
      if (block) {
        toast.error("لا يمكن تعديل اسم مستند غير متاح في خطتك الحالية");
        return;
      }
      await saveProject({ ...project, name, id });
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      if (get().id === id) set({ name });
      try {
        const { enqueueSync } = await import("@/lib/offline/sync-queue");
        await enqueueSync("project:rename", { id, name, updatedAt: Date.now() }, { dedupeKey: `project:rename:${id}` });
        void import("@/lib/offline/workspace-cache").then(m=>void m.refreshWorkspaceCache());
        void import("@/lib/offline/connectivity").then(m=>m.triggerSync());
      } catch {}
      await get().refreshProjects();
    },

    toggleProjectFavorite: async (id) => {
      const owner = getStorageOwner();
      const sessionOwner = get().sessionOwner;
      const project = await getProject(id);
      if (!project) return;
      const favorite = !project.favorite;
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      await saveProject({ ...project, favorite, id });
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      if (get().id === id) set({ favorite });
      try {
        const { enqueueSync } = await import("@/lib/offline/sync-queue");
        await enqueueSync("project:favorite", { id, favorite, updatedAt: Date.now() }, { dedupeKey: `project:favorite:${id}` });
        void import("@/lib/offline/workspace-cache").then(m=>void m.refreshWorkspaceCache());
        void import("@/lib/offline/connectivity").then(m=>m.triggerSync());
      } catch {}
      await get().refreshProjects();
    },

    duplicateProject: async (id) => {
      if (!requireEditorAccess()) return;
      const s = get();
      const owner = getStorageOwner();
      const sessionOwner = s.sessionOwner;
      const source = await getProject(id);
      if (!source) {
        toast.error("تعذر تكرار المستند");
        return;
      }
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      const entitlements = get().entitlements;
      if (exceedsProjectPageLimit(source.pages.length, entitlements)) {
        toast.error("تجاوز هذا الملف حد صفحات تجربة المحرر");
        return;
      }
      if (
        requiresPremiumPack(source.pack, entitlements) ||
        requiresLicensedTemplate(source.licensedTemplateId, entitlements)
      ) {
        toast.error("لا يمكن تكرار مستند مبني على قالب النسخة الكاملة");
        return;
      }
      if (!entitlements.unlimited_projects) {
        let projectCount: number;
        try {
          projectCount = (await listProjects()).length;
        } catch {
          toast.error("تعذر التحقق من مساحة المشاريع المحفوظة");
          return;
        }
        if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
          return;
        if (exceedsSavedProjectLimit(projectCount, get().entitlements)) {
          toast.error("اكتملت مساحة تجربة المحرر", {
            description:
              "يتضمن العرض مشروعاً واحداً. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
          });
          return;
        }
      }
      const project = await copyProject(id);
      if (!project) {
        toast.error("تعذر تكرار المستند");
        return;
      }
      if (
        getStorageOwner() !== owner ||
        get().sessionOwner !== sessionOwner ||
        !editorAccessReady()
      )
        return;
      const copiedBlock = projectAccessBlock(project, get().entitlements);
      if (copiedBlock) {
        if (project.id) await removeProject(project.id).catch(() => undefined);
        toast.error("تغيّرت صلاحيات الترخيص؛ لا يمكن تكرار هذا المستند");
        return;
      }
      // Fresh identity: a copy never inherits the original's star (and its
      // thumbnail is re-captured on the next auto-save anyway).
      const savedCopy = await saveProject({
        ...project,
        favorite: false,
        thumbnail: undefined,
      });
      if (
        getStorageOwner() !== owner ||
        get().sessionOwner !== sessionOwner ||
        !editorAccessReady()
      )
        return;
      const copyBlock = projectAccessBlock(savedCopy, get().entitlements);
      if (copyBlock) {
        await removeProject(savedCopy.id!).catch(() => undefined);
        toast.error("تغيّرت صلاحيات الترخيص أثناء تكرار المستند");
        return;
      }
      if (!get().entitlements.unlimited_projects) {
        let copyCount: number;
        try {
          copyCount = (await listProjects()).length;
        } catch {
          await removeProject(savedCopy.id!).catch(() => undefined);
          toast.error("تعذر التحقق من مساحة المشاريع؛ أُلغي التكرار");
          return;
        }
        if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
          return;
        if (
          exceedsSavedProjectLimit(
            Math.max(0, copyCount - 1),
            get().entitlements,
          )
        ) {
          await removeProject(savedCopy.id!).catch(() => undefined);
          toast.error("اكتملت مساحة المشاريع في الخطة الحالية؛ أُلغي التكرار");
          return;
        }
      }
      try {
        const { enqueueSync } = await import("@/lib/offline/sync-queue");
        await enqueueSync("project:duplicate", { id: savedCopy.id, sourceId: id, updatedAt: Date.now() }, { dedupeKey: `project:duplicate:${savedCopy.id}` });
        void import("@/lib/offline/workspace-cache").then(m=>void m.refreshWorkspaceCache());
        void import("@/lib/offline/connectivity").then(m=>m.triggerSync());
      } catch {}
      await get().refreshProjects();
    },

    deleteProject: async (id) => {
      const owner = getStorageOwner();
      const sessionOwner = get().sessionOwner;
      if (!get().projects.some((project) => project.id === id)) return;
      await removeProject(id);
      try {
        const { enqueueSync } = await import("@/lib/offline/sync-queue");
        await enqueueSync("project:delete", { id, updatedAt: Date.now() }, { dedupeKey: `project:delete:${id}` });
        void import("@/lib/offline/workspace-cache").then(m=>void m.refreshWorkspaceCache());
        void import("@/lib/offline/connectivity").then(m=>m.triggerSync());
      } catch {}
      if (getStorageOwner() !== owner || get().sessionOwner !== sessionOwner)
        return;
      const s = get();
      if (s.id === id) {
        saveSessionGen += 1;
        activeSave = null;
        savePaused = false;
        if (saveTimer) {
          clearTimeout(saveTimer);
          saveTimer = null;
        }
        clearDraftSnapshot();
        openProjectState(createProject("blank", s.theme), { selectedId: null });
        const snap = projectSlice(get());
        cleanSnapshot = snap;
        set({
          past: [snap],
          future: [],
          saveState: "saved",
          savedAt: Date.now(),
        });
        await setSetting("activeProjectId", null);
      }
      await get().refreshProjects();
    },

    importProject: async (data, opts = {}) => {
      if (!requireEditorAccess()) return false;
      if (!data || !Array.isArray(data.pages) || !data.pages.length) {
        toast.error("ملف المشروع غير صالح — لا يحتوي على صفحات");
        return false;
      }
      const initialEntitlements = get().entitlements;
      if (exceedsProjectPageLimit(data.pages.length, initialEntitlements)) {
        toast.error("يتجاوز الملف حد صفحات تجربة المحرر", {
          description: "يتاح حتى 3 صفحات لكل مشروع في الخطة الحالية.",
        });
        return false;
      }
      if (
        requiresPremiumPack(data.pack, initialEntitlements) ||
        requiresLicensedTemplate(data.licensedTemplateId, initialEntitlements)
      ) {
        toast.error("هذا الملف مبني على قالب النسخة الكاملة", {
          description: "فعّل ترخيصًا مناسبًا لاستيراده وتعديله.",
        });
        return false;
      }
      const owner = opts.expectedOwner ?? getStorageOwner();
      const sameOwner = () =>
        getStorageOwner() === owner &&
        (!opts.expectedOwner || get().sessionOwner === owner);
      if (!sameOwner()) return false;
      if (
        hasLeaveGuard() &&
        !opts.expectedOwner &&
        !get().showcase &&
        hasUnsavedChanges(get().saveState)
      ) {
        const allowed = await requestLeave();
        if (!allowed || !sameOwner()) return false;
      }
      let current = get();
      const sameContent = () =>
        get().pages === current.pages &&
        get().name === current.name &&
        get().orgName === current.orgName &&
        get().transactionNo === current.transactionNo &&
        get().theme === current.theme &&
        get().editorSettings === current.editorSettings;
      const sameDocument = () => get().id === current.id && sameContent();
      if (get().saveState === "dirty" || get().saveState === "saving") {
        await get().saveNow();
        if (get().saveState === "error" || !sameOwner() || !sameContent())
          return false;
        // A first autosave assigns an ID; that is not a user switching documents.
        current = get();
      }
      const importId =
        opts.importId && /^[\w-]{1,100}$/.test(opts.importId)
          ? `nsq-${opts.importId}`
          : undefined;
      const existing = importId ? await getProject(importId) : null;
      if (!sameOwner()) return false;
      const entitlements = get().entitlements;
      if (
        exceedsProjectPageLimit(
          Math.max(data.pages.length, existing?.pages.length ?? 0),
          entitlements,
        )
      ) {
        toast.error("يتجاوز الملف حد صفحات تجربة المحرر", {
          description: "يتاح حتى 3 صفحات لكل مشروع في الخطة الحالية.",
        });
        return false;
      }
      const sourcePack = existing?.pack ?? data.pack;
      const sourceTemplateId =
        existing?.licensedTemplateId ?? data.licensedTemplateId;
      if (
        requiresPremiumPack(sourcePack, entitlements) ||
        requiresLicensedTemplate(sourceTemplateId, entitlements)
      ) {
        toast.error("هذا الملف مبني على قالب النسخة الكاملة", {
          description: "فعّل ترخيصًا مناسبًا لاستيراده وتعديله.",
        });
        return false;
      }
      if (!existing && !entitlements.unlimited_projects) {
        let projectCount: number;
        try {
          projectCount = (await listProjects()).length;
        } catch {
          toast.error("تعذر التحقق من مساحة المشاريع المحفوظة");
          return false;
        }
        if (!sameOwner()) return false;
        if (exceedsSavedProjectLimit(projectCount, entitlements)) {
          toast.error("اكتملت مساحة تجربة المحرر", {
            description: "يتضمن العرض مشروعًا واحدًا. افتح النسخة الكاملة لاستيراد مشاريع إضافية.",
          });
          return false;
        }
      }
      const incoming =
        existing ||
        normalizeProject({
          version: data.version || 2,
          nativeFormat: data.nativeFormat,
          nativeSourceProjectId: data.nativeSourceProjectId,
          embeddedFonts: data.embeddedFonts,
          editorSettings: data.editorSettings,
          name: data.name || "مشروع مستورد",
          theme: (data.theme as ThemeId) || "official",
          orgName: data.orgName || "",
          transactionNo: data.transactionNo || "",
          defaultSize: data.defaultSize,
          pack: data.pack,
          licensedTemplateId: data.licensedTemplateId,
          pages: data.pages,
          id: importId || uid("proj"),
          createdAt: data.createdAt || Date.now(),
          // Only an inline raster preview is accepted as the card thumbnail.
          thumbnail:
            typeof data.thumbnail === "string" &&
            /^data:image\/(png|jpeg|webp);base64,/i.test(data.thumbnail)
              ? data.thumbnail
              : undefined,
          nsqOrigin: data.nsqOrigin,
        });
      let saved: Project;
      try {
        // Persist first: if storage refuses (quota, private mode), nothing on
        // screen changes and the author's current document stays as it was.
        saved = existing || (await saveProject(incoming));
      } catch (err) {
        console.error("[editor] import save failed", err);
        toast.error(
          "تعذّر حفظ المشروع المستورد — تحقق من مساحة التخزين في المتصفح",
        );
        return false;
      }
      if (!sameOwner() || !editorAccessReady()) return false;
      const savedBlock = projectAccessBlock(saved, get().entitlements);
      if (savedBlock) {
        if (!existing) await removeProject(saved.id!).catch(() => undefined);
        toast.error(
          savedBlock === "premium-template"
            ? "تغيّرت صلاحيات الترخيص أثناء الاستيراد؛ لم يتم فتح المستند"
            : "تغيّر حد صفحات الخطة أثناء الاستيراد؛ لم يتم فتح المستند",
        );
        return false;
      }
      if (!existing && !get().entitlements.unlimited_projects) {
        let savedCount: number;
        try {
          savedCount = (await listProjects()).length;
        } catch {
          await removeProject(saved.id!).catch(() => undefined);
          toast.error("تعذر التحقق من مساحة المشاريع؛ أُلغي الاستيراد");
          return false;
        }
        if (!sameOwner() || !editorAccessReady()) return false;
        if (
          exceedsSavedProjectLimit(
            Math.max(0, savedCount - 1),
            get().entitlements,
          )
        ) {
          await removeProject(saved.id!).catch(() => undefined);
          toast.error("اكتملت مساحة المشاريع في الخطة الحالية؛ أُلغي الاستيراد");
          return false;
        }
      }
      await restoreFonts(saved);
      if (!sameOwner() || !sameDocument() || !editorAccessReady()) return false;
      saveSessionGen += 1;
      activeSave = null;
      savePaused = false;
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      clearDraftSnapshot();
      const pageIndex = opts.activePageIndex ?? 0;
      openProjectState(saved, {
        activePageId: saved.pages[pageIndex]?.id || saved.pages[0]?.id,
      });
      const snap = projectSlice(get());
      cleanSnapshot = snap;
      set({
        past: [snap],
        future: [],
        saveState: "saved",
        savedAt: Date.now(),
      });
      await setSetting("activeProjectId", saved.id);
      await get().refreshProjects();
      if (opts.successMessage !== null) {
        toast.success(opts.successMessage || "تم استيراد المشروع");
      }
      return true;
    },

    setZoom: (z) => {
      const zoom = clampZoom(z);
      set({ zoom });
      // A ctrl+wheel zoom fires dozens of steps a second; persisting each one
      // was an IndexedDB transaction per tick. One trailing write is enough.
      debounceSetting("zoom", zoom);
    },
    toggle: (key) => {
      const next = !get()[key];
      /*
       * Windows are independent now — opening one never closes another, so
       * الخصائص and الطبقات and أدوات التقرير can all be on screen at once
       * (the whole point of the split). Collapsing still reopens its window,
       * but without evicting the opposite side.
       */
      set({
        [key]: next,
        ...(key === "leftCollapsed"
          ? { leftOpen: !next }
          : key === "rightCollapsed"
            ? { rightOpen: !next }
            : {}),
      } as Partial<EditorStore>);
      // Workspace switches exposed in «الإعدادات → المحرر» are remembered like
      // the rest of the shell state, so the panel and the toolbar agree after
      // a reload instead of one of them silently reverting.
      if (key === "showGrid" || key === "snapGrid" || key === "snapElements") {
        writeUi({ [key]: next });
        set({ editorSettings: { ...get().editorSettings, [key]: next } });
        scheduleSave(500);
      }
      if (
        key === "focusMode" ||
        key === "leftOpen" ||
        key === "rightOpen" ||
        key === "leftCollapsed" ||
        key === "rightCollapsed"
      ) {
        void setSetting(key, next);
      }
      /*
       * The split windows and the rail visibility live in the UI slot
       * (localStorage): it is the slot hydrate() actually reads back, so this
       * is the persistence that survives a reload.
       */
      if (
        key === "layersOpen" ||
        key === "reportToolsOpen" ||
        key === "libraryOpen" ||
        key === "toolsOpen" ||
        key === "pagesRailHidden"
      ) {
        writeUi({ [key]: next });
      }
    },
    setArtboardGridCols: (cols: number) => {
      const artboardGridCols = clamp(Math.round(cols), 1, 8);
      set({ artboardGridCols });
      writeUi({ artboardGridCols });
    },
    setAppearance: (appearance) => {
      if (get().appearance === appearance) return;
      set({ appearance });
      writeStoredTheme(appearance);
    },
    setLeftTab: (leftTab) => {
      /*
       * «library» and «tools» are their OWN windows since the split; asking
       * for those tabs opens the matching window instead of a tab in the
       * elements panel. The tab itself is remembered so the window opens on
       * the right place next time.
       */
      set({
        leftTab,
        leftCollapsed: false,
        leftOpen: leftTab === "library" || leftTab === "tools" ? get().leftOpen : true,
        libraryOpen: leftTab === "library" ? true : get().libraryOpen,
        toolsOpen: leftTab === "tools" ? true : get().toolsOpen,
      });
      // Probing is deferred to the moment the font list is actually needed.
      if (leftTab === "fonts") get().probeFonts();
    },
    setRightTab: (rightTab) =>
      set({
        rightTab,
        rightCollapsed: false,
        rightOpen: rightTab === "properties" ? true : get().rightOpen,
        layersOpen: rightTab === "layers" ? true : get().layersOpen,
      }),

    toggleSidebar: (side) => {
      const overlay = isOverlayViewport() || side === "right";
      // Docked panels persist as `*Collapsed`; floating ones as `*Open`.
      const key =
        side === "left"
          ? overlay
            ? "leftOpen"
            : "leftCollapsed"
          : overlay
            ? "rightOpen"
            : "rightCollapsed";
      const next = !get()[key];
      // Independent windows: toggling one side never closes the other's.
      set({
        [key]: next,
        ...(key === "leftCollapsed" ? { leftOpen: !next } : {}),
        ...(key === "rightCollapsed" ? { rightOpen: !next } : {}),
      } as Partial<EditorStore>);
      void setSetting(key, next);
    },
    closeFloatingPanels: () => {
      /*
       * Every window, all six: on a tablet the drawers float over the artwork,
       * so "put the canvas back" must dismiss all of them — the split means
       * closing just the two old flags would leave four windows behind.
       */
      set({
        leftOpen: false,
        rightOpen: false,
        layersOpen: false,
        reportToolsOpen: false,
        libraryOpen: false,
        toolsOpen: false,
      });
      void setSetting("leftOpen", false);
      void setSetting("rightOpen", false);
    },
    openExport: (format) =>
      set({ exportOpen: true, exportPreset: format ?? null }),
    openContextMenu: (contextMenu) => set({ contextMenu }),
    closeContextMenu: () => set({ contextMenu: null }),
    openLibrary: () => {
      set({
        leftTab: "library",
        leftCollapsed: false,
        libraryOpen: true,
      });
    },
    toggleBubble: (enabled) => {
      const bubbleEnabled = enabled ?? !get().bubbleEnabled;
      set({ bubbleEnabled });
      writeUi({ bubble: bubbleEnabled });
    },
    setBubbleOffset: (offset) => {
      // Keep a manual park sane: a few hundred pixels of travel is a
      // deliberate placement, thousands would strand the bubble off screen.
      const bubbleOffset = offset
        ? {
            dx: clamp(Math.round(offset.dx), -2000, 2000),
            dy: clamp(Math.round(offset.dy), -2000, 2000),
          }
        : null;
      set({ bubbleOffset });
      writeUi({ bubbleOffset });
    },
    resetWorkspaceLayout: () => {
      const pagesPanelHeight = clampPagesHeight(PAGES_PANEL_DEFAULT);
      set({
        focusMode: false,
        leftCollapsed: false,
        rightCollapsed: false,
        leftOpen: true,
        rightOpen: true,
        layersOpen: true,
        reportToolsOpen: false,
        libraryOpen: false,
        toolsOpen: false,
        pagesRailHidden: false,
        pagesRailCollapsed: false,
        pagesPanelHeight,
        bubbleEnabled: true,
        bubbleOffset: null,
        contextMenu: null,
      });
      void setSetting("focusMode", false);
      void setSetting("leftCollapsed", false);
      void setSetting("rightCollapsed", false);
      void setSetting("leftOpen", true);
      void setSetting("rightOpen", true);
      writeUi({
        pagesPanelHeight,
        pagesRailHidden: false,
        pagesRailCollapsed: false,
        bubble: true,
        bubbleOffset: null,
      });
      if (typeof window !== "undefined")
        window.dispatchEvent(new CustomEvent("nasaq:reset-workspace"));
    },
    togglePagesRail: () => {
      // Expanding a HIDDEN rail restores the full tray, not the collapsed strip.
      if (get().pagesRailHidden) {
        set({ pagesRailHidden: false, pagesRailCollapsed: false });
        writeUi({ pagesRailHidden: false, pagesRailCollapsed: false });
        return;
      }
      const pagesRailCollapsed = !get().pagesRailCollapsed;
      set({ pagesRailCollapsed });
      writeUi({ pagesRailCollapsed });
    },
    togglePagesRailHidden: () => {
      const pagesRailHidden = !get().pagesRailHidden;
      set({ pagesRailHidden });
      writeUi({ pagesRailHidden });
    },
    setPagesPanelHeight: (height) => {
      const next = clampPagesHeight(height);
      if (get().pagesPanelHeight === next) return;
      set({ pagesPanelHeight: next });
      // Dragging the handle fires per pointermove; the store write drives the
      // layout, the localStorage flush is coalesced into one trailing write.
      if (pagesUiWriteTimer) clearTimeout(pagesUiWriteTimer);
      pagesUiWriteTimer = setTimeout(() => {
        pagesUiWriteTimer = null;
        writeUi({ pagesPanelHeight: useEditor.getState().pagesPanelHeight });
      }, 300);
    },

    addCustomIcon: async (input) => {
      const svg = extractSvgMarkup(input.svg);
      if (!svg) {
        toast.error("الملف لا يحتوي على رسم SVG صالح");
        return null;
      }
      const item: CustomLibraryItem = {
        id: uid(input.kind === "divider" ? "dvd" : "icn"),
        name:
          (input.name || "").trim().slice(0, 40) ||
          (input.kind === "divider" ? "فاصل مخصص" : "رمز مخصص"),
        kind: input.kind,
        svg,
        createdAt: Date.now(),
      };
      const customIcons = [item, ...get().customIcons];
      set({ customIcons });
      await setSetting("customLibrary", customIcons);
      queueLibrarySync();
      return item;
    },

    removeCustomIcon: async (id) => {
      const customIcons = get().customIcons.filter((item) => item.id !== id);
      set({ customIcons });
      await setSetting("customLibrary", customIcons);
      queueLibrarySync();
    },
    setTheme: (theme) => {
      if (get().theme === theme) return;
      set({ theme });
      pushHistory();
    },
    setName: (name) => {
      if (get().name === name) return;
      set({ name });
      scheduleSave(500);
    },
    setOrg: (orgName) => {
      if (get().orgName === orgName) return;
      set({ orgName });
      scheduleSave(500);
    },

    /*
     * Opening the builder also reveals the components panel, because that is
     * where the overlay lives. On a tablet the panel is a drawer, so the author
     * sees the picker slide in with it instead of a control appearing offscreen.
     * Tabs that already host the overlay keep their place — jumping out of
     * «أدوات العناصر» mid-arrangement would lose the author's context.
     */
    openTablePicker: (source = "elements") => {
      if (!get().entitlements.data_import) {
        toast.error("استيراد البيانات متاح في النسخة الكاملة", {
          description: "فعّل ترخيصاً مناسباً لاستيراد Excel وCSV.",
        });
        return;
      }
      /*
       * The builder renders inside the window that asked for it (`source`), so
       * exactly one overlay shows even when both windows are open: the tab is
       * pinned to that source and only the matching window renders it.
       */
      set({
        tablePickerOpen: true,
        leftTab: source,
        leftOpen: source === "elements" ? true : get().leftOpen,
        toolsOpen: source === "tools" ? true : get().toolsOpen,
      });
    },
    closeTablePicker: () => set({ tablePickerOpen: false }),
    setTransactionNo: (transactionNo) => {
      if (get().transactionNo === transactionNo) return;
      set({ transactionNo });
      scheduleSave(500);
    },
    setActivePage: (id) => {
      if (id === get().activePageId) return;
      set({
        activePageId: id,
        selectedId: null,
        selectedIds: [],
        enteredGroupId: null,
        editingId: null,
      });
      // Remember the page the author is ON (debounced) so a reload reopens
      // the same page even when no edit has triggered an auto-save since.
      debounceSetting("activePageId", id, 350);
    },
    select: (id) =>
      set((s) => ({
        selectedId: id,
        selectedIds: id ? [id] : [],
        enteredGroupId: id ? s.enteredGroupId : null,
        // Floating properties never auto-open over newly selected artwork.
        rightOpen: s.rightOpen,
      })),

    setEditing: (id) => set({ editingId: id }),

    toggleSelect: (id) => {
      const s = get();
      const page = activePageOf(s);
      if (!page || !pickable(page, s.enteredGroupId, id)) return;
      const has = s.selectedIds.includes(id);
      const selectedIds = has
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id];
      // The primary selection is the last one added, which is the element whose
      // properties the panel should be showing.
      set({
        selectedIds,
        selectedId: selectedIds.length
          ? selectedIds[selectedIds.length - 1]
          : null,
      });
    },

    selectMany: (ids) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const keep = ids.filter((id) => pickable(page, s.enteredGroupId, id));
      set({
        selectedIds: keep,
        selectedId: keep.length ? keep[keep.length - 1] : null,
      });
    },

    selectAll: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page || page.locked || page.hidden) return;
      const elements = s.enteredGroupId
        ? (findElement(page.elements, s.enteredGroupId)?.el.children ?? [])
        : page.elements;
      s.selectMany(
        elements.filter((el) => !el.locked && !el.hidden).map((el) => el.id),
      );
    },

    invertSelection: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page || page.locked || page.hidden) return;
      const elements = s.enteredGroupId
        ? (findElement(page.elements, s.enteredGroupId)?.el.children ?? [])
        : page.elements;
      s.selectMany(
        elements
          .filter(
            (el) => !el.locked && !el.hidden && !s.selectedIds.includes(el.id),
          )
          .map((el) => el.id),
      );
    },

    linkSelected: () => {
      const s = get();
      const page = activePageOf(s);
      const picked = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter((el): el is CanvasEl => Boolean(el))
        .filter((el) => !el.locked);
      if (picked.length < 2) {
        toast.error("حدّد عنصرين أو أكثر للربط");
        return;
      }
      const linkId = uid("link");
      const ids = new Set(picked.map((el) => el.id));
      const next = {
        ...page,
        elements: page.elements.map((el) =>
          ids.has(el.id) ? { ...el, linkId } : el,
        ),
      };
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
      toast.success("تم ربط العناصر — بقيت مستقلة ويمكن فك الربط لاحقًا");
    },

    unlinkSelected: () => {
      const s = get();
      const page = activePageOf(s);
      const ids = new Set(s.selectedIds);
      if (!s.selectedIds.length) return;
      const next = {
        ...page,
        elements: page.elements.map((el) =>
          ids.has(el.id) ? { ...el, linkId: undefined } : el,
        ),
      };
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
      toast.success("تم فك ربط العناصر");
    },

    enterGroup: (id) => set({ enteredGroupId: id }),

    selectedElements: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return [];
      const out: CanvasEl[] = [];
      // Preserve selection order (primary last) rather than page order.
      for (const id of s.selectedIds) {
        const found = locate(page, id);
        if (found) out.push(found.el);
      }
      return out;
    },

    group: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return null;
      const picked = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter((el): el is CanvasEl => Boolean(el) && !el!.locked);
      if (picked.length < 2) {
        toast.error("حدّد عنصرين أو أكثر للتجميع");
        return null;
      }
      // Group only siblings: mixing depths would make the children's relative
      // coordinates ambiguous, so a nested pick is simply left out.
      const topLevel = picked.filter((el) =>
        page.elements.some((e) => e.id === el.id),
      );
      if (topLevel.length < 2) {
        toast.error("لا يمكن تجميع عناصر من مستويات مختلفة");
        return null;
      }
      const group = createGroupFrom(topLevel);
      if (!group) return null;
      const ids = new Set(topLevel.map((el) => el.id));
      const elements = [...page.elements.filter((e) => !ids.has(e.id)), group];
      const next = { ...page, elements };
      normalizeZ(next);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: group.id,
        selectedIds: [group.id],
      });
      pushHistory();
      toast.success(`تم تجميع ${topLevel.length} عناصر`);
      return group.id;
    },

    ungroup: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const targets = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter(
          (el): el is CanvasEl =>
            Boolean(el) && el!.type === "group" && !el!.locked,
        );
      if (!targets.length) {
        toast.error("لا توجد مجموعة محددة لفك التجميع");
        return;
      }
      const ids = new Set(targets.map((t) => t.id));
      const freed: CanvasEl[] = [];
      const elements: CanvasEl[] = [];
      for (const el of page.elements) {
        if (ids.has(el.id)) freed.push(...explodeGroup(el));
        else elements.push(el);
      }
      const next = { ...page, elements: [...elements, ...freed] };
      normalizeZ(next);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedIds: freed.map((f) => f.id),
        selectedId: freed.length ? freed[freed.length - 1].id : null,
        enteredGroupId: null,
      });
      pushHistory();
      toast.success(
        freed.length > 1
          ? `تم فك تجميع ${freed.length} عناصر`
          : "تم فك التجميع",
      );
    },

    align: (edge, frame) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      if (!s.selectedIds.length) {
        toast.error("حدّد عنصرًا للمحاذاة");
        return;
      }
      const size = pageSize(page);
      const target =
        frame === "page"
          ? { x: 0, y: 0, w: size.w, h: size.h }
          : absoluteBounds(page.elements, s.selectedIds) || {
              x: 0,
              y: 0,
              w: size.w,
              h: size.h,
            };
      // One element aligns against the frame itself (the artboard for "page");
      // several elements align onto their shared box. Group members are
      // resolved through absolute page space inside `alignmentMoves`.
      applyPositions(
        alignmentMoves(page.elements, s.selectedIds, edge, target),
      );
    },

    distribute: (axis) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const picked = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter((el): el is CanvasEl => Boolean(el));
      const out = distributePositions(picked, axis);
      if (!out) {
        toast.error("التوزيع يحتاج ثلاثة عناصر أو أكثر");
        return;
      }
      applyPositions(out);
    },

    matchSize: (dim) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const primary = s.selectedId ? locate(page, s.selectedId)?.el : undefined;
      if (!primary) return;
      // Only top-level siblings take part: a group member's size is relative
      // to its parent's box, and resizing it in page units would skew the group.
      const targets = s.selectedIds
        .filter((id) => id !== s.selectedId)
        .map((id) => locate(page, id))
        .filter(
          (found): found is NonNullable<ReturnType<typeof locate>> =>
            Boolean(found) &&
            found!.list === page.elements &&
            !found!.el.locked,
        );
      if (!targets.length) return;
      const w = Math.max(MIN_SIZE, primary.w);
      const h = Math.max(MIN_SIZE, primary.h);
      const next = mapElements(
        page,
        new Set(targets.map((f) => f.el.id)),
        (el) => ({
          ...el,
          ...(dim !== "height" ? { w } : {}),
          ...(dim !== "width" ? { h } : {}),
        }),
      );
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    renameElement: (id, name) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const next = mapElement(page, id, (el) => ({
        ...el,
        name: name.trim() || el.name,
      }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    setElementFlag: (id, flag, value) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const current = findElement(page.elements, id)?.el;
      const nextValue = value ?? !current?.[flag];
      /*
       * Folder rule (Phase 5): switching a مجموعة/مجلد off must switch every
       * nested child off with it — otherwise the canvas keeps painting artwork
       * from a folder the author just hid, and the tree and canvas disagree.
       * The same applies to locking (a locked folder is fully locked). Only a
       * group has children, so a leaf element costs one extra check.
       */
      const next = mapElement(page, id, (el) =>
        flag === "hidden" || flag === "locked"
          ? cascadeFlag(el, flag, nextValue)
          : { ...el, [flag]: nextValue },
      );
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    moveLayer: (id, dir) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const found = locate(page, id);
      if (!found) return;
      const nextList = nudgeStack(found.list, id, dir);
      if (!nextList) return;
      const next = replaceSiblingList(page, found.list, nextList);
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    addElementAt: (type, over, center, pageId) => {
      const s = get();
      const page = pageId
        ? s.pages.find((p) => p.id === pageId)
        : center
          ? activePageOf(s)
          : insertionPage(canvasStage(), s.pages, s.activePageId);
      if (!page || page.locked || page.hidden) return undefined;
      // Undefined picker coordinates must never overwrite computed placement.
      const overrides = Object.fromEntries(
        Object.entries(over || {}).filter(([, value]) => value !== undefined),
      ) as Partial<CanvasEl>;
      const theme = THEMES[s.theme];
      const size = pageSize(page);
      /*
       * Two placements, one insertion:
       *  · no `center` — the element lands in the middle of what the author is
       *    looking at (the union of every visible artboard), not a fixed corner;
       *  · `center` given — the element is centred on that page point, which is
       *    how a library card dropped on the canvas lands under the cursor.
       * Defaults come from createElementDefaults; anything the caller passes in
       * `over` (e.g. a palette preset or a drawn size) wins over them, and the
       * theme layer is applied last exactly as before — layering keeps one
       * source of defaults without changing createElement's theming contract.
       */
      const defaults = createElementDefaults(type);
      const el = createElement(
        type,
        { ...defaults, ...overrides, z: nextZ(page) },
        theme,
      );
      // Normalise the actual frame BEFORE positioning. Small pages can constrain
      // WH; centring the old requested size would move the final frame off-target.
      constrainElement(el, size);
      if (el.type === "text" && el.style?.textBoxMode === "free") {
        const fitted = resolveTextBox(el);
        if (fitted) {
          el.w = fitted.w;
          el.h = fitted.h;
        }
      }
      const visible = visiblePageRect(
        canvasStage(),
        page,
        s.zoom,
        s.previewAll,
      );
      const pos = center
        ? { x: center.x - el.w / 2, y: center.y - el.h / 2 }
        : centerFor(visible, { w: size.w, h: size.h, elW: el.w, elH: el.h });
      if (center || overrides.x == null) el.x = pos.x;
      if (center || overrides.y == null) el.y = pos.y;
      constrainElement(el, size);
      set({
        pages: s.pages.map((p) =>
          p.id === page.id ? { ...p, elements: [...p.elements, el] } : p,
        ),
        // Both selection fields together: selectedId alone leaves selectedIds
        // empty, so the selection frame, the arrange bar and every
        // selection-scoped command ignored the element that was just added.
        activePageId: page.id,
        editingId: null,
        selectedId: el.id,
        selectedIds: [el.id],
        rightTab: "properties",
      });
      pushHistory();
      if (!historyBatch && typeof document !== "undefined")
        revealInsertedElement(page.id, el.id);
      /*
       * Step 10 — one confirmation for EVERY insertion funnel.
       *
       * `addElementAt` is what the library cards, the element palette, the table
       * builder and the canvas drop all call, so a single toast here covers
       * "click or drag a library item" exactly, with no chance of a path being
       * forgotten. Short duration keeps it subtle: a receipt, not an alert.
       */
      if (!historyBatch)
        toast.success("تمت إضافة العنصر إلى مساحة العمل", { duration: 1600 });
      return el;
    },

    addElement: (type, over) => get().addElementAt(type, over)?.id,

    insertLibraryElements: (input, at = null, pageId) => {
      const payload = normalizeLibraryDrop(input);
      if (!payload) return [];
      const state = get();
      const page =
        pageId || at
          ? state.pages.find((p) => p.id === (pageId || state.activePageId))
          : insertionPage(canvasStage(), state.pages, state.activePageId);
      if (!page) return [];
      const visible = visiblePageRect(
        canvasStage(),
        page,
        get().zoom,
        get().previewAll,
      );
      const size = pageSize(page);
      // Every batch has one visible/exact anchor; preset XY never overrides it.
      const anchor = at || {
        x: visible ? visible.x + visible.w / 2 : size.w / 2,
        y: visible ? visible.y + visible.h / 2 : size.h / 2,
      };
      const ids: string[] = [];
      historyBatch += 1;
      try {
        insertLibraryDrop(payload, anchor, (type, over, center) => {
          const el = get().addElementAt(
            type as ElType,
            over as Partial<CanvasEl>,
            center,
            page.id,
          );
          if (el) ids.push(el.id);
          return el;
        });
      } finally {
        historyBatch -= 1;
      }
      if (ids.length) {
        get().selectMany(ids);
        pushHistory();
        if (typeof document !== "undefined")
          revealInsertedElement(page.id, ids);
        toast.success("تمت إضافة العنصر إلى مساحة العمل", { duration: 1600 });
      }
      return ids;
    },

    /* ── Print guides ────────────────────────────────────────────────────── */

    togglePrintGuide: (kind) => {
      const next = {
        ...get().printGuides,
        [kind]: !get().printGuides[kind],
      };
      set({
        printGuides: next,
        editorSettings: { ...get().editorSettings, printGuides: next },
      });
      scheduleSave(500);
      writeUi({ printGuides: next });
    },

    /* ── Page furniture, numbering, and ready-made report objects ────────── */

    /**
     * Apply the active page's header and footer document-wide.
     *
     * The active page is the source because it is the one the author can see and
     * style; the action then mirrors it onto every page of the same size. It is
     * ONE history entry, so a mistaken «تثبيت» is a single undo away.
     */
    applyHeaderFooter: () => {
      const s = get();
      const source = activePageOf(s);
      if (!source) return;
      const { pages, copied, skipped } = applyFurniture(
        s.pages,
        source.id,
        (page) => pageSize(page),
      );
      if (!copied && !skipped.length) {
        toast.error("لا يوجد ترويسة أو تذييل في الصفحة الحالية", {
          description: "أضف عناصر في أعلى الصفحة أو أسفلها ثم أعد المحاولة.",
        });
        return;
      }
      set({ pages });
      pushHistory();
      const note = skipped.length
        ? ` · تم تخطّي ${skipped.length} صفحة بمقاس مختلف (${skipped.join("، ")})`
        : "";
      toast.success(
        `تم تثبيت الترويسة والتذييل على ${s.pages.length} صفحة${note}`,
      );
    },

    removeHeaderFooter: () => {
      const s = get();
      const { pages, removed } = clearFurniture(s.pages);
      if (!removed) {
        toast.error("لا توجد ترويسة أو تذييل مثبّت");
        return;
      }
      set({ pages });
      pushHistory();
      toast.success(`تمت إزالة الترويسة والتذييل (${removed} عنصر)`);
    },

    addPageNumbers: () => {
      const s = get();
      const { pages, added } = numberPages(s.pages, THEMES[s.theme], (page) =>
        pageSize(page),
      );
      if (!added) {
        toast.error("كل الصفحات مرقّمة بالفعل");
        return;
      }
      set({ pages });
      pushHistory();
      toast.success(`تمت إضافة ترقيم الصفحات (${added} عنصر)`);
    },

    removePageNumbers: () => {
      const s = get();
      const { pages, removed } = dropPageNumbers(s.pages);
      if (!removed) {
        toast.error("لا يوجد ترقيم صفحات");
        return;
      }
      set({ pages });
      pushHistory();
      toast.success("تمت إزالة ترقيم الصفحات");
    },

    /**
     * Stamp & signature zone.
     *
     * Landed as ONE group in the bottom corner, away from the gutter margin, and
     * pushed in as one history entry so it can be dragged or undone as a unit.
     */
    insertSignatureZone: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const size = pageSize(page);
      const zone = signatureZoneForPage(THEMES[s.theme], size);
      const next = placeElements(page, [zone]);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: zone.id,
        selectedIds: [zone.id],
        rightTab: "properties",
      });
      pushHistory();
      toast.success("تمت إضافة منطقة الختم والتوقيع", {
        description:
          "اسحبها إلى مكانها، وتفكيكها من «فك التجميع» إن أردت تعديل أجزائها.",
        duration: 2600,
      });
    },

    insertKpiCard: (kind, options) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const size = pageSize(page);
      const def = kpiCard(kind, s.theme, { x: 0, y: 0, ...options });
      const box = boundsOf(def) ?? { x: 0, y: 0, w: 60, h: 30 };
      /*
       * Placement: the visible centre of the page, the same rule the library
       * uses — the card never lands off-screen or under a panel.
       */
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const visible = visiblePageRect(stage, page, s.zoom, s.previewAll);
      const target = centerFor(visible, {
        w: size.w,
        h: size.h,
        elW: box.w,
        elH: box.h,
      });
      const parts = kpiCard(kind, s.theme, {
        ...options,
        x: target.x,
        y: target.y,
      });
      const next = placeElements(page, parts);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: parts[0]?.id ?? null,
        selectedIds: parts[0] ? [parts[0].id] : [],
        rightTab: "properties",
      });
      pushHistory();
      toast.success("تمت إضافة بطاقة المؤشر", { duration: 1800 });
    },

    insertReportBlock: (id) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return undefined;
      const block = buildReportBlock(id, s.theme);
      if (!block) return undefined;

      const size = pageSize(page);
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const visible = visiblePageRect(stage, page, s.zoom, s.previewAll);
      const target = centerFor(visible, {
        w: size.w,
        h: size.h,
        elW: block.w,
        elH: block.h,
      });
      block.x = target.x;
      block.y = target.y;
      block.z = nextZ(page);
      constrainElement(block, size);
      const next = placeElements(page, [block]);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: block.id,
        selectedIds: [block.id],
        rightTab: "properties",
      });
      pushHistory();
      toast.success("تمت إضافة كتلة تقرير قابلة للتحرير", { duration: 1800 });
      return block.id;
    },

    insertGraphicHeading: (id) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return undefined;
      const block = buildGraphicHeading(id, s.theme);
      if (!block) return undefined;
      const size = pageSize(page);
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const visible = visiblePageRect(stage, page, s.zoom, s.previewAll);
      const target = centerFor(visible, {
        w: size.w,
        h: size.h,
        elW: block.w,
        elH: block.h,
      });
      block.x = target.x;
      block.y = target.y;
      block.z = nextZ(page);
      constrainElement(block, size);
      const next = placeElements(page, [block]);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: block.id,
        selectedIds: [block.id],
        rightTab: "properties",
      });
      pushHistory();
      toast.success("تمت إضافة العنوان الجرافيكي", { duration: 1800 });
      return block.id;
    },

    insertImageFrame: (frameId) => {
      const frame = imageFrameDef(frameId);
      if (!frame) return undefined;
      const overrides = framedImageOverrides(frame.id);
      if (!overrides) return undefined;
      const s = get();
      const page = activePageOf(s);
      if (!page || page.locked || page.hidden) return undefined;
      /*
       * A frame is inserted at its catalogue size, then constrained to the
       * sheet like any other element: a 92 mm landscape frame on a 60 mm-wide
       * card still lands whole and centred instead of hanging off the page.
       */
      const size = pageSize(page);
      const scale = Math.min(
        1,
        (size.w * 0.8) / Math.max(1, overrides.w ?? 1),
        (size.h * 0.8) / Math.max(1, overrides.h ?? 1),
      );
      const el = get().addElementAt("image", {
        ...overrides,
        w: Math.max(8, (overrides.w ?? frame.w) * scale),
        h: Math.max(8, (overrides.h ?? frame.h) * scale),
      });
      return el?.id;
    },

    insertGraphicHeadingAt: (id, at) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return undefined;
      const block = buildGraphicHeading(id, s.theme);
      if (!block) return undefined;
      const size = pageSize(page);
      // at is page mm center point where user dropped
      block.x = at.x - block.w / 2;
      block.y = at.y - block.h / 2;
      block.z = nextZ(page);
      constrainElement(block, size);
      const next = placeElements(page, [block]);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: block.id,
        selectedIds: [block.id],
        rightTab: "properties",
      });
      pushHistory();
      toast.success("تمت إضافة العنوان الجرافيكي في الموضع المحدد", {
        duration: 1800,
      });
      return block.id;
    },

    insertReportDraft: (draft, existingId) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return undefined;
      const block = buildReportDraftBlock(s.theme, draft);
      if (!block) return undefined;
      const existing = existingId ? locate(page, existingId)?.el : undefined;
      const size = pageSize(page);

      if (existing) {
        block.id = existing.id;
        block.x = existing.x;
        block.y = existing.y;
        block.z = existing.z;
        constrainElement(block, size);
        const next = mapElement(page, existing.id, () => block);
        set({
          pages: s.pages.map((p) => (p.id === page.id ? next : p)),
          selectedId: block.id,
          selectedIds: [block.id],
          rightTab: "properties",
        });
        pushHistory();
        toast.success("تم تحديث المسودة المنظمة فقط", { duration: 1800 });
        return block.id;
      }

      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const visible = visiblePageRect(stage, page, s.zoom, s.previewAll);
      const target = centerFor(visible, {
        w: size.w,
        h: size.h,
        elW: block.w,
        elH: block.h,
      });
      block.x = target.x;
      block.y = target.y;
      block.z = nextZ(page);
      constrainElement(block, size);
      const next = placeElements(page, [block]);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: block.id,
        selectedIds: [block.id],
        rightTab: "properties",
      });
      pushHistory();
      toast.success("أُدرجت المسودة كأقسام قابلة للتحرير", { duration: 2200 });
      return block.id;
    },

    /**
     * Arabic typography presets.
     *
     * Applying a preset is a STYLE operation over the current selection — text
     * "when the element is empty" only, and never geometry unless the element is
     * new. With nothing selected the author gets a fresh, correctly styled text
     * box, which is the common case: pick a title, type the title.
     */
    applyPreset: (presetId) => {
      const s = get();
      const preset = typographyPreset(presetId);
      if (!preset) return;
      const page = activePageOf(s);
      if (!page) return;
      const targets = s
        .selectedElements()
        .filter(
          (el) => el.type === "text" || el.type === "box" || el.type === "stat",
        );
      if (!targets.length) {
        const stage = canvasStage();
        const size = pageSize(page);
        const visible = visiblePageRect(stage, page, s.zoom, s.previewAll);
        const pos = centerFor(visible, {
          w: size.w,
          h: size.h,
          elW: preset.box.w,
          elH: preset.box.h,
        });
        const el = applyTypographyPreset(
          createElement(
            "text",
            {
              x: pos.x,
              y: pos.y,
              w: preset.box.w,
              h: preset.box.h,
              z: nextZ(page),
            },
            THEMES[s.theme],
          ),
          preset,
          s.theme,
        );
        constrainElement(el, size);
        const merged: Page = { ...page, elements: [...page.elements, el] };
        normalizeZ(merged);
        set({
          pages: s.pages.map((p) => (p.id === page.id ? merged : p)),
          selectedId: el.id,
          selectedIds: [el.id],
          rightTab: "properties",
        });
        pushHistory();
        toast.success(`تم إنشاء عنصر بنمط «${preset.label}»`);
        return;
      }
      const byId = new Map(
        targets.map((el) => [
          el.id,
          applyTypographyPreset(el, preset, s.theme),
        ]),
      );
      const walk = (list: CanvasEl[]): CanvasEl[] =>
        list.map(
          (el) =>
            byId.get(el.id) ??
            (el.children?.length ? { ...el, children: walk(el.children) } : el),
        );
      set({
        pages: s.pages.map((p) =>
          p.id === page.id ? { ...p, elements: walk(p.elements) } : p,
        ),
      });
      pushHistory();
      toast.success(
        targets.length === 1
          ? `تم تطبيق نمط «${preset.label}»`
          : `تم تطبيق نمط «${preset.label}» على ${targets.length} عناصر`,
      );
    },

    /**
     * Insert a macro token.
     *
     * The token is appended to the selected text element (or a brand-new one) and
     * stored as the TOKEN, never as its resolved value — that is what keeps the
     * date live when the document is reopened next month.
     */
    insertMacro: (token) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const target = s
        .selectedElements()
        .find(
          (el) => el.type === "text" || el.type === "box" || el.type === "stat",
        );
      if (!target) {
        const size = pageSize(page);
        const stage = canvasStage();
        const visible = visiblePageRect(stage, page, s.zoom, s.previewAll);
        const pos = centerFor(visible, {
          w: size.w,
          h: size.h,
          elW: 110,
          elH: 14,
        });
        const el = createElement(
          "text",
          {
            x: pos.x,
            y: pos.y,
            w: 110,
            h: 14,
            content: token,
            z: nextZ(page),
          },
          THEMES[s.theme],
        );
        constrainElement(el, size);
        const merged: Page = { ...page, elements: [...page.elements, el] };
        normalizeZ(merged);
        set({
          pages: s.pages.map((p) => (p.id === page.id ? merged : p)),
          selectedId: el.id,
          selectedIds: [el.id],
          rightTab: "properties",
        });
        pushHistory();
        toast.success("تمت إضافة الرمز في صندوق نص جديد");
        return;
      }
      const content = String(target.content ?? "");
      const spacer = content && !/\s$/.test(content) ? " " : "";
      set({
        pages: s.pages.map((p) =>
          p.id === page.id
            ? {
                ...p,
                elements: p.elements.map((el) =>
                  el.id === target.id
                    ? { ...el, content: `${content}${spacer}${token}` }
                    : el,
                ),
              }
            : p,
        ),
        selectedId: target.id,
        selectedIds: [target.id],
        rightTab: "properties",
      });
      pushHistory();
      toast.success("تمت إضافة الرمز", { duration: 1500 });
    },

    addTextAt: (box, pageId) => {
      const s = get();
      const page = pageId
        ? s.pages.find((p) => p.id === pageId)
        : activePageOf(s);
      if (!page) return undefined;
      const theme = THEMES[s.theme];
      const size = pageSize(page);
      const defaults = createElementDefaults("text");
      const el = createElement(
        "text",
        {
          ...defaults,
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          // Drawn text always lands on top of everything visible: this is a
          // new layer the author just drew, never a reshuffle of existing ones.
          z: nextZ(page),
        },
        theme,
      );
      constrainElement(el, size);
      set({
        pages: s.pages.map((p) =>
          p.id === page.id ? { ...p, elements: [...p.elements, el] } : p,
        ),
        selectedId: el.id,
        selectedIds: [el.id],
        activePageId: page.id,
        rightTab: "properties",
      });
      pushHistory();
      toast.success("تمت إضافة صندوق نص إلى مساحة العمل", { duration: 1600 });
      return el.id;
    },

    updateElement: (id, patch, live) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const size = pageSize(page);
      const next = mapElement(page, id, (el) => {
        if (el.locked && patch.locked !== false && patch.name === undefined)
          return el;
        const merged = {
          ...el,
          ...patch,
          style: { ...el.style, ...(patch.style || {}) },
        };
        // Precision fields do not grid-snap; snapping belongs to the pointer
        // gesture, otherwise X/Y and a committed crop shift after release.
        if (el.resizeLocked) {
          merged.w = el.w;
          merged.h = el.h;
        }
        if (el.widthLocked) merged.w = el.w;
        if (el.heightLocked) merged.h = el.h;
        if (el.style.aspectLock && !el.resizeLocked) {
          if (patch.w != null && patch.h == null && !el.heightLocked)
            merged.h = (el.h * merged.w) / el.w;
          if (patch.h != null && patch.w == null && !el.widthLocked)
            merged.w = (el.w * merged.h) / el.h;
        }
        constrainElement(merged, size);
        if (
          merged.children?.length &&
          (merged.w !== el.w || merged.h !== el.h)
        ) {
          merged.children = clone(merged.children);
          scaleChildren(merged, el.w, el.h);
        }
        return merged;
      });
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      if (live) scheduleSave(400);
      else pushHistory();
    },

    updateStyle: (id, patch, live) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const size = pageSize(page);
      const next = mapElement(page, id, (el) => {
        if (el.locked) return el;
        const merged = { ...el, style: { ...el.style, ...patch } };
        constrainElement(merged, size);
        return merged;
      });
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      if (live) scheduleSave(400);
      else pushHistory();
    },

    replaceElement: (el, live) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const size = pageSize(page);
      const prev = locate(page, el.id)?.el;
      const next = mapElement(page, el.id, () => {
        const copy = clone(el);
        // A group carries its members in relative coordinates, so resizing the
        // group box has to rescale them or the contents detach from the frame.
        if (copy.children?.length && prev) scaleChildren(copy, prev.w, prev.h);
        constrainElement(copy, size);
        return copy;
      });
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      if (live) scheduleSave(600);
      else pushHistory();
    },

    patchElementOnPage: (pageId, id, patch) => {
      const s = get();
      const page = s.pages.find((p) => p.id === pageId);
      if (!page) return false;
      let found = false;
      const next = mapElement(page, id, (el) => {
        found = true;
        return {
          ...el,
          ...patch,
          style: { ...el.style, ...(patch.style || {}) },
        };
      });
      if (!found) return false;
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
      return true;
    },

    applyElements: (pageId, els, opts) => {
      const s = get();
      if (!els.length) return;
      const page = s.pages.find((p) => p.id === pageId);
      if (!page) return;
      const size = pageSize(page);
      const byId = new Map(els.map((el) => [el.id, el]));
      const next = mapElements(page, new Set(byId.keys()), (el) => {
        const copy = clone(byId.get(el.id)!);
        // Same group-rescale contract as `replaceElement`: a resized group
        // rescales its members, a moved one keeps their relative boxes.
        if (copy.children?.length && (copy.w !== el.w || copy.h !== el.h))
          scaleChildren(copy, el.w, el.h);
        constrainElement(copy, size);
        return copy;
      });
      set({ pages: s.pages.map((p) => (p.id === pageId ? next : p)) });
      if (opts?.live) scheduleSave(400);
      else pushHistory();
    },

    nudgeSelection: (dx, dy) => {
      const s = get();
      if (
        !s.selectedIds.length ||
        !Number.isFinite(dx) ||
        !Number.isFinite(dy) ||
        (dx === 0 && dy === 0)
      )
        return;
      const page = activePageOf(s);
      if (!page) return;
      const size = pageSize(page);
      const ids = new Set(s.selectedIds);
      const next = mapElements(page, ids, (el) => {
        if (el.locked) return el;
        const moved = { ...el, x: el.x + dx, y: el.y + dy };
        constrainElement(moved, size);
        return moved;
      });
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    /**
     * Grow or shrink an element's box to match its text.
     *
     * Called on every commit of a text edit. `autoHeight`/`autoWidth` boxes track
     * their content so the author never has to resize by hand, and the write is
     * folded into the same history entry as the edit itself.
     */
    fitTextBox: (id) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const found = locate(page, id);
      if (!found) return;
      const size = pageSize(page);
      const box = resolveTextBox(found.el);
      if (!box) return;
      const next = mapElement(page, id, (el) => {
        const merged = { ...el, w: box.w, h: box.h };
        constrainElement(merged, size);
        return merged;
      });
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      scheduleSave(500);
    },

    duplicateSelected: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const picked = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter((el): el is CanvasEl => Boolean(el));
      if (!picked.length) return;
      // Only top-level elements are duplicated onto the page: a group is one
      // element, and copying one of its members would need a new parent.
      const topLevel = picked.filter((el) =>
        page.elements.some((e) => e.id === el.id),
      );
      if (!topLevel.length) return;
      const copies = topLevel.map((el) => {
        const copy = clone(el);
        copy.id = uid("el");
        copy.x = el.x + 6;
        copy.y = el.y + 6;
        copy.z = nextZ(page);
        copy.name = `${el.name} نسخة`;
        return copy;
      });
      set({
        pages: s.pages.map((p) =>
          p.id === page.id ? { ...p, elements: [...p.elements, ...copies] } : p,
        ),
        selectedIds: copies.map((c) => c.id),
        selectedId: copies[copies.length - 1].id,
      });
      pushHistory();
    },

    copySelected: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const picked = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter((el): el is CanvasEl => Boolean(el));
      if (!picked.length) return;
      set({
        clipboard: clone(
          picked.length === 1
            ? picked[0]
            : createGroupFrom(picked) || picked[0],
        ),
      });
    },

    copyStyle: () => {
      const s = get();
      const source = s.selectedElements()[0];
      if (!source) return;
      set({ styleClipboard: clone(source.style || {}) });
      toast.success("تم نسخ التنسيق", {
        description: "حدد عنصرًا آخر ثم اختر «لصق التنسيق» لتطبيقه.",
      });
    },

    pasteStyle: () => {
      const s = get();
      if (!s.styleClipboard || !s.selectedIds.length) return;
      const page = activePageOf(s);
      if (!page) return;
      const style = clone(s.styleClipboard);
      let changed = false;
      const next = page.elements.map((root) => {
        const walk = (el: CanvasEl): CanvasEl => {
          if (!s.selectedIds.includes(el.id)) {
            return el.children?.length
              ? { ...el, children: el.children.map(walk) }
              : el;
          }
          changed = true;
          return { ...el, style: { ...style } };
        };
        return walk(root);
      });
      if (!changed) return;
      set({
        pages: s.pages.map((p) =>
          p.id === page.id ? { ...p, elements: next } : p,
        ),
      });
      pushHistory();
      toast.success("تم لصق التنسيق", {
        description: `${s.selectedIds.length} عنصر محدث بالتنسيق الجديد.`,
      });
    },

    pasteClipboard: (inPlace) => {
      const s = get();
      if (!s.clipboard) return;
      const page = activePageOf(s);
      if (!page) return;
      const el = clone(s.clipboard);
      el.id = uid(el.type === "group" ? "grp" : "el");
      // A group's children keep their relative positions, but each needs a fresh
      // id so the copies do not collide with the originals in the tree.
      if (el.children?.length) {
        const reid = (list: CanvasEl[]) =>
          list.forEach((c) => {
            c.id = uid("el");
            if (c.children?.length) reid(c.children);
          });
        reid(el.children);
      }
      if (!inPlace) {
        el.x += 8;
        el.y += 8;
      }
      el.z = nextZ(page);
      constrainElement(el, pageSize(page));
      set({
        pages: s.pages.map((p) =>
          p.id === page.id ? { ...p, elements: [...p.elements, el] } : p,
        ),
        selectedId: el.id,
        selectedIds: [el.id],
      });
      pushHistory();
    },

    deleteElementsById: (ids) => {
      const s = get();
      const page = activePageOf(s);
      if (!page || !ids.length) return;
      const wanted = new Set(ids);
      const strip = (list: CanvasEl[]): CanvasEl[] =>
        list
          .filter((el) => !(wanted.has(el.id) && !el.locked))
          .map((el) =>
            el.children?.length ? { ...el, children: strip(el.children) } : el,
          );
      const elements = strip(page.elements);
      if (elements.length === page.elements.length) return;
      const next = { ...page, elements };
      normalizeZ(next);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId:
          s.selectedId && wanted.has(s.selectedId) ? null : s.selectedId,
        selectedIds: s.selectedIds.filter((id) => !wanted.has(id)),
      });
      pushHistory();
    },
    mergeSelection: (image) => {
      const s = get();
      const page = activePageOf(s);
      if (!page || s.selectedIds.length < 2 || !safeImageSrc(image.src))
        return false;
      const ids = new Set(s.selectedIds);
      const selected = page.elements.filter((el) => ids.has(el.id));
      if (
        selected.length !== ids.size ||
        selected.some((el) => el.locked || el.hidden)
      ) {
        toast.error("يتطلب الدمج عناصر ظاهرة وغير مقفلة من الصفحة الحالية");
        return false;
      }
      const ordered = page.elements.slice().sort((a, b) => a.z - b.z);
      const positions = ordered
        .map((el, index) => (ids.has(el.id) ? index : -1))
        .filter((index) => index >= 0);
      if (positions.some((position, index) => position !== positions[0] + index)) {
        toast.error("يجب أن تكون الطبقات المحددة متجاورة للحفاظ على مظهر الصفحة");
        return false;
      }
      if (
        ![image.x, image.y, image.w, image.h].every(Number.isFinite) ||
        image.w <= 0 ||
        image.h <= 0
      )
        return false;
      const firstIndex = positions[0];
      const merged: CanvasEl = {
        id: uid("el"),
        type: "image",
        name: "عناصر مدمجة",
        x: image.x,
        y: image.y,
        w: image.w,
        h: image.h,
        rotation: 0,
        opacity: 1,
        z: 0,
        src: image.src,
        style: { objectFit: "fill", objectX: 50, objectY: 50 },
      };
      const elements = ordered
        .filter((el) => !ids.has(el.id))
        .map((el) =>
          el.clippedBy && ids.has(el.clippedBy)
            ? { ...el, clippedBy: undefined }
            : el,
        );
      elements.splice(firstIndex, 0, merged);
      const next = { ...page, elements };
      normalizeZ(next);
      set({
        pages: s.pages.map((candidate) =>
          candidate.id === page.id ? next : candidate,
        ),
        selectedId: merged.id,
        selectedIds: [merged.id],
      });
      pushHistory();
      return true;
    },
    deleteSelected: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      // Deleting an element inside a group removes just that member; only
      // top-level picks need the page list rewritten.
      const deletable = s.selectedIds.filter((id) => {
        const found = locate(page, id);
        return found && !found.el.locked;
      });
      if (!deletable.length) return;
      const ids = new Set(deletable);
      const strip = (list: CanvasEl[]): CanvasEl[] =>
        list
          .filter((el) => !ids.has(el.id))
          .map((el) =>
            el.children?.length ? { ...el, children: strip(el.children) } : el,
          );
      const elements = strip(page.elements);
      const next = { ...page, elements };
      normalizeZ(next);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: null,
        selectedIds: [],
      });
      pushHistory();
    },

    bring: (dir) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const picked = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter((el): el is CanvasEl => Boolean(el))
        .filter((el) => page.elements.some((e) => e.id === el.id));
      if (!picked.length) return;
      const ids = new Set(picked.map((el) => el.id));
      const elements = page.elements.map((el) => {
        if (!ids.has(el.id)) return el;
        const moved = clone(el);
        if (dir === "forward") moved.z += 1.5;
        if (dir === "back") moved.z -= 1.5;
        if (dir === "front") moved.z = page.elements.length + 2;
        if (dir === "bottom") moved.z = 0;
        return moved;
      });
      const next = { ...page, elements };
      normalizeZ(next);
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    /**
     * قناع القص (Clipping Mask).
     *
     * One `clippedBy` pointer on the masked element is the whole relationship:
     * the canvas clips its paint to the shape's silhouette, undo/redo restores
     * it like any other field, and removal clears the pointer. No parallel mask
     * tree to keep in sync with the page.
     */
    applyClipMask: (sourceId, shapeId) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const source = locate(page, sourceId)?.el;
      const shape = locate(page, shapeId)?.el;
      if (!source || !shape) return;
      const isShape = shape.type === "shape" || shape.type === "svg";
      const isImageFamily =
        source.type === "image" ||
        source.type === "logo" ||
        source.type === "qr" ||
        source.type === "svg";
      if (!isShape || !isImageFamily || sourceId === shapeId) return;
      /*
       * Frame the picture in the mask. Without this, a mask applied to two
       * elements that do not overlap produces an apparently empty shape — the
       * picture would sit entirely outside its own cut. When they already
       * overlap the author has placed it deliberately, so nothing is moved.
       */
      const ix = Math.max(
        0,
        Math.min(source.x + source.w, shape.x + shape.w) -
          Math.max(source.x, shape.x),
      );
      const iy = Math.max(
        0,
        Math.min(source.y + source.h, shape.y + shape.h) -
          Math.max(source.y, shape.y),
      );
      const covered = (ix * iy) / Math.max(1, shape.w * shape.h) > 0.6;
      let framed: Partial<{ x: number; y: number; w: number; h: number }> = {};
      if (!covered) {
        const scale = Math.max(
          shape.w / Math.max(1, source.w),
          shape.h / Math.max(1, source.h),
        );
        const w = source.w * scale;
        const h = source.h * scale;
        framed = {
          x: shape.x + (shape.w - w) / 2,
          y: shape.y + (shape.h - h) / 2,
          w,
          h,
        };
      }
      const next = mapElement(page, sourceId, (el) => ({
        ...el,
        ...framed,
        clippedBy: shapeId,
      }));
      set({
        pages: s.pages.map((p) => (p.id === page.id ? next : p)),
        selectedId: sourceId,
        selectedIds: [sourceId],
      });
      pushHistory();
      toast.success("تم تطبيق قناع القص (Clipping Mask)");
    },

    removeClipMask: (shapeId) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const masked = page.elements.filter((el) => el.clippedBy === shapeId);
      if (!masked.length) return;
      const ids = new Set(masked.map((el) => el.id));
      const next = mapElements(page, ids, (el) => ({
        ...el,
        clippedBy: undefined,
      }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
      toast.success("تمت إزالة قناع القص");
    },

    reorderLayers: (fromId, toId, side: LayerDropSide = "before") => {
      const s = get();
      const page = activePageOf(s);
      if (!page || fromId === toId) return;
      const from = locate(page, fromId);
      const to = locate(page, toId);
      if (!from || !to || from.list !== to.list) return;
      const nextList = restack(from.list, fromId, toId, side);
      if (!nextList) return;
      const next = replaceSiblingList(page, from.list, nextList);
      set({
        pages: s.pages.map((candidate) =>
          candidate.id === page.id ? next : candidate,
        ),
      });
      pushHistory();
    },

    toggleLock: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      // A locked group cannot be toggled: unlocking it would be the only way out
      // of a state the author just chose. Children follow their folder's state
      // for the same reason a hidden folder hides its contents (Phase 5).
      const next = mapElements(page, ids, (el) =>
        cascadeFlag(el, "locked", !el.locked),
      );
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    toggleResizeLock: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      // Independent per-element state: no folder cascade, and the flag never
      // touches `locked` — a resize-locked element still moves, rotates and
      // edits exactly like an unlocked one.
      const next = mapElements(page, ids, (el) => ({
        ...el,
        resizeLocked: !el.resizeLocked,
      }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    toggleWidthLock: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      const next = mapElements(page, ids, (el) => ({
        ...el,
        widthLocked: !el.widthLocked,
      }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    toggleHeightLock: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      const next = mapElements(page, ids, (el) => ({
        ...el,
        heightLocked: !el.heightLocked,
      }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    toggleAspectLock: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      const next = mapElements(page, ids, (el) => ({
        ...el,
        style: { ...el.style, aspectLock: !el.style?.aspectLock },
      }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    toggleHidden: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      // Hiding a folder hides its whole subtree, so the canvas and the layer
      // tree never disagree about what is on the page.
      const next = mapElements(page, ids, (el) =>
        cascadeFlag(el, "hidden", !el.hidden),
      );
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    flipSelected: (axis) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      const key = axis === "x" ? "flipX" : "flipY";
      const next = mapElements(page, ids, (el) => flipTree(el, key));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
      toast.success(axis === "x" ? "تم القلب أفقيًا" : "تم القلب رأسيًا");
    },

    toggleFadeOverlay: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      const target =
        page.elements.find((el) => ids.has(el.id)) ??
        locate(page, [...ids][0])?.el;
      if (!target || !FADE_TYPES.has(target.type)) {
        toast.error("طبقة التلاشي متاحة للصور والشعارات فقط");
        return;
      }
      const has = Boolean(normalizeFade(target.style?.fade));
      set({
        pages: s.pages.map((p) =>
          p.id === page.id
            ? {
                ...p,
                elements: p.elements.map((el) =>
                  ids.has(el.id) && FADE_TYPES.has(el.type)
                    ? {
                        ...el,
                        style: has
                          ? omitFade(el.style)
                          : { ...el.style, fade: { ...DEFAULT_FADE } },
                      }
                    : el,
                ),
              }
            : p,
        ),
      });
      pushHistory();
      toast.success(
        has
          ? "تمت إزالة طبقة التلاشي"
          : "تمت إضافة طبقة التلاشي (Fade Overlay)",
      );
    },

    copyElementToPage: (elId, pageId) => {
      const s = get();
      const source = s.pages.find((p) => Boolean(locate(p, elId)));
      const target = s.pages.find((p) => p.id === pageId);
      const el = source ? locate(source, elId)?.el : undefined;
      if (!source || !target || !el) return;
      const copy = cloneWithFreshIds(el);
      copy.z = nextZ(target);
      constrainElement(copy, pageSize(target));
      set({
        pages: s.pages.map((p) =>
          p.id === target.id ? { ...p, elements: [...p.elements, copy] } : p,
        ),
        activePageId: target.id,
        selectedId: copy.id,
        selectedIds: [copy.id],
      });
      pushHistory();
      toast.success(`تم نقل العنصر إلى «${target.name}»`);
    },

    addPage: (request) => {
      if (!requireEditorAccess()) return;
      const s = get();
      if (exceedsProjectPageLimit(s.pages.length + 1, s.entitlements)) {
        toast.error("وصلت إلى حد صفحات تجربة المحرر", {
          description:
            "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
        });
        return;
      }
      const sourcePage = s.pages.find((page) => page.id === s.activePageId);
      const preset = resolveNewPageSize({
        request,
        source: sourcePage,
        defaultSize: s.defaultSize,
      });
      const p: Page = {
        id: uid("page"),
        name: `صفحة ${s.pages.length + 1}`,
        elements: [],
        bg: THEMES[s.theme].paper,
        w: preset.w,
        h: preset.h,
      };
      set({
        pages: insertPageAfter(s.pages, p, sourcePage?.id),
        activePageId: p.id,
        selectedId: null,
        selectedIds: [],
        enteredGroupId: null,
        editingId: null,
        previewAll: true,
      });
      pushHistory();
    },

    addTemplatePage: (id) => {
      if (!requireEditorAccess()) return;
      const s = get();
      // This action inserts only the explicit, free built-in page gallery.
      // Licensed Admin-catalog templates enter through importProject, where
      // projectAccessBlock enforces their template lineage before editing.
      const template = templateById(id);
      if (!template) {
        toast.error("قالب الصفحة غير متاح");
        return;
      }
      if (exceedsProjectPageLimit(s.pages.length + 1, s.entitlements)) {
        toast.error("وصلت إلى حد صفحات تجربة المحرر", {
          description:
            "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
        });
        return;
      }
      const p = createTemplatePage(template.id, THEMES[s.theme], s.orgName);
      const sourcePage = s.pages.find((page) => page.id === s.activePageId);
      set({
        pages: insertPageAfter(s.pages, p, sourcePage?.id),
        activePageId: p.id,
        selectedId: null,
        selectedIds: [],
        enteredGroupId: null,
        editingId: null,
        previewAll: true,
      });
      pushHistory();
    },

    duplicatePage: (id) => {
      if (!requireEditorAccess()) return;
      const s = get();
      if (exceedsProjectPageLimit(s.pages.length + 1, s.entitlements)) {
        toast.error("وصلت إلى حد صفحات تجربة المحرر", {
          description:
            "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
        });
        return;
      }
      const targetId = id || s.activePageId;
      const page = s.pages.find((p) => p.id === targetId);
      if (!page) return;
      const copy: Page = {
        ...clone(page),
        id: uid("page"),
        name: `${page.name} نسخة`,
        elements: page.elements.map(cloneWithFreshIds),
      };
      const idx = s.pages.findIndex((p) => p.id === page.id);
      const pages = [...s.pages];
      pages.splice(idx + 1, 0, copy);
      set({
        pages,
        activePageId: copy.id,
        selectedId: null,
        selectedIds: [],
        enteredGroupId: null,
        editingId: null,
      });
      pushHistory();
    },

    toggleArtboardLock: (id) => {
      const s = get();
      const targetId = id || s.activePageId;
      const targetPage = s.pages.find((p) => p.id === targetId);
      if (!targetPage) return;
      const newLocked = !targetPage.locked;
      const pages = s.pages.map((p) =>
        p.id === targetId ? { ...p, locked: newLocked } : p,
      );
      set({ pages });
      pushHistory();
      toast.success(
        newLocked ? "تم قفل لوحة التصميم" : "تم فك قفل لوحة التصميم",
      );
    },

    toggleArtboardHidden: (id) => {
      const s = get();
      const targetId = id || s.activePageId;
      const targetPage = s.pages.find((p) => p.id === targetId);
      if (!targetPage) return;
      const newHidden = !targetPage.hidden;
      const pages = s.pages.map((p) =>
        p.id === targetId ? { ...p, hidden: newHidden } : p,
      );
      set({ pages });
      pushHistory();
      toast.success(
        newHidden ? "تم إخفاء لوحة التصميم" : "تم إظهار لوحة التصميم",
      );
    },

    splitArtboardPage: (id, direction = "horizontal") => {
      if (!requireEditorAccess()) return;
      const s = get();
      if (exceedsProjectPageLimit(s.pages.length + 1, s.entitlements)) {
        toast.error("وصلت إلى حد صفحات تجربة المحرر", {
          description: "افتح النسخة الكاملة لتقسيم اللوحات والمزيد من الصفحات.",
        });
        return;
      }
      const targetId = id || s.activePageId;
      const targetPage = s.pages.find((p) => p.id === targetId);
      if (!targetPage) return;

      const { firstPage, secondPage } = splitArtboard(targetPage, direction);
      const idx = s.pages.findIndex((p) => p.id === targetId);
      const nextPages = [...s.pages];
      nextPages.splice(idx, 1, firstPage, secondPage);

      set({
        pages: nextPages,
        activePageId: secondPage.id,
        selectedId: null,
        selectedIds: [],
        enteredGroupId: null,
        editingId: null,
        previewAll: true,
      });
      pushHistory();
      toast.success(
        direction === "horizontal"
          ? "تم تقسيم لوحة التصميم أفقياً إلى جزأين"
          : "تم تقسيم لوحة التصميم رأسياً إلى جزأين",
      );
    },

    addArtboardAdjacent: (targetId, direction) => {
      if (!requireEditorAccess()) return;
      const s = get();
      if (exceedsProjectPageLimit(s.pages.length + 1, s.entitlements)) {
        toast.error("وصلت إلى حد صفحات تجربة المحرر", {
          description:
            "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
        });
        return;
      }
      const page = s.pages.find((p) => p.id === targetId) || s.pages[0];
      const size = pageSize(page);
      const newArtboard: Page = {
        ...(page ? clone(page) : {}),
        id: uid("page"),
        name: `لوحة ${s.pages.length + 1}`,
        elements: [],
        bg: page?.bg || THEMES[s.theme].paper,
        w: size.w,
        h: size.h,
      };
      // New artboards inherit the source page's content/layout configuration,
      // but not its empty state or interaction lock/visibility flags.
      delete newArtboard.locked;
      delete newArtboard.hidden;

      const idx = s.pages.findIndex((p) => p.id === targetId);
      const pages = [...s.pages];
      // UI grid is RTL: right precedes, left follows; document coordinates stay LTR.
      const insertAt =
        direction === "top" || direction === "right"
          ? Math.max(0, idx)
          : idx >= 0
            ? idx + 1
            : pages.length;
      pages.splice(insertAt, 0, newArtboard);

      set({
        pages,
        activePageId: newArtboard.id,
        selectedId: null,
        selectedIds: [],
        enteredGroupId: null,
        editingId: null,
        previewAll: true,
      });
      pushHistory();
      toast.success("تمت إضافة لوحة تصميم بجانب اللوحة المحددة");
    },

    deletePage: (id) => {
      const s = get();
      if (s.pages.length <= 1) {
        toast.error("لا يمكن حذف الصفحة الوحيدة");
        return;
      }
      const targetId = id || s.activePageId;
      const idx = s.pages.findIndex((p) => p.id === targetId);
      if (idx < 0) return;
      const pages = s.pages.filter((p) => p.id !== targetId);
      const nextActive =
        targetId === s.activePageId
          ? pages[Math.max(0, idx - 1)].id
          : s.activePageId;
      set({
        pages,
        activePageId: nextActive,
        ...(targetId === s.activePageId
          ? {
              selectedId: null,
              selectedIds: [],
              enteredGroupId: null,
              editingId: null,
            }
          : {}),
      });
      pushHistory();
    },

    movePage: (dir) => {
      const s = get();
      const idx = s.pages.findIndex((p) => p.id === s.activePageId);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= s.pages.length) return;
      const pages = [...s.pages];
      const [item] = pages.splice(idx, 1);
      pages.splice(next, 0, item);
      set({ pages });
      pushHistory();
    },

    movePageById: (id, dir) => {
      const s = get();
      const idx = s.pages.findIndex((p) => p.id === id);
      const next = idx + dir;
      if (idx < 0 || next < 0 || next >= s.pages.length) return;
      const pages = [...s.pages];
      const [item] = pages.splice(idx, 1);
      pages.splice(next, 0, item);
      set({ pages });
      pushHistory();
    },

    reorderPages: (from, to) => {
      const s = get();
      if (
        from === to ||
        from < 0 ||
        to < 0 ||
        from >= s.pages.length ||
        to >= s.pages.length
      )
        return;
      const pages = [...s.pages];
      const [item] = pages.splice(from, 1);
      pages.splice(to, 0, item);
      set({ pages });
      pushHistory();
    },

    renamePage: (id, name) => {
      const target = get().pages.find((p) => p.id === id);
      if (!target || target.name === name) return;
      set({
        pages: get().pages.map((p) => (p.id === id ? { ...p, name } : p)),
      });
      scheduleSave(500);
    },

    setPageBackground: (id, paint, live = false) => {
      const s = get();
      const page = s.pages.find((p) => p.id === id);
      if (!page || page.locked) return;
      set({
        pages: s.pages.map((p) => {
          if (p.id !== id) return p;
          const next = {
            ...p,
            ...paint,
            ...(Object.hasOwn(paint, "bgGradient")
              ? { bgGradient: normalizeGradient(paint.bgGradient) }
              : {}),
          };
          if (Object.hasOwn(paint, "bgImage") && !paint.bgImage)
            delete next.bgImage;
          return next;
        }),
      });
      if (live) scheduleSave();
      else pushHistory();
    },

    setClipExport: (on) => {
      if (get().clipExport === on) return;
      set({
        clipExport: on,
        editorSettings: { ...get().editorSettings, clipExport: on },
      });
      scheduleSave(400);
    },

    setShowOutsidePage: (on) => {
      const next = normalizeShowOutsidePage(on);
      /*
       * A workspace preference, not a document property: it lives in the same
       * UI slot as the grid and the snapping switches, so it survives a reload
       * and follows the author into every file — and it never touches the
       * pages, which is why no save is scheduled and no history entry is
       * pushed. Flipping it cannot lose artwork: only the artboard's clipping
       * changes.
       */
      if (get().showOutsidePage === next) {
        writeUi({ showOutsidePage: next });
        return;
      }
      set({ showOutsidePage: next });
      writeUi({ showOutsidePage: next });
    },

    setPageSize: (id, sizeId, custom) => {
      const s = get();
      const preset = sizePreset(sizeId);
      const w = sizeId === "custom" ? Number(custom?.w) || preset.w : preset.w;
      const h = sizeId === "custom" ? Number(custom?.h) || preset.h : preset.h;
      set({
        defaultSize: sizeId === "custom" ? s.defaultSize : sizeId,
        pages: s.pages.map((p) => {
          if (p.id !== id) return p;
          const next: Page = {
            ...p,
            w,
            h,
            elements: p.elements.map((e) => clone(e)),
          };
          next.elements.forEach((e) => constrainElement(e, { w, h }));
          return next;
        }),
      });
      pushHistory();
    },

    setAllPageSizes: (sizeId, custom) => {
      const s = get();
      const preset = sizePreset(sizeId);
      const w = sizeId === "custom" ? Number(custom?.w) || preset.w : preset.w;
      const h = sizeId === "custom" ? Number(custom?.h) || preset.h : preset.h;
      set({
        defaultSize: sizeId,
        pages: s.pages.map((p) => {
          const next: Page = {
            ...p,
            w,
            h,
            elements: p.elements.map((e) => clone(e)),
          };
          next.elements.forEach((e) => constrainElement(e, { w, h }));
          return next;
        }),
      });
      pushHistory();
    },

    /**
     * Align to a page edge — the single-element convenience that predates
     * `align`. Routes through the same code path so a multi-selection behaves
     * consistently whether the author picks "align to page" here or in the
     * align menu.
     */
    alignPage: (edge) => {
      get().align(edge, "page");
    },

    undo: () => {
      const { past, future } = get();
      if (past.length <= 1) return;
      const current = past[past.length - 1];
      const prev = past[past.length - 2];
      // `applyProject` normalises in place (it fills defaults on the object it
      // is handed), so the entry is cloned first: mutating history would
      // corrupt the live document that shares its untouched pages.
      const restored = clone(prev) as ProjectSnapshot;
      applyProject(restored, restoreSelectionExtra(restored));
      set({ past: past.slice(0, -1), future: [current, ...future] });
      scheduleSave(300);
    },

    redo: () => {
      const { past, future } = get();
      if (!future.length) return;
      const [next, ...rest] = future;
      const restored = clone(next) as ProjectSnapshot;
      applyProject(restored, restoreSelectionExtra(restored));
      set({ past: [...past, next], future: rest });
      scheduleSave(300);
    },

    commit: () => pushHistory(),
  };
});

interface PersistedUi {
  activeProjectId?: string;
  dark?: boolean;
  zoom?: number;
  focusMode?: boolean;
  leftOpen?: boolean;
  rightOpen?: boolean;
  leftCollapsed?: boolean;
  rightCollapsed?: boolean;
  /** Split inspector windows (absent = closed, the old default). */
  layersOpen?: boolean;
  reportToolsOpen?: boolean;
  libraryOpen?: boolean;
  toolsOpen?: boolean;
  artboardGridCols?: number;
  pagesPanelHeight?: number;
  /** Collapsed pages rail (absent = expanded thumbnail tray). */
  pagesRailCollapsed?: boolean;
  /** Hidden pages rail (absent = shown). */
  pagesRailHidden?: boolean;
  /** Floating bubble visibility (absent = shown). */
  bubble?: boolean;
  /** Manual floating-bubble offset (absent = automatic placement). */
  bubbleOffset?: { dx: number; dy: number } | null;
  /** Print-guide visibility (absent = all off). */
  printGuides?: PrintGuideSettings;
  /** Canvas grid (absent = off). */
  showGrid?: boolean;
  /** Snap to the grid (absent = on). */
  snapGrid?: boolean;
  /** Snap to other elements (absent = on). */
  snapElements?: boolean;
  /** Artwork outside the page rectangle stays visible (absent = on). */
  showOutsidePage?: boolean;
}

/**
 * The workspace preferences that survive a reload.
 *
 * They live in the same slot as the rest of the shell state so «الإعدادات →
 * المحرر» and the toolbar switches can never hold two versions of the truth.
 */
type PersistedWorkspaceToggle = "showGrid" | "snapGrid" | "snapElements";

/** Absent-means-default for each persisted workspace toggle. */
const WORKSPACE_TOGGLE_DEFAULTS: Record<PersistedWorkspaceToggle, boolean> = {
  showGrid: false,
  snapGrid: true,
  snapElements: true,
};

/** Merge a patch into the persisted UI slot (zoom, panels, pages height…). */
function writeUi(patch: PersistedUi): void {
  try {
    const current = readUi();
    localStorage.setItem(UI_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* a full/blocked localStorage must never break an interaction */
  }
}

/* ── Crash/reload draft safety net ──────────────────────────────────────────
 *
 * Auto-save is debounced (≈0.4–0.9 s) and writes IndexedDB, which a hard
 * reload does not reliably wait for. When the page is being torn down with
 * unsaved work we therefore ALSO write a compact draft envelope
 * synchronously to localStorage. On the next hydrate, a draft that is newer
 * than the stored project row wins, so an accidental ⌘R never destroys the
 * author's last edits. The draft is deleted the moment a real save lands.
 */

const DRAFT_KEY = "nasaq-draft-v1";
/** localStorage ceiling for the draft blob — bigger documents stay on the
 * (already scheduled) IndexedDB path only. */
const DRAFT_MAX_CHARS = 4_500_000;

interface DraftEnvelope {
  ownerId: string;
  projectId: string | undefined;
  savedAt: number;
  activePageId: string;
  project: ProjectSnapshot;
}

/** Synchronous — safe to call from `beforeunload`/`pagehide`. */
export function writeDraftSnapshot(): void {
  try {
    const s = useEditor.getState();
    if (!s.pages?.length) return;
    const owner = getStorageOwner();
    const envelope: DraftEnvelope = {
      ownerId: owner,
      projectId: s.id,
      savedAt: Date.now(),
      activePageId: s.activePageId,
      project: projectSlice(s),
    };
    const raw = JSON.stringify(envelope);
    if (raw.length > DRAFT_MAX_CHARS) return; // image-heavy: IDB flush instead
    localStorage.setItem(DRAFT_KEY, raw);
  } catch {
    /* quota/blocked storage: the IndexedDB flush is the remaining net */
  }
}

function readDraftSnapshot(owner: string): DraftEnvelope | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope;
    if (!parsed || parsed.ownerId !== owner || !parsed.project?.pages?.length)
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraftSnapshot(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Coalesce rapid saves of one-shot UI values (zoom, active page) into one
 * IndexedDB write. Zoom gestures and page switches used to fire a `setSetting`
 * per tick — each one an async transaction for a value that changes again
 * milliseconds later.
 */
const settingWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

function debounceSetting(key: SettingsKey, value: unknown, delay = 500): void {
  const existing = settingWriteTimers.get(key);
  if (existing) clearTimeout(existing);
  settingWriteTimers.set(
    key,
    setTimeout(() => {
      settingWriteTimers.delete(key);
      void setSetting(key, value);
    }, delay),
  );
}

function readUi(): PersistedUi {
  try {
    // Falls back to the pre-rebrand slot so dark mode, zoom and the active
    // project survive the rename instead of resetting to defaults.
    const raw =
      localStorage.getItem(UI_KEY) ?? localStorage.getItem(LEGACY_UI_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed ? (parsed as PersistedUi) : {};
  } catch {
    return {};
  }
}

/** Coalesces the pages-rail height localStorage writes of one drag. */
let pagesUiWriteTimer: ReturnType<typeof setTimeout> | null = null;

/** Resolve after the next two animation frames — enough for React to paint. */
function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export function getActivePage(): Page {
  return activePageOf(useEditor.getState());
}

export function getSelected(): CanvasEl | null {
  const s = useEditor.getState();
  const page = activePageOf(s);
  if (!page || !s.selectedId) return null;
  // Resolves through groups so a member picked inside a group is editable.
  return findElement(page.elements, s.selectedId)?.el || null;
}

/** All currently selected elements of the active page, primary last. */
export function getSelectedMany(): CanvasEl[] {
  return useEditor.getState().selectedElements();
}

/** Human label for the autosave indicator. */
export function saveLabel(
  state: SaveState,
  savedAt: number | null,
  now: number,
): string {
  if (state === "saving") return "جارٍ الحفظ…";
  if (state === "error") return "تعذر الحفظ — تحقق من مساحة المتصفح";
  if (state === "dirty") return "تغييرات غير محفوظة…";
  if (!savedAt) return "جاهز";
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 5) return "تم الحفظ";
  if (seconds < 60) return `آخر حفظ منذ ${seconds} ثانية`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `آخر حفظ منذ ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  return `آخر حفظ منذ ${hours} ساعة`;
}

/*
 * ── Macro context ─────────────────────────────────────────────────────────
 *
 * `{التاريخ_الهجري}`, `{اسم_الجهة}` and friends resolve inside `prepareText`,
 * which the canvas, the properties panel and three exporters all call. Rather
 * than thread the document through each of them, one subscription here keeps the
 * context in step with the store: any write that changes the entity, the
 * transaction number, the page count or the active page refreshes it.
 *
 * Per-page rendering (the HTML and Office exporters) refines the page number
 * locally — a whole document is painted in one pass, so page 2 and page 9 cannot
 * share one ambient number.
 */
function syncTextContext(state: EditorStore): void {
  const index = state.pages.findIndex((p) => p.id === state.activePageId);
  setTextContext({
    orgName: state.orgName,
    transactionNo: state.transactionNo,
    pageNumber: Math.max(1, index + 1),
    pageCount: Math.max(1, state.pages.length),
  });
}

syncTextContext(useEditor.getState());

useEditor.subscribe((state, prev) => {
  if (
    state.orgName === prev.orgName &&
    state.transactionNo === prev.transactionNo &&
    state.pages === prev.pages &&
    state.activePageId === prev.activePageId
  ) {
    return;
  }
  syncTextContext(state);
});

export function editorAccessResolved(): boolean {
  return hasResolvedEditorAccess(useEditor.getState(), getStorageOwner());
}

export { UI_KEY };
export const A4_SIZE = A4;
