/**
 * The homepage editor — document loading and interaction model.
 *
 * The hero on `/` runs a REAL NASAQ document: the same `Project` / `Page` /
 * `CanvasEl` model the studio loads, painted by the same renderer the template
 * catalog uses (`TemplatePreview`), transformed by the same geometry helpers
 * the canvas uses (`resizeByHandle`, `toLocalDelta`, `constrainElement`).
 *
 * What it deliberately is NOT:
 *
 *  · It is not the full editor in an iframe. Framing `/editor` could never
 *    work in production — the app sends `X-Frame-Options: DENY` on every
 *    response (server/middleware/00-security-headers.ts), so the browser
 *    refuses to render the frame and the hero paints an empty box. A frame
 *    also traps the page scroll (`body.is-editor` sets `overflow: hidden` and
 *    `overscroll-behavior: none`, which stops scroll chaining to the host
 *    document) and boots the entire studio bundle inside the homepage.
 *
 *  · It is not a mock. Nothing here invents a document format: the hero either
 *    shows the published catalog record the Admin selected (through the same
 *    public endpoint the template pages use) or the bundled «تقرير رسمي» pack
 *    built by `createProject`, so the visitor always edits a genuine NASAQ
 *    document.
 *
 * Everything in this module is pure (or a single awaited load), so the Node
 * test runner pins the behaviour without a DOM — see `home-editor.test.ts`.
 */

import {
  MIN_SIZE,
  constrainElement,
  pageSize,
  type CanvasEl,
  type Page,
} from "@/lib/editor/model";
import {
  resizeByHandle,
  toLocalDelta,
  type GestureBox,
} from "@/lib/editor/transform";

/** Where the hero document came from. */
export type HomeEditorSource = "catalog" | "bundled";

export interface HomeEditorDocument {
  source: HomeEditorSource;
  /** Catalog record id, or `pack:official` for the bundled document. */
  id: string;
  title: string;
  /** The pristine pages — the model clones them on load and on reset. */
  pages: Page[];
}

/** Snapshots are what Undo/Redo restores: pages plus the page being viewed. */
export interface HomeEditorSnapshot {
  pages: Page[];
  activeIndex: number;
}

export interface HomeEditorModel extends HomeEditorSnapshot {
  doc: HomeEditorDocument | null;
  selectedId: string | null;
  editingId: string | null;
  past: HomeEditorSnapshot[];
  future: HomeEditorSnapshot[];
  /** Live drag/resize: the snapshot to restore if the gesture is undone. */
  gesture: { id: string; base: HomeEditorSnapshot } | null;
  /** Bumped on every applied edit; lets the view key cheap memos. */
  revision: number;
}

export const HOME_EDITOR_HISTORY_LIMIT = 40;

export const HOME_EDITOR_INITIAL: HomeEditorModel = {
  doc: null,
  pages: [],
  activeIndex: 0,
  selectedId: null,
  editingId: null,
  past: [],
  future: [],
  gesture: null,
  revision: 0,
};

/** Element types whose `content` the hero lets the visitor retype. */
const TEXTUAL_TYPES = new Set(["text", "box", "stat", "stamp"]);

export function isTextualElement(el: CanvasEl | null | undefined): boolean {
  return !!el && TEXTUAL_TYPES.has(el.type);
}

function newId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `he_${Math.random().toString(36).slice(2, 11)}`;
}

function clonePage(page: Page): Page {
  const copy =
    typeof structuredClone === "function"
      ? structuredClone(page)
      : (JSON.parse(JSON.stringify(page)) as Page);
  const size = pageSize(copy);
  const walk = (list: CanvasEl[] | undefined): CanvasEl[] =>
    (list ?? []).map((el) => {
      const next: CanvasEl = { ...el, id: el.id || newId() };
      constrainElement(next, size);
      if (next.children?.length) next.children = walk(next.children);
      return next;
    });
  copy.elements = walk(copy.elements);
  return copy;
}

/** Defensive copy of a document's pages — the pristine set is never mutated. */
export function clonePages(pages: Page[]): Page[] {
  return (pages ?? []).filter(Boolean).map(clonePage);
}

/**
 * The bundled hero document: the official report pack, exactly as «قوالب
 * البداية» creates it. Used when no catalog record is featured, and as the
 * fallback when the featured record cannot be served — the hero never
 * degrades to an empty box.
 */
export async function bundledHomeEditorDocument(): Promise<HomeEditorDocument> {
  const { createProject } = await import("@/lib/editor/templates");
  const project = createProject("official");
  return {
    source: "bundled",
    id: "pack:official",
    title: project.name,
    pages: project.pages,
  };
}

