import { create } from "zustand";
import { toast } from "sonner";
import {
  A4,
  GRID,
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
  scaleChildren,
  sizePreset,
  type AlignEdge,
  type CanvasEl,
  type ElType,
  type Page,
  type PackId,
  type Project,
  type ProjectMeta,
  type ProjectSnapshot,
  type SizeId,
  type ThemeId,
} from "./model";
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
} from "./storage";
import { createProject, createTemplatePage } from "./templates";
import { FONTS, LEGACY_STORE_KEY, LEGACY_UI_KEY, TYPE_NAME, UI_KEY } from "./model";
import { detectDeviceFonts, type DetectedFont } from "./fonts";
import { resolveTextBox } from "./text-render";
import { safeImageSrc } from "./images";
import { clamp, uid } from "@/lib/utils";
import { canAddDemoPage, canCreateDemoProject, canUseDemoPack } from "@/lib/product/product";

export type LeftTab = "elements" | "shapes" | "templates" | "theme" | "pages" | "fonts" | "settings";
export type RightTab = "properties" | "layers";
export type View = "home" | "editor";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** Bundled families as the initial (pre-probe) font list. */
function bundledFontChoices(): FontChoice[] {
  return FONTS.map((family) => ({ family, note: "مضمّن في المنصة", source: "bundled" as const }));
}

/**
 * Order the font list: bundled first (always present), then families found on
 * this device, then anything the author uploaded. De-duplicated by family so a
 * system font that is also bundled does not appear twice.
 */
function mergeFontChoices(detected: DetectedFont[], uploaded: FontChoice[]): FontChoice[] {
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
  previewAll: boolean;
  focusMode: boolean;
  dark: boolean;
  leftTab: LeftTab;
  rightTab: RightTab;
  leftOpen: boolean;
  rightOpen: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  exportOpen: boolean;
  pageManagerOpen: boolean;
  saveState: SaveState;
  savedAt: number | null;
  /** Re-renders the "saved N minutes ago" label without polling the store. */
  clockTick: number;
}

interface History {
  past: string[];
  future: string[];
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
  clipboard: CanvasEl | null;
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
  addAsset: (asset: { name: string; src: string; w: number; h: number; folderId?: string | null }) => Promise<Asset | null>;
  removeAsset: (id: string) => Promise<void>;
  renameAsset: (id: string, name: string) => Promise<void>;
  setAssetFolder: (id: string | null) => void;
  toggleAssetSelect: (id: string) => void;
  clearAssetSelection: () => void;
  createAssetFolder: (name: string) => Promise<void>;
  renameAssetFolder: (id: string, name: string) => Promise<void>;
  deleteAssetFolder: (id: string) => Promise<void>;
  moveAssetsToFolder: (ids: string[], folderId: string | null) => Promise<void>;
  /** Bundled + detected + uploaded families, in display order. */
  fontChoices: FontChoice[];
  /** True once the one-off device probe has run. */
  fontsProbed: boolean;
  probeFonts: () => void;
  registerFont: (family: string, note?: string) => void;
  hydrate: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  createProject: (pack: PackId, theme?: ThemeId) => Promise<boolean>;
  openProject: (id: string) => Promise<void>;
  saveNow: () => Promise<void>;
  renameProject: (id: string, name: string) => Promise<void>;
  duplicateProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  importProject: (data: Partial<Project>) => Promise<void>;
  setZoom: (z: number) => void;
  toggle: (
    key: keyof Pick<
      Ui,
      "showGrid" | "snapGrid" | "snapElements" | "previewAll" | "dark" | "leftOpen" | "rightOpen" | "leftCollapsed" | "rightCollapsed" | "focusMode" | "exportOpen" | "pageManagerOpen"
    >,
  ) => void;
  setLeftTab: (t: LeftTab) => void;
  setRightTab: (t: RightTab) => void;
  setTheme: (id: ThemeId) => void;
  setName: (name: string) => void;
  setOrg: (org: string) => void;
  setActivePage: (id: string) => void;
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
  linkSelected: () => void;
  unlinkSelected: () => void;
  /** Step into a group so its children can be picked individually. */
  enterGroup: (id: string | null) => void;
  /** Selected elements of the active page, primary first. */
  selectedElements: () => CanvasEl[];
  group: () => void;
  ungroup: () => void;
  align: (edge: AlignEdge, frame: "selection" | "page") => void;
  distribute: (axis: "h" | "v") => void;
  /** Rename an element from the layers panel. */
  renameElement: (id: string, name: string) => void;
  setElementFlag: (id: string, flag: "locked" | "hidden", value?: boolean) => void;
  moveLayer: (id: string, dir: -1 | 1) => void;
  /** Reorder top-level layers using their visible (front-to-back) list order. */
  reorderLayers: (fromId: string, toId: string) => void;
  addElement: (type: ElType, over?: Partial<CanvasEl>) => string | undefined;
  /** Create a text element at an exact drawn box (the «نص بالرسم» tool). */
  addTextAt: (box: { x: number; y: number; w: number; h: number }, pageId?: string) => string | undefined;
  updateElement: (id: string, patch: Partial<CanvasEl>, live?: boolean) => void;
  updateStyle: (id: string, patch: CanvasEl["style"], live?: boolean) => void;
  replaceElement: (el: CanvasEl, live?: boolean) => void;
  fitTextBox: (id: string) => void;
  duplicateSelected: () => void;
  copySelected: () => void;
  pasteClipboard: () => void;
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
  toggleHidden: () => void;
  /**
   * Copy an element straight into another page. The clipboard alone can do this
   * (copy → switch page → paste), but that loses the current selection and the
   * source page context, so the layers panel offers a direct action.
   */
  copyElementToPage: (elId: string, pageId: string) => void;
  addPage: (size?: SizeId) => void;
  addTemplatePage: (id: string) => void;
  duplicatePage: (id?: string) => void;
  deletePage: (id?: string) => void;
  movePage: (dir: -1 | 1) => void;
  movePageById: (id: string, dir: -1 | 1) => void;
  reorderPages: (from: number, to: number) => void;
  renamePage: (id: string, name: string) => void;
  setPageSize: (id: string, sizeId: SizeId, custom?: { w: number; h: number }) => void;
  setAllPageSizes: (sizeId: SizeId, custom?: { w: number; h: number }) => void;
  alignPage: (edge: "left" | "right" | "center" | "top" | "middle" | "bottom") => void;
  undo: () => void;
  redo: () => void;
  commit: () => void;
}

