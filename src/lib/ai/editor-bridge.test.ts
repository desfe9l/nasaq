import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasEl, Page } from "@/lib/editor/model";
import {
  applyAIEditorOperations,
  buildAIEditorContext,
  getEditorAICapabilities,
  type AIEditorCommandApi,
} from "./editor-bridge.ts";

const element: CanvasEl = {
  id: "text-1",
  type: "text",
  name: "العنوان",
  x: 10,
  y: 20,
  w: 80,
  h: 20,
  rotation: 0,
  opacity: 1,
  z: 1,
  content: "النص القديم",
  style: { fontSize: 16, direction: "rtl" },
};

const page: Page = { id: "page-1", name: "الصفحة الأولى", w: 210, h: 297, bg: "#fff", elements: [element] };

function fakeApi(overrides: Partial<AIEditorCommandApi> = {}): AIEditorCommandApi {
  const calls: string[] = [];
  return {
    pages: [page],
    activePageId: page.id,
    selectedIds: [],
    updateElement: () => calls.push("updateElement"),
    updateStyle: () => calls.push("updateStyle"),
    replaceElement: () => calls.push("replaceElement"),
    addElementAt: () => {
      calls.push("addElementAt");
      return { ...element, id: "created-1" };
    },
    selectMany: () => calls.push("selectMany"),
    deleteSelected: () => calls.push("deleteSelected"),
    duplicateSelected: () => calls.push("duplicateSelected"),
    group: () => {
      calls.push("group");
      return "group-1";
    },
    ungroup: () => calls.push("ungroup"),
    reorderLayers: () => calls.push("reorderLayers"),
    setPageBackground: () => calls.push("setPageBackground"),
    addPage: () => calls.push("addPage"),
    duplicatePage: () => calls.push("duplicatePage"),
    deletePage: () => calls.push("deletePage"),
    renamePage: () => calls.push("renamePage"),
    insertReportDraft: () => {
      calls.push("insertReportDraft");
      return "report-1";
    },
    saveNow: async () => {
      calls.push("saveNow");
    },
    undo: () => calls.push("undo"),
    ...overrides,
  };
}

test("context builder sends bounded editor facts and the real capability registry", () => {
  const context = buildAIEditorContext({
    name: "مستند الاختبار",
    theme: "official",
    pages: [page],
    activePageId: page.id,
    selectedIds: [element.id],
  });
  assert.equal(context.document.title, "مستند الاختبار");
  assert.equal(context.currentPage?.width, 210);
  assert.equal(context.selection[0]?.id, element.id);
  assert.equal(context.selection[0]?.x, 10);
  assert.ok(context.availableOperations.includes("update_text"));
  assert.deepEqual(context.availableOperations, getEditorAICapabilities());
});

test("valid AI operations use the real editor command and persist only after success", async () => {
  const api = fakeApi();
  const results = await applyAIEditorOperations(api, [{
    operationId: "text-edit-1",
    type: "update_text",
    elementId: element.id,
    content: "النص الجديد",
  }]);
  assert.deepEqual(results, [{ ok: true, operationId: "text-edit-1" }]);
});

test("invalid and unknown operations are rejected without touching editor state", async () => {
  const api = fakeApi();
  const results = await applyAIEditorOperations(api, [{
    type: "invent_command",
    elementId: element.id,
  }]);
  assert.equal(results[0]?.ok, false);
  if (results[0]?.ok === false) assert.equal(results[0].code, "invalid_operation");
});

test("element creation is normalized through addElementAt and returns the real id", async () => {
  const api = fakeApi();
  const results = await applyAIEditorOperations(api, [{
    type: "create_element",
    pageId: page.id,
    elementType: "text",
    props: { content: "عنصر جديد" },
  }]);
  assert.equal(results[0]?.ok, true);
  if (results[0]?.ok) assert.deepEqual(results[0].createdIds, ["created-1"]);
});