const documentCache = new Map<string, Promise<HomeEditorDocument>>();

/** Drops the memoised documents — used by tests and by an Admin content change. */
export function clearHomeEditorDocumentCache(): void {
  documentCache.clear();
}

/**
 * Resolve the hero document ONCE per catalog id.
 *
 * The promise is memoised so a re-mount (or React's double-invoked effect in
 * development) never boots the document twice, and so switching pages back to
 * `/` is instant.
 */
export function loadHomeEditorDocument(
  templateId?: string | null,
): Promise<HomeEditorDocument> {
  const id = String(templateId ?? "").trim();
  const key = id || "pack:official";
  const cached = documentCache.get(key);
  if (cached) return cached;
  const pending = resolveHomeEditorDocument(id).catch(async (error) => {
    // A failed catalog read must not poison the cache or the hero.
    documentCache.delete(key);
    console.warn("[home-editor] falling back to the bundled document", error);
    return bundledHomeEditorDocument();
  });
  documentCache.set(key, pending);
  return pending;
}

async function resolveHomeEditorDocument(
  id: string,
): Promise<HomeEditorDocument> {
  if (!id) return bundledHomeEditorDocument();
  const [{ getPublishedTemplateFn }, { publishedTemplateSeed }] =
    await Promise.all([
      import("@/lib/admin/functions"),
      import("@/lib/templates/published"),
    ]);
  const result = await getPublishedTemplateFn({ data: { id } });
  // Only a free, published record is public enough for an open preview.
  if (!result.ok || result.template.tier !== "free") {
    return bundledHomeEditorDocument();
  }
  const seed = publishedTemplateSeed(result.template);
  const pages = (seed.pages ?? []).filter(
    (page) => page && Array.isArray(page.elements),
  );
  if (!pages.length) return bundledHomeEditorDocument();
  return {
    source: "catalog",
    id: result.template.id,
    title: seed.name || result.template.title,
    pages,
  };
}

// ── Geometry ───────────────────────────────────────────────────────────────

export interface PaperBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Fit a page inside the hero viewport, centred, keeping its exact proportions.
 *
 * Returned in CSS pixels so the surface can position the paper without a
 * layout round-trip: an A4 sheet fits by height, a slide by width, and a
 * viewport that has not been measured yet yields a zero box (nothing paints).
 */
export function fitPaperBox(
  viewport: { width: number; height: number },
  page: { w?: number; h?: number } | null | undefined,
  padding = 14,
): PaperBox {
  const size = pageSize(page ?? undefined);
  const availableW = Math.max(0, (Number(viewport.width) || 0) - padding * 2);
  const availableH = Math.max(0, (Number(viewport.height) || 0) - padding * 2);
  if (availableW <= 0 || availableH <= 0)
    return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(availableW / size.w, availableH / size.h);
  const width = Math.max(1, Math.round(size.w * scale));
  const height = Math.max(1, Math.round(size.h * scale));
  return {
    left: Math.round(((Number(viewport.width) || 0) - width) / 2),
    top: Math.round(((Number(viewport.height) || 0) - height) / 2),
    width,
    height,
  };
}

/** Screen pixels → page millimetres for the paper currently on screen. */
export function pixelsToMm(
  paper: { width: number; height: number },
  page: { w?: number; h?: number } | null | undefined,
  dxPx: number,
  dyPx: number,
): { dx: number; dy: number } {
  const size = pageSize(page ?? undefined);
  const width = Number(paper.width) || 0;
  const height = Number(paper.height) || 0;
  if (width <= 0 || height <= 0) return { dx: 0, dy: 0 };
  return {
    dx: (dxPx / width) * size.w,
    dy: (dyPx / height) * size.h,
  };
}

/**
 * The resize the canvas performs, reduced to the hero's needs: the pointer
 * delta is projected onto the element's own axes before the shared
 * `resizeByHandle` runs, so a rotated element resizes from the grabbed corner
 * exactly as it does inside the studio.
 */
export function resizedBox(
  orig: GestureBox,
  handle: string,
  dx: number,
  dy: number,
  rotation = 0,
  preserveRatio = false,
): GestureBox {
  const local = toLocalDelta(dx, dy, rotation);
  const next: GestureBox = { ...orig };
  resizeByHandle(next, orig, handle, local.dx, local.dy, preserveRatio);
  return next;
}

