import type { ReportDraft } from "./contract";
import type { CanvasEl, ElType, Page, ProjectSnapshot, ThemeId } from "@/lib/editor/model";

export type AIEditorErrorCode =
  | "invalid_operation"
  | "unsupported_operation"
  | "target_not_found"
  | "command_failed"
  | "persistence_failed";

export type AIEditorOperation =
  | { operationId?: string; type: "create_element"; pageId?: string; elementType: ElType; props?: Partial<CanvasEl> }
  | { operationId?: string; type: "update_element"; elementId: string; patch: Partial<CanvasEl> }
  | { operationId?: string; type: "update_text"; elementId: string; content: string }
  | { operationId?: string; type: "update_style"; elementId: string; style: CanvasEl["style"] }
  | { operationId?: string; type: "move_element"; elementId: string; x: number; y: number }
  | { operationId?: string; type: "resize_element"; elementId: string; w: number; h: number }
  | { operationId?: string; type: "replace_element"; elementId: string; elementType: ElType; props?: Partial<CanvasEl> }
  | { operationId?: string; type: "delete_element"; elementIds: string[] }
  | { operationId?: string; type: "duplicate_element"; elementIds: string[] }
  | { operationId?: string; type: "group_elements"; elementIds: string[] }
  | { operationId?: string; type: "ungroup_elements"; elementIds: string[] }
  | { operationId?: string; type: "reorder_element"; elementId: string; targetId: string; side?: "before" | "after" }
  | { operationId?: string; type: "set_background"; pageId: string; paint: Pick<Page, "bg" | "bgGradient" | "bgImage" | "bgImageFit" | "bgImageX" | "bgImageY"> }
  | { operationId?: string; type: "create_page" }
  | { operationId?: string; type: "duplicate_page"; pageId?: string }
  | { operationId?: string; type: "delete_page"; pageId?: string }
  | { operationId?: string; type: "update_page"; pageId: string; name: string }
  | { operationId?: string; type: "insert_report_draft"; draft: ReportDraft; existingId?: string };

export type AIEditorOperationResult =
  | { ok: true; operationId: string; createdIds?: string[] }
  | { ok: false; operationId: string; code: AIEditorErrorCode; message: string; failedOperation: AIEditorOperation; details?: string[] };

export interface AIEditorCommandApi {
  pages: Page[];
  activePageId: string;
  selectedIds: string[];
  updateElement: (id: string, patch: Partial<CanvasEl>) => void;
  updateStyle: (id: string, patch: CanvasEl["style"]) => void;
  replaceElement: (element: CanvasEl) => void;
  addElementAt: (type: ElType, over?: Partial<CanvasEl>, center?: { x: number; y: number }, pageId?: string) => CanvasEl | undefined;
  selectMany: (ids: string[]) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  group: () => string | null;
  ungroup: () => void;
  reorderLayers: (fromId: string, toId: string, side?: "before" | "after") => void;
  setPageBackground: (id: string, paint: AIEditorOperationExtract<"set_background">["paint"]) => void;
  addPage: () => void;
  duplicatePage: (id?: string) => void;
  deletePage: (id?: string) => void;
  renamePage: (id: string, name: string) => void;
  insertReportDraft: (draft: ReportDraft, existingId?: string) => string | undefined;
  saveNow: () => Promise<void>;
  undo: () => void;
};

type AIEditorOperationExtract<T extends AIEditorOperation["type"]> = Extract<AIEditorOperation, { type: T }>;

const SUPPORTED_AI_OPERATIONS: readonly AIEditorOperation["type"][] = [
  "create_element", "update_element", "update_text", "update_style", "move_element", "resize_element",
  "replace_element", "delete_element", "duplicate_element", "group_elements", "ungroup_elements",
  "reorder_element", "set_background", "create_page", "duplicate_page", "delete_page", "update_page",
  "insert_report_draft",
];