function projectSlice(s: ProjectSnapshot): ProjectSnapshot {
  return {
    version: s.version,
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

function snap(v: number, enabled: boolean) {
  if (!enabled) return v;
  return Math.round(v / GRID) * GRID;
}

const blank = createProject("official");

/**
 * The part of `page` (in document mm, page-relative) currently visible in the
 * canvas viewport. Used by centered inserts so new elements appear where the
 * author is looking. When the viewport is unknown (SSR, tests) or the page is
 * entirely off-screen, falls back to the whole page so insertion stays visible.
 */
function visiblePageRect(
  stage: HTMLElement | null,
  page: Page,
  zoom: number,
  previewAll: boolean,
): { x: number; y: number; w: number; h: number } {
  const size = pageSize(page);
  try {
    const host = stage?.querySelector<HTMLElement>(`[data-page-id="${page.id}"]`) ?? null;
    if (stage && host) {
      const vr = stage.getBoundingClientRect();
      const pr = host.getBoundingClientRect();
      const x0 = Math.max(0, (vr.left - pr.left) / zoom);
      const y0 = Math.max(0, (vr.top - pr.top) / zoom);
      const x1 = Math.min(size.w, (vr.right - pr.left) / zoom);
      const y1 = Math.min(size.h, (vr.bottom - pr.top) / zoom);
      if (x1 > x0 && y1 > y0) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  } catch {
    /* no viewport (SSR/tests) — fall through */
  }
  void previewAll;
  return { x: 0, y: 0, w: size.w, h: size.h };
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
function mapElement(page: Page, id: string, fn: (el: CanvasEl) => CanvasEl): Page {
  const walk = (list: CanvasEl[]): CanvasEl[] =>
    list.map((el) => (el.id === id ? fn(el) : el.children?.length ? { ...el, children: walk(el.children) } : el));
  return { ...page, elements: walk(page.elements) };
}

function mapElements(page: Page, ids: Set<string>, fn: (el: CanvasEl) => CanvasEl): Page {
  const walk = (list: CanvasEl[]): CanvasEl[] =>
    list.map((el) => {
      const next = ids.has(el.id) ? fn(el) : el;
      return next.children?.length ? { ...next, children: walk(next.children) } : next;
    });
  return { ...page, elements: walk(page.elements) };
}

/** Where an element lives: the array holding it and its index there. */
function locate(page: Page, id: string) {
  return findElement(page.elements, id);
}

function cloneWithFreshIds(el: CanvasEl): CanvasEl {
  const copy = clone(el);
  copy.id = uid(copy.type === "group" ? "grp" : "el");
  if (copy.children?.length) copy.children = copy.children.map(cloneWithFreshIds);
  return copy;
}

/** True when `ancestorId` contains `id` at any depth. */
function isDescendant(page: Page, ancestorId: string, id: string): boolean {
  const found = findElement(page.elements, ancestorId);
  if (!found?.el.children?.length) return false;
  return Boolean(findElement(found.el.children, id));
}

/**
 * Element ids the user can actually click given the current group context.
 *
 * A group behaves as one element from outside, so clicking it selects the whole
 * group; stepping into it (double-click) narrows the picks to its children.
 */
function pickable(page: Page, enteredGroupId: string | null, id: string): boolean {
  if (!enteredGroupId) {
    // Top level only: children of a group are reached by entering it.
    return page.elements.some((e) => e.id === id);
  }
  return isDescendant(page, enteredGroupId, id) || page.elements.some((e) => e.id === id);
}

/** Normalises anything loaded from disk, a file, or an older schema version. */
function normalizeProject(incoming: ProjectSnapshot): ProjectSnapshot {
  const pages = incoming.pages?.length ? incoming.pages : createProject("blank").pages;
  pages.forEach((p) => {
    p.elements ||= [];
    p.w = pageSize(p).w;
    p.h = pageSize(p).h;
    const size = pageSize(p);
    // Groups added a second level of elements; normalize elements at any depth
    // so a project written before groups existed loads unchanged.
    const normalizeEl = (el: CanvasEl) => {
      el.style ||= {};
      el.opacity ??= 1;
      el.rotation ??= 0;
      el.name ||= TYPE_NAME[el.type] || "عنصر";
      // Imported projects carry image sources as plain strings; drop any that
      // could execute script before they reach the canvas or an export.
      if (el.src) el.src = safeImageSrc(el.src);
      if (el.children?.length) el.children.forEach(normalizeEl);
      constrainElement(el, size);
    };
    p.elements.forEach(normalizeEl);
    normalizeZ(p);
  });
  return {
    version: incoming.version || 2,
    name: incoming.name || "تقرير",
    theme: incoming.theme || "official",
    orgName: incoming.orgName || "",
    pages,
    id: incoming.id,
    createdAt: incoming.createdAt,
    updatedAt: incoming.updatedAt,
    // Preserved so undo/redo can restore the page the user was on — see
    // Project.activePageId. Fresh loads (library/template open) never set
    // it, so applyProject still falls back to the first page for those.
    activePageId: incoming.activePageId,
    defaultSize: incoming.defaultSize || "a4-portrait",
  };
}

export const useEditor = create<EditorStore>((set, get) => {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced autosave. Kept off the render path: no store writes until it fires. */
  const scheduleSave = (delay = 900) => {
    if (saveTimer) clearTimeout(saveTimer);
    if (get().saveState !== "saving") set({ saveState: "dirty" });
    saveTimer = setTimeout(() => {
      void get().saveNow();
    }, delay);
  };

  const pushHistory = () => {
    const snapStr = JSON.stringify(projectSlice(get()));
    const past = [...get().past, snapStr];
    if (past.length > 60) past.shift();
    set({ past, future: [] });
    scheduleSave();
  };

  const applyProject = (incoming: ProjectSnapshot, extra: Partial<EditorStore> = {}) => {
    const project = normalizeProject(incoming);
    // Prefer an explicit caller override, then the page the snapshot itself
    // remembers being on (undo/redo), then fall back to the first page for
    // a genuinely fresh load. Guard against a stale id pointing at a page
    // that no longer exists in this particular snapshot.
    const wanted = extra.activePageId || project.activePageId;
    const activePageId =
      (wanted && project.pages.some((p) => p.id === wanted) ? wanted : undefined) ||
      project.pages[0]?.id;
    set({
      ...project,
      activePageId,
      selectedId: null,
      selectedIds: [],
      enteredGroupId: null,
      editingId: null,
      ...extra,
    });
  };

  /**
   * Apply a batch of new positions as one undoable step.
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
        const withChildren = next.children?.length ? { ...next, children: walk(next.children) } : next;
        return withChildren;
      });
    set({ pages: s.pages.map((p) => (p.id === page.id ? { ...p, elements: walk(p.elements) } : p)) });
    pushHistory();
  };

  return {
    ...blank,
    activePageId: blank.pages[0].id,
    selectedId: null,
    selectedIds: [],
    enteredGroupId: null,
    editingId: null,
    zoom: 0.82,
    showGrid: false,
    snapGrid: true,
    snapElements: true,
    previewAll: true,
    focusMode: false,
    dark: true,
    leftTab: "elements",
    rightTab: "properties",
    leftOpen: false,
    rightOpen: false,
    leftCollapsed: false,
    rightCollapsed: false,
    exportOpen: false,
    pageManagerOpen: false,
    saveState: "idle",
    savedAt: null,
    clockTick: 0,
    hydrated: false,
    clipboard: null,
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
      set({ fontChoices: [...list, { family: trimmed, note: note || "خط مرفوع", source: "uploaded" }] });
    },

    hydrate: async () => {
      if (get().hydrated) return;
      const mode = storageMode();
      set({ storage: { mode, persistent: mode === "indexeddb" } });

      try {
        const ui = readUi();
        const legacy = localStorage.getItem(LEGACY_STORE_KEY);
        let list = await listProjects();
        if (!list.length && legacy) {
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
        const activeId = (await getSetting<string>("activeProjectId")) || ui.activeProjectId;
        const active = activeId ? await getProject(activeId) : null;
        const dark = ui.dark == null ? true : Boolean(ui.dark);
        // Re-apply the persisted theme to <html> on boot (same contract as
        // toggle("dark") — without it a reload loses the dark utilities).
        document.documentElement.classList.toggle("dark", dark);
        set({
          projects: list,
          projectsLoading: false,
          dark,
          focusMode: Boolean(ui.focusMode),
          leftOpen: Boolean(ui.leftOpen),
          rightOpen: Boolean(ui.rightOpen),
          leftCollapsed: Boolean(ui.leftCollapsed),
          rightCollapsed: Boolean(ui.rightCollapsed),
          previewAll: true,
          zoom: typeof ui.zoom === "number" ? clamp(ui.zoom, 0.35, 1.6) : 0.82,
        });
        if (active) applyProject(active, { zoom: get().zoom });
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

      document.documentElement.lang = "ar";
      document.documentElement.dir = "rtl";
      set({ hydrated: true, past: [JSON.stringify(projectSlice(get()))], future: [], saveState: "saved", savedAt: Date.now() });
    },

    refreshProjects: async () => {
      set({ projectsLoading: true });
      const list = await listProjects();
      set({ projects: list, projectsLoading: false });
    },

    refreshAssets: async () => {
      const assets = await listAssets();
      set({ assets, assetsLoading: false });
    },

    addAsset: async (asset) => {
      try {
        const saved = await saveAsset(asset);
        set({ assets: [saved, ...get().assets.filter((a) => a.id !== saved.id)] });
        return saved;
      } catch {
        // A full or unavailable store must not lose the element the author is
        // placing right now — only the "save for later" half fails.
        toast.error("تعذر حفظ العنصر في المكتبة", {
          description: "قد تكون مساحة التخزين ممتلئة. العنصر أُضيف إلى الصفحة على أي حال.",
        });
        return null;
      }
    },

    removeAsset: async (id) => {
      await removeAsset(id);
      set({ assets: get().assets.filter((a) => a.id !== id) });
    },

    renameAsset: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await renameAssetRow(id, trimmed);
      set({ assets: get().assets.map((a) => (a.id === id ? { ...a, name: trimmed } : a)) });
    },

    setAssetFolder: (id) => set({ assetFolderId: id, selectedAssetIds: [] }),
    toggleAssetSelect: (id) => set((state) => ({
      selectedAssetIds: state.selectedAssetIds.includes(id)
        ? state.selectedAssetIds.filter((item) => item !== id)
        : [...state.selectedAssetIds, id],
    })),
    clearAssetSelection: () => set({ selectedAssetIds: [] }),
    createAssetFolder: async (name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const folder = { id: uid("folder"), name: trimmed, createdAt: Date.now() };
      const folders = [...get().assetFolders, folder];
      set({ assetFolders: folders });
      await setSetting("assetFolders", folders);
    },
    renameAssetFolder: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const folders = get().assetFolders.map((folder) => folder.id === id ? { ...folder, name: trimmed } : folder);
      set({ assetFolders: folders });
      await setSetting("assetFolders", folders);
    },
    deleteAssetFolder: async (id) => {
      const folders = get().assetFolders.filter((folder) => folder.id !== id);
      const assets = get().assets.map((asset) => asset.folderId === id ? { ...asset, folderId: null } : asset);
      await Promise.all(assets.filter((asset) => asset.folderId === null).map((asset) => saveAsset(asset)));
      set({ assetFolders: folders, assets, assetFolderId: get().assetFolderId === id ? null : get().assetFolderId, selectedAssetIds: [] });
      await setSetting("assetFolders", folders);
    },
    moveAssetsToFolder: async (ids, folderId) => {
      const selected = new Set(ids);
      const assets = get().assets.map((asset) => selected.has(asset.id) ? { ...asset, folderId } : asset);
      await Promise.all(assets.filter((asset) => selected.has(asset.id)).map((asset) => saveAsset(asset)));
      set({ assets, selectedAssetIds: [] });
    },

    createProject: async (pack, theme) => {
      const s = get();
      if (!canUseDemoPack(pack)) {
        toast.error("هذا القالب متاح ضمن النسخة الكاملة", {
          description: "يمكنك استكشافه من صفحة القوالب وطلب النسخة المناسبة لجهتك.",
        });
        return false;
      }
      if (!canCreateDemoProject(s.projects.length)) {
        toast.error("اكتملت مساحة العرض التجريبي", {
          description: "يتضمن العرض مشروعاً واحداً. اطلب النسخة الكاملة لإنشاء مشاريع إضافية.",
        });
        return false;
      }
      const project = createProject(pack, theme || (pack === "eid" ? "eid" : "official"), s.orgName);
      const saved = await saveProject(project);
      applyProject(saved, { zoom: 0.82 });
      set({
        past: [JSON.stringify(projectSlice(get()))],
        future: [],
        saveState: "saved",
        savedAt: Date.now(),
      });
      await setSetting("activeProjectId", saved.id);
      await get().refreshProjects();
      return true;
    },

    openProject: async (id) => {
      const project = await getProject(id);
      if (!project) {
        toast.error("تعذر فتح المشروع");
        await get().refreshProjects();
        return;
      }
      applyProject(project, { zoom: get().zoom || 0.82 });
      set({ past: [JSON.stringify(projectSlice(get()))], future: [], saveState: "saved", savedAt: Date.now() });
      await setSetting("activeProjectId", project.id);
    },

    saveNow: async () => {
      const s = get();
      if (!s.pages?.length) return;
      set({ saveState: "saving" });
      try {
        const saved = await saveProject({
          ...projectSlice(s),
          version: s.version,
          updatedAt: Date.now(),
        });
        set({
          id: saved.id,
          createdAt: saved.createdAt,
          saveState: "saved",
          savedAt: Date.now(),
        });
        await setSetting("activeProjectId", saved.id);
        await get().refreshProjects();
      } catch (err) {
        console.error("[editor] autosave failed", err);
        set({ saveState: "error" });
      }
    },

    renameProject: async (id, name) => {
      const project = await getProject(id);
      if (!project) return;
      await saveProject({ ...project, name, id });
      if (get().id === id) set({ name });
      await get().refreshProjects();
    },

    duplicateProject: async (id) => {
      const copy = await copyProject(id);
      if (!copy) {
        toast.error("تعذر نسخ المشروع");
        return;
      }
      await get().refreshProjects();
      toast.success(`تم إنشاء «${copy.name}»`);
    },

    deleteProject: async (id) => {
      await removeProject(id);
      const s = get();
      if (s.id === id) {
        applyProject(createProject("blank", s.theme), { selectedId: null });
        await setSetting("activeProjectId", null);
      }
      await get().refreshProjects();
    },

    importProject: async (data) => {
      if (!data || !Array.isArray(data.pages) || !data.pages.length) {
        toast.error("ملف المشروع غير صالح — لا يحتوي على صفحات");
        return;
      }
      const incoming = normalizeProject({
        version: data.version || 2,
        name: data.name || "مشروع مستورد",
        theme: (data.theme as ThemeId) || "official",
        orgName: data.orgName || "",
        defaultSize: data.defaultSize,
        pages: data.pages,
        id: uid("proj"),
        createdAt: Date.now(),
      });
      const saved = await saveProject(incoming);
      applyProject(saved);
      set({ past: [JSON.stringify(projectSlice(get()))], future: [], saveState: "saved", savedAt: Date.now() });
      await setSetting("activeProjectId", saved.id);
      await get().refreshProjects();
      toast.success("تم استيراد المشروع");
    },

    setZoom: (z) => {
      const zoom = clamp(z, 0.2, 2);
      set({ zoom });
      void setSetting("zoom", zoom);
    },
    toggle: (key) => {
      const next = !get()[key];
      set({ [key]: next } as Partial<EditorStore>);
      // The `dark:` Tailwind variant keys off `html.dark` — without this sync
      // every dark: utility in the app is dead (restored: the line existed in
      // cf8c7e5's store and was dropped in a later refactor).
      if (key === "dark") {
        document.documentElement.classList.toggle("dark", next);
      }
      if (key === "dark" || key === "focusMode" || key === "leftOpen" || key === "rightOpen" || key === "leftCollapsed" || key === "rightCollapsed") {
        void setSetting(key, next);
      }
    },
    setLeftTab: (leftTab) => {
      set({ leftTab, leftOpen: true });
      // Probing is deferred to the moment the font list is actually needed.
      if (leftTab === "fonts") get().probeFonts();
    },
    setRightTab: (rightTab) => set({ rightTab, rightOpen: true }),
    setTheme: (theme) => {
      set({ theme });
      pushHistory();
    },
    setName: (name) => {
      set({ name });
      scheduleSave(500);
    },
    setOrg: (orgName) => {
      set({ orgName });
      scheduleSave(500);
    },
    setActivePage: (id) => {
      if (id === get().activePageId) return;
      set({ activePageId: id, selectedId: null, selectedIds: [], enteredGroupId: null });
    },
    select: (id) =>
      set((s) => ({
        selectedId: id,
        selectedIds: id ? [id] : [],
        enteredGroupId: id ? s.enteredGroupId : null,
        rightOpen: id ? true : s.rightOpen,
      })),

    setEditing: (id) => set({ editingId: id }),

    toggleSelect: (id) => {
      const s = get();
      const page = activePageOf(s);
      if (!page || !pickable(page, s.enteredGroupId, id)) return;
      const has = s.selectedIds.includes(id);
      const selectedIds = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
      // The primary selection is the last one added, which is the element whose
      // properties the panel should be showing.
      set({ selectedIds, selectedId: selectedIds.length ? selectedIds[selectedIds.length - 1] : null });
    },

    selectMany: (ids) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const keep = ids.filter((id) => pickable(page, s.enteredGroupId, id));
      set({ selectedIds: keep, selectedId: keep.length ? keep[keep.length - 1] : null });
    },

    selectAll: () =>
      get().selectMany(
        (activePageOf(get())?.elements ?? [])
          .filter((el) => !el.locked && !el.hidden)
          .map((el) => el.id),
      ),

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
      const next = { ...page, elements: page.elements.map((el) => (ids.has(el.id) ? { ...el, linkId } : el)) };
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
      toast.success("تم ربط العناصر — بقيت مستقلة ويمكن فك الربط لاحقًا");
    },

    unlinkSelected: () => {
      const s = get();
      const page = activePageOf(s);
      const ids = new Set(s.selectedIds);
      if (!s.selectedIds.length) return;
      const next = { ...page, elements: page.elements.map((el) => (ids.has(el.id) ? { ...el, linkId: undefined } : el)) };
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
      if (!page) return;
      const picked = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter((el): el is CanvasEl => Boolean(el) && !el!.locked);
      if (picked.length < 2) {
        toast.error("حدّد عنصرين أو أكثر للتجميع");
        return;
      }
      // Group only siblings: mixing depths would make the children's relative
      // coordinates ambiguous, so a nested pick is simply left out.
      const topLevel = picked.filter((el) => page.elements.some((e) => e.id === el.id));
      if (topLevel.length < 2) {
        toast.error("لا يمكن تجميع عناصر من مستويات مختلفة");
        return;
      }
      const group = createGroupFrom(topLevel);
      if (!group) return;
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
    },

    ungroup: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const targets = s.selectedIds
        .map((id) => locate(page, id)?.el)
        .filter((el): el is CanvasEl => Boolean(el) && el!.type === "group" && !el!.locked);
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
      toast.success(freed.length > 1 ? `تم فك تجميع ${freed.length} عناصر` : "تم فك التجميع");
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
          : absoluteBounds(page.elements, s.selectedIds) || { x: 0, y: 0, w: size.w, h: size.h };
      // One element aligns against the frame itself (the artboard for "page");
      // several elements align onto their shared box. Group members are
      // resolved through absolute page space inside `alignmentMoves`.
      applyPositions(alignmentMoves(page.elements, s.selectedIds, edge, target));
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

    renameElement: (id, name) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const next = mapElement(page, id, (el) => ({ ...el, name: name.trim() || el.name }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    setElementFlag: (id, flag, value) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const next = mapElement(page, id, (el) => ({ ...el, [flag]: value ?? !el[flag] }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    moveLayer: (id, dir) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const found = locate(page, id);
      if (!found) return;
      const index = found.index;
      const target = index + dir;
      if (target < 0 || target >= found.list.length) return;
      // Swap positions in the array the element actually lives in; group members
      // reorder inside their own `children` array so the tree shape is preserved.
      const swapIn = (list: CanvasEl[]): CanvasEl[] => {
        const arr = [...list];
        [arr[index], arr[target]] = [arr[target], arr[index]];
        return arr;
      };
      let next: Page;
      if (found.list === page.elements) {
        next = { ...page, elements: swapIn(page.elements) };
      } else {
        const applyIn = (list: CanvasEl[]): CanvasEl[] =>
          list === found.list
            ? swapIn(list)
            : list.map((el) => (el.children?.length ? { ...el, children: applyIn(el.children) } : el));
        next = { ...page, elements: applyIn(page.elements) };
      }
      // NOT `normalizeZ` here: it re-sorts by the old z values and would undo the
      // swap. Instead rewrite z from the new array order, which is the same rule
      // the canvas painter and every exporter follow, so the list, the canvas and
      // the exported file stay in one order.
      const renumber = (list: CanvasEl[]): CanvasEl[] =>
        list.map((el, i) => ({ ...el, z: i + 1, children: el.children?.length ? renumber(el.children) : el.children }));
      next.elements = renumber(next.elements);
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    addElement: (type, over) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return undefined;
      const theme = THEMES[s.theme];
      const size = pageSize(page);
      /*
       * Centered insert: the element lands in the middle of what the author is
       * looking at (the union of every visible artboard), not a fixed corner.
       * Defaults come from createElementDefaults; anything the caller passes in
       * `over` (e.g. a palette preset or a drawn size) wins over them, and the
       * theme layer is applied last exactly as before — layering keeps one
       * source of defaults without changing createElement's theming contract.
       */
      const defaults = createElementDefaults(type);
      const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
      const defaultSize = { w: defaults.w ?? 40, h: defaults.h ?? 30 };
      const visible = visiblePageRect(stage, page, s.zoom, s.previewAll);
      const pos = centerFor(
        visible,
        { w: size.w, h: size.h, elW: defaultSize.w, elH: defaultSize.h },
      );
      const el = createElement(
        type,
        {
          ...defaults,
          x: pos.x,
          y: pos.y,
          z: nextZ(page),
          ...over,
        },
        theme,
      );
      constrainElement(el, size);
      set({
        pages: s.pages.map((p) => (p.id === page.id ? { ...p, elements: [...p.elements, el] } : p)),
        selectedId: el.id,
        rightTab: "properties",
      });
      pushHistory();
      return el.id;
    },

    addTextAt: (box, pageId) => {
      const s = get();
      const page = pageId ? s.pages.find((p) => p.id === pageId) : activePageOf(s);
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
        pages: s.pages.map((p) => (p.id === page.id ? { ...p, elements: [...p.elements, el] } : p)),
        selectedId: el.id,
        selectedIds: [el.id],
        activePageId: page.id,
        rightTab: "properties",
      });
      pushHistory();
      return el.id;
    },

    updateElement: (id, patch, live) => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const size = pageSize(page);
      const next = mapElement(page, id, (el) => {
        const merged = { ...el, ...patch, style: { ...el.style, ...(patch.style || {}) } };
        if (patch.x != null && !live) merged.x = snap(Number(patch.x), s.snapGrid);
        if (patch.y != null && !live) merged.y = snap(Number(patch.y), s.snapGrid);
        constrainElement(merged, size);
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
      const topLevel = picked.filter((el) => page.elements.some((e) => e.id === el.id));
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
        pages: s.pages.map((p) => (p.id === page.id ? { ...p, elements: [...p.elements, ...copies] } : p)),
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
      set({ clipboard: clone(picked.length === 1 ? picked[0] : createGroupFrom(picked) || picked[0]) });
    },

    pasteClipboard: () => {
      const s = get();
      if (!s.clipboard) return;
      const page = activePageOf(s);
      if (!page) return;
      const el = clone(s.clipboard);
      el.id = uid(el.type === "group" ? "grp" : "el");
      // A group's children keep their relative positions, but each needs a fresh
      // id so the copies do not collide with the originals in the tree.
      if (el.children?.length) {
        const reid = (list: CanvasEl[]) => list.forEach((c) => { c.id = uid("el"); if (c.children?.length) reid(c.children); });
        reid(el.children);
      }
      el.x += 8;
      el.y += 8;
      el.z = nextZ(page);
      constrainElement(el, pageSize(page));
      set({
        pages: s.pages.map((p) => (p.id === page.id ? { ...p, elements: [...p.elements, el] } : p)),
        selectedId: el.id,
        selectedIds: [el.id],
      });
      pushHistory();
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
          .map((el) => (el.children?.length ? { ...el, children: strip(el.children) } : el));
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
      const isImageFamily = source.type === "image" || source.type === "logo" || source.type === "qr" || source.type === "svg";
      if (!isShape || !isImageFamily || sourceId === shapeId) return;
      /*
       * Frame the picture in the mask. Without this, a mask applied to two
       * elements that do not overlap produces an apparently empty shape — the
       * picture would sit entirely outside its own cut. When they already
       * overlap the author has placed it deliberately, so nothing is moved.
       */
      const ix = Math.max(0, Math.min(source.x + source.w, shape.x + shape.w) - Math.max(source.x, shape.x));
      const iy = Math.max(0, Math.min(source.y + source.h, shape.y + shape.h) - Math.max(source.y, shape.y));
      const covered = (ix * iy) / Math.max(1, shape.w * shape.h) > 0.6;
      let framed: Partial<{ x: number; y: number; w: number; h: number }> = {};
      if (!covered) {
        const scale = Math.max(shape.w / Math.max(1, source.w), shape.h / Math.max(1, source.h));
        const w = source.w * scale;
        const h = source.h * scale;
        framed = { x: shape.x + (shape.w - w) / 2, y: shape.y + (shape.h - h) / 2, w, h };
      }
      const next = mapElement(page, sourceId, (el) => ({ ...el, ...framed, clippedBy: shapeId }));
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
      const next = mapElements(page, ids, (el) => ({ ...el, clippedBy: undefined }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
      toast.success("تمت إزالة قناع القص");
    },

    reorderLayers: (fromId, toId) => {
      const s = get();
      const page = activePageOf(s);
      if (!page || fromId === toId) return;
      const ordered = [...page.elements].sort((a, b) => b.z - a.z);
      const from = ordered.findIndex((el) => el.id === fromId);
      const to = ordered.findIndex((el) => el.id === toId);
      if (from < 0 || to < 0) return;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      const zById = new Map(ordered.map((el, index) => [el.id, ordered.length - index]));
      const next = {
        ...page,
        elements: page.elements.map((el) => ({ ...el, z: zById.get(el.id) ?? el.z })),
      };
      set({ pages: s.pages.map((candidate) => (candidate.id === page.id ? next : candidate)) });
      pushHistory();
    },

    toggleLock: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      // A locked group cannot be toggled: unlocking it would be the only way out
      // of a state the author just chose.
      const next = mapElements(page, ids, (el) => ({ ...el, locked: !el.locked }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
    },

    toggleHidden: () => {
      const s = get();
      const page = activePageOf(s);
      if (!page) return;
      const ids = new Set(s.selectedIds);
      if (!ids.size) return;
      const next = mapElements(page, ids, (el) => ({ ...el, hidden: !el.hidden }));
      set({ pages: s.pages.map((p) => (p.id === page.id ? next : p)) });
      pushHistory();
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
        pages: s.pages.map((p) => (p.id === target.id ? { ...p, elements: [...p.elements, copy] } : p)),
        activePageId: target.id,
        selectedId: copy.id,
        selectedIds: [copy.id],
      });
      pushHistory();
      toast.success(`تم نقل العنصر إلى «${target.name}»`);
    },

    addPage: (sizeId) => {
      const s = get();
      if (!canAddDemoPage(s.pages.length)) {
        toast.error("وصلت إلى حد صفحات العرض التجريبي", {
          description: "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
        });
        return;
      }
      const preset = sizePreset(sizeId || s.defaultSize || "a4-portrait");
      const p: Page = {
        id: uid("page"),
        name: `صفحة ${s.pages.length + 1}`,
        elements: [],
        bg: THEMES[s.theme].paper,
        w: preset.w,
        h: preset.h,
      };
      set({ pages: [...s.pages, p], activePageId: p.id, selectedId: null, previewAll: true });
      pushHistory();
    },

    addTemplatePage: (id) => {
      const s = get();
      if (!canAddDemoPage(s.pages.length)) {
        toast.error("وصلت إلى حد صفحات العرض التجريبي", {
          description: "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
        });
        return;
      }
      const p = createTemplatePage(id, THEMES[s.theme], s.orgName);
      set({ pages: [...s.pages, p], activePageId: p.id, selectedId: null, previewAll: true });
      pushHistory();
    },

    duplicatePage: (id) => {
      const s = get();
      if (!canAddDemoPage(s.pages.length)) {
        toast.error("وصلت إلى حد صفحات العرض التجريبي", {
          description: "يتاح حتى 3 صفحات في العرض. افتح النسخة الكاملة لمشاريع أطول.",
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
      set({ pages, activePageId: copy.id, selectedId: null });
      pushHistory();
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
        targetId === s.activePageId ? pages[Math.max(0, idx - 1)].id : s.activePageId;
      set({ pages, activePageId: nextActive, selectedId: null });
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
      if (from === to || from < 0 || to < 0 || from >= s.pages.length || to >= s.pages.length) return;
      const pages = [...s.pages];
      const [item] = pages.splice(from, 1);
      pages.splice(to, 0, item);
      set({ pages });
      pushHistory();
    },

    renamePage: (id, name) => {
      set({ pages: get().pages.map((p) => (p.id === id ? { ...p, name } : p)) });
      scheduleSave(500);
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
          const next: Page = { ...p, w, h, elements: p.elements.map((e) => clone(e)) };
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
          const next: Page = { ...p, w, h, elements: p.elements.map((e) => clone(e)) };
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
      applyProject(JSON.parse(prev) as Project);
      set({ past: past.slice(0, -1), future: [current, ...future] });
      scheduleSave(300);
    },

    redo: () => {
      const { past, future } = get();
      if (!future.length) return;
      const [next, ...rest] = future;
      applyProject(JSON.parse(next) as Project);
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
}

function readUi(): PersistedUi {
  try {
    // Falls back to the pre-rebrand slot so dark mode, zoom and the active
    // project survive the rename instead of resetting to defaults.
    const raw = localStorage.getItem(UI_KEY) ?? localStorage.getItem(LEGACY_UI_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === "object" && parsed ? (parsed as PersistedUi) : {};
  } catch {
    return {};
  }
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
export function saveLabel(state: SaveState, savedAt: number | null, now: number): string {
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

export { UI_KEY };
export const A4_SIZE = A4;