/** Keep a box on (or at least touching) the sheet, and never below MIN_SIZE. */
export function clampBoxToPage(box: GestureBox, page: Page): GestureBox {
  const size = pageSize(page);
  const w = Math.max(MIN_SIZE, box.w);
  const h = Math.max(MIN_SIZE, box.h);
  // A margin of one element-size keeps a dragged element reachable: it can
  // leave the sheet, but never so far that it cannot be dragged back.
  const minX = -w + MIN_SIZE;
  const minY = -h + MIN_SIZE;
  return {
    w,
    h,
    x: Math.min(Math.max(box.x, minX), size.w - MIN_SIZE),
    y: Math.min(Math.max(box.y, minY), size.h - MIN_SIZE),
  };
}

// ── Element lookup ─────────────────────────────────────────────────────────

/** Visible top-level elements of a page, painted back-to-front. */
export function stackedElements(page: Page | null | undefined): CanvasEl[] {
  return [...(page?.elements ?? [])]
    .filter((el) => el && !el.hidden)
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
}

export function findHomeElement(
  page: Page | null | undefined,
  id: string | null | undefined,
): CanvasEl | null {
  if (!page || !id) return null;
  return page.elements.find((el) => el.id === id) ?? null;
}

export function activePageOf(model: HomeEditorModel): Page | null {
  if (!model.pages.length) return null;
  const index = Math.min(
    Math.max(model.activeIndex, 0),
    model.pages.length - 1,
  );
  return model.pages[index] ?? null;
}

export function selectedElementOf(model: HomeEditorModel): CanvasEl | null {
  return findHomeElement(activePageOf(model), model.selectedId);
}

// ── Reducer ────────────────────────────────────────────────────────────────

export type HomeEditorAction =
  | { type: "load"; doc: HomeEditorDocument }
  | { type: "reset" }
  | { type: "select"; id: string | null }
  | { type: "editText"; id: string | null }
  | { type: "gestureStart"; id: string }
  | { type: "gestureBox"; id: string; box: GestureBox }
  | { type: "gestureEnd" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "setContent"; id: string; content: string }
  | { type: "duplicate" }
  | { type: "delete" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "goToPage"; index: number };

function snapshot(model: HomeEditorModel): HomeEditorSnapshot {
  return { pages: model.pages, activeIndex: model.activeIndex };
}

function remember(
  model: HomeEditorModel,
  base: HomeEditorSnapshot,
): Pick<HomeEditorModel, "past" | "future"> {
  return {
    past: [...model.past, base].slice(-HOME_EDITOR_HISTORY_LIMIT),
    future: [],
  };
}

/** Replace one element on the active page; pages elsewhere keep their identity. */
function withElement(
  model: HomeEditorModel,
  id: string,
  fn: (el: CanvasEl, page: Page) => CanvasEl,
): Page[] | null {
  const page = activePageOf(model);
  if (!page) return null;
  const index = page.elements.findIndex((el) => el.id === id);
  if (index < 0) return null;
  const nextEl = fn(page.elements[index], page);
  constrainElement(nextEl, pageSize(page));
  const elements = page.elements.slice();
  elements[index] = nextEl;
  const nextPage: Page = { ...page, elements };
  return model.pages.map((p) => (p.id === page.id ? nextPage : p));
}