export function getEditorAICapabilities(): readonly AIEditorOperation["type"][] {
  return SUPPORTED_AI_OPERATIONS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function operationId(operation: AIEditorOperation, index: number): string {
  return operation.operationId?.trim() || `ai-op-${index + 1}`;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isElType(value: unknown): value is ElType {
  return typeof value === "string" && ["text", "box", "table", "shape", "line", "divider", "image", "logo", "icon", "stamp", "qr", "stat", "progress", "svg", "group"].includes(value);
}

function validOperation(value: unknown): value is AIEditorOperation {
  if (!isRecord(value) || typeof value.type !== "string" || !SUPPORTED_AI_OPERATIONS.some((candidate) => candidate === value.type)) return false;
  const type = value.type;
  if (["update_element", "update_text", "update_style", "move_element", "resize_element", "replace_element"].includes(type) && typeof value.elementId !== "string") return false;
  if (["delete_element", "duplicate_element", "group_elements", "ungroup_elements"].includes(type) && (!Array.isArray(value.elementIds) || value.elementIds.some((id) => typeof id !== "string"))) return false;
  if (type === "move_element" && (!finite(value.x) || !finite(value.y))) return false;
  if (type === "resize_element" && (!finite(value.w) || !finite(value.h) || value.w <= 0 || value.h <= 0)) return false;
  if (["create_element", "replace_element"].includes(type) && !isElType(value.elementType)) return false;
  if (type === "update_text" && typeof value.content !== "string") return false;
  if (type === "update_style" && !isRecord(value.style)) return false;
  if (type === "reorder_element" && (typeof value.elementId !== "string" || typeof value.targetId !== "string")) return false;
  if (type === "set_background" && (typeof value.pageId !== "string" || !isRecord(value.paint))) return false;
  if (type === "update_page" && (typeof value.pageId !== "string" || typeof value.name !== "string")) return false;
  if (type === "insert_report_draft" && !isRecord(value.draft)) return false;
  return true;
}

function findElement(pages: readonly Page[], id: string): CanvasEl | undefined {
  const walk = (elements: readonly CanvasEl[]): CanvasEl | undefined => {
    for (const element of elements) {
      if (element.id === id) return element;
      const nested = element.children?.length ? walk(element.children) : undefined;
      if (nested) return nested;
    }
    return undefined;
  };
  for (const page of pages) {
    const hit = walk(page.elements);
    if (hit) return hit;
  }
  return undefined;
}

function pageHasElement(pages: readonly Page[], id: string): boolean {
  return Boolean(findElement(pages, id));
}

export function buildAIEditorContext(project: Pick<ProjectSnapshot, "name" | "theme" | "pages"> & { activePageId: string; selectedIds: string[] }): {
  document: { title: string; theme: ThemeId; pageCount: number; direction: "rtl" };
  currentPage: { id: string; name: string; width: number; height: number; background?: string } | null;
  selection: Array<Pick<CanvasEl, "id" | "type" | "name" | "x" | "y" | "w" | "h" | "z" | "content" | "style" | "children">>;
  availableOperations: readonly AIEditorOperation["type"][];
} {
  const page = project.pages.find((item) => item.id === project.activePageId) ?? project.pages[0];
  const selection = project.selectedIds.map((id) => findElement(project.pages, id)).filter((item): item is CanvasEl => Boolean(item)).map((item) => ({
    id: item.id, type: item.type, name: item.name, x: item.x, y: item.y, w: item.w, h: item.h, z: item.z,
    content: item.content, style: item.style, children: item.children,
  }));
  return {
    document: { title: project.name, theme: project.theme, pageCount: project.pages.length, direction: "rtl" },
    currentPage: page ? { id: page.id, name: page.name, width: page.w ?? 210, height: page.h ?? 297, background: page.bg } : null,
    selection,
    availableOperations: getEditorAICapabilities(),
  };
}

function resultFailure(operation: AIEditorOperation, index: number, code: AIEditorErrorCode, message: string, details?: string[]): AIEditorOperationResult {
  return { ok: false, operationId: operationId(operation, index), code, message, failedOperation: operation, details };
}

export async function applyAIEditorOperations(api: AIEditorCommandApi, operations: readonly unknown[]): Promise<AIEditorOperationResult[]> {
  const checked: AIEditorOperation[] = [];
  const failures: AIEditorOperationResult[] = [];
  operations.forEach((value, index) => {
    if (!validOperation(value)) {
      const operation: AIEditorOperation = { type: "update_text", elementId: "unknown", content: "" };
      failures.push(resultFailure(operation, index, "invalid_operation", "AI returned an invalid or unsupported editor operation."));
      return;
    }
    checked.push(value);
  });
  if (failures.length) return failures;

  const before = api.pages;
  for (let index = 0; index < checked.length; index += 1) {
    const operation = checked[index];
    const targetIds = "elementId" in operation ? [operation.elementId] : "elementIds" in operation ? operation.elementIds : [];
    if (targetIds.some((id) => !pageHasElement(before, id))) {
      return [resultFailure(operation, index, "target_not_found", "The requested editor target no longer exists.")];
    }
  }

  const applied: AIEditorOperation[] = [];
  const results: AIEditorOperationResult[] = [];
  try {
    for (let index = 0; index < checked.length; index += 1) {
      const operation = checked[index];
      let createdIds: string[] | undefined;
      switch (operation.type) {
        case "create_element": {
          const created = api.addElementAt(operation.elementType, operation.props, undefined, operation.pageId);
          if (!created) throw new Error("create_element_failed");
          createdIds = [created.id];
          break;
        }
        case "update_element": api.updateElement(operation.elementId, operation.patch); break;
        case "update_text": api.updateElement(operation.elementId, { content: operation.content }); break;
        case "update_style": api.updateStyle(operation.elementId, operation.style); break;
        case "move_element": api.updateElement(operation.elementId, { x: operation.x, y: operation.y }); break;
        case "resize_element": api.updateElement(operation.elementId, { w: operation.w, h: operation.h }); break;
        case "replace_element": {
          const existing = findElement(api.pages, operation.elementId);
          if (!existing) throw new Error("replace_element_target_missing");
          const replacement: CanvasEl = {
            ...existing,
            ...operation.props,
            id: operation.elementId,
            type: operation.elementType,
            style: { ...existing.style, ...(operation.props?.style ?? {}) },
          };
          api.replaceElement(replacement);
          break;
        }
        case "delete_element": api.selectMany(operation.elementIds); api.deleteSelected(); break;
        case "duplicate_element": api.selectMany(operation.elementIds); api.duplicateSelected(); break;
        case "group_elements": api.selectMany(operation.elementIds); api.group(); break;
        case "ungroup_elements": api.selectMany(operation.elementIds); api.ungroup(); break;
        case "reorder_element": api.reorderLayers(operation.elementId, operation.targetId, operation.side); break;
        case "set_background": api.setPageBackground(operation.pageId, operation.paint); break;
        case "create_page": api.addPage(); break;
        case "duplicate_page": api.duplicatePage(operation.pageId); break;
        case "delete_page": api.deletePage(operation.pageId); break;
        case "update_page": api.renamePage(operation.pageId, operation.name); break;
        case "insert_report_draft": {
          const id = api.insertReportDraft(operation.draft, operation.existingId);
          if (!id) throw new Error("insert_report_draft_failed");
          createdIds = [id];
          break;
        }
      }
      applied.push(operation);
      results.push({
        ok: true,
        operationId: operationId(operation, index),
        ...(createdIds ? { createdIds } : {}),
      });
    }
    await api.saveNow();
    return results;
  } catch (error) {
    for (let index = 0; index < applied.length; index += 1) api.undo();
    const operation = checked[applied.length] ?? checked[checked.length - 1];
    return [resultFailure(operation, applied.length, "command_failed", error instanceof Error ? error.message : "Editor command failed; changes were rolled back.")];
  }
}

export function aiOperationErrorMessage(result: AIEditorOperationResult): string {
  return result.ok ? "" : `${result.message} (${result.code}, ${result.operationId})`;
}

export function isAIEditorOperation(value: unknown): value is AIEditorOperation {
  return validOperation(value);
}

export function isAIEditorCommandApi(value: unknown): value is AIEditorCommandApi {
  return isRecord(value) && typeof value.saveNow === "function" && typeof value.updateElement === "function";
}