export function homeEditorReducer(
  model: HomeEditorModel,
  action: HomeEditorAction,
): HomeEditorModel {
  switch (action.type) {
    case "load":
    case "reset": {
      const doc = action.type === "load" ? action.doc : model.doc;
      if (!doc) return model;
      return {
        ...HOME_EDITOR_INITIAL,
        doc,
        pages: clonePages(doc.pages),
        activeIndex: 0,
        revision: model.revision + 1,
      };
    }

    case "select": {
      if (model.selectedId === action.id && !model.editingId) return model;
      return { ...model, selectedId: action.id, editingId: null };
    }

    case "editText": {
      const el = findHomeElement(activePageOf(model), action.id);
      if (action.id && !isTextualElement(el)) return model;
      return {
        ...model,
        editingId: action.id,
        selectedId: action.id ?? model.selectedId,
      };
    }

    case "gestureStart": {
      const el = findHomeElement(activePageOf(model), action.id);
      if (!el || el.locked) return model;
      return {
        ...model,
        selectedId: action.id,
        editingId: null,
        gesture: { id: action.id, base: snapshot(model) },
      };
    }

    case "gestureBox": {
      if (!model.gesture || model.gesture.id !== action.id) return model;
      const page = activePageOf(model);
      if (!page) return model;
      const box = clampBoxToPage(action.box, page);
      const pages = withElement(model, action.id, (el) => ({ ...el, ...box }));
      if (!pages) return model;
      return { ...model, pages, revision: model.revision + 1 };
    }

    case "gestureEnd": {
      const gesture = model.gesture;
      if (!gesture) return model;
      const unchanged = gesture.base.pages === model.pages;
      return {
        ...model,
        gesture: null,
        ...(unchanged ? {} : remember(model, gesture.base)),
      };
    }

    case "nudge": {
      const id = model.selectedId;
      const page = activePageOf(model);
      if (!id || !page) return model;
      const el = findHomeElement(page, id);
      if (!el || el.locked) return model;
      const box = clampBoxToPage(
        { x: el.x + action.dx, y: el.y + action.dy, w: el.w, h: el.h },
        page,
      );
      const pages = withElement(model, id, (current) => ({
        ...current,
        ...box,
      }));
      if (!pages) return model;
      return {
        ...model,
        pages,
        revision: model.revision + 1,
        ...remember(model, snapshot(model)),
      };
    }

    case "setContent": {
      const el = findHomeElement(activePageOf(model), action.id);
      if (!el || el.locked) return { ...model, editingId: null };
      const content = String(action.content ?? "");
      if ((el.content ?? "") === content) return { ...model, editingId: null };
      const base = snapshot(model);
      const pages = withElement(model, action.id, (current) => ({
        ...current,
        content,
      }));
      if (!pages) return { ...model, editingId: null };
      return {
        ...model,
        pages,
        editingId: null,
        revision: model.revision + 1,
        ...remember(model, base),
      };
    }

    case "duplicate": {
      const page = activePageOf(model);
      const el = findHomeElement(page, model.selectedId);
      if (!page || !el) return model;
      const base = snapshot(model);
      const offset = 4;
      const copy: CanvasEl = {
        ...(typeof structuredClone === "function"
          ? structuredClone(el)
          : (JSON.parse(JSON.stringify(el)) as CanvasEl)),
        id: newId(),
        x: el.x + offset,
        y: el.y + offset,
        z:
          (page.elements.reduce((max, item) => Math.max(max, item.z ?? 0), 0) ||
            0) + 1,
      };
      constrainElement(copy, pageSize(page));
      const nextPage: Page = { ...page, elements: [...page.elements, copy] };
      return {
        ...model,
        pages: model.pages.map((p) => (p.id === page.id ? nextPage : p)),
        selectedId: copy.id,
        editingId: null,
        revision: model.revision + 1,
        ...remember(model, base),
      };
    }

    case "delete": {
      const page = activePageOf(model);
      const el = findHomeElement(page, model.selectedId);
      if (!page || !el || el.locked) return model;
      const base = snapshot(model);
      const nextPage: Page = {
        ...page,
        elements: page.elements.filter((item) => item.id !== el.id),
      };
      return {
        ...model,
        pages: model.pages.map((p) => (p.id === page.id ? nextPage : p)),
        selectedId: null,
        editingId: null,
        revision: model.revision + 1,
        ...remember(model, base),
      };
    }

    case "undo": {
      if (!model.past.length) return model;
      const previous = model.past[model.past.length - 1];
      return {
        ...model,
        pages: previous.pages,
        activeIndex: Math.min(
          Math.max(previous.activeIndex, 0),
          Math.max(previous.pages.length - 1, 0),
        ),
        past: model.past.slice(0, -1),
        future: [snapshot(model), ...model.future].slice(
          0,
          HOME_EDITOR_HISTORY_LIMIT,
        ),
        editingId: null,
        selectedId: null,
        gesture: null,
        revision: model.revision + 1,
      };
    }

    case "redo": {
      if (!model.future.length) return model;
      const [next, ...rest] = model.future;
      return {
        ...model,
        pages: next.pages,
        activeIndex: Math.min(
          Math.max(next.activeIndex, 0),
          Math.max(next.pages.length - 1, 0),
        ),
        past: [...model.past, snapshot(model)].slice(
          -HOME_EDITOR_HISTORY_LIMIT,
        ),
        future: rest,
        editingId: null,
        selectedId: null,
        gesture: null,
        revision: model.revision + 1,
      };
    }

    case "goToPage": {
      if (!model.pages.length) return model;
      const index = Math.min(
        Math.max(Math.trunc(action.index), 0),
        model.pages.length - 1,
      );
      if (index === model.activeIndex) return model;
      return {
        ...model,
        activeIndex: index,
        selectedId: null,
        editingId: null,
        gesture: null,
      };
    }

    default:
      return model;
  }
}

export const canUndo = (model: HomeEditorModel) => model.past.length > 0;
export const canRedo = (model: HomeEditorModel) => model.future.length > 0;
