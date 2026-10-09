import assert from "node:assert/strict";
import test from "node:test";
import { imposeNasaqPalette } from "./design-constitution.ts";
import { applyAIEditorOperations, type AIEditorCommandApi } from "./editor-bridge.ts";
import { executeDesignTwin, planTwin, runDesignTwinBenchmarks } from "./design-twin.ts";
import type { Project } from "@/lib/editor/model.ts";

function recordingEditor() {
  const calls: Project[] = [];
  const api: AIEditorCommandApi = {
    pages: [],
    activePageId: "",
    selectedIds: [],
    saveState: "saved",
    beginAITransaction: () => {},
    commitAITransaction: () => {},
    finalizeAITransaction: () => {},
    rollbackAITransaction: () => {},
    createDocument: async (project) => {
      calls.push(project);
      return true;
    },
    updateElement: () => {},
    updateStyle: () => {},
    replaceElement: () => {},
    addElementAt: () => undefined,
    selectMany: () => {},
    deleteSelected: () => {},
    duplicateSelected: () => {},
    group: () => null,
    ungroup: () => {},
    reorderLayers: () => {},
    setPageBackground: () => {},
    addPage: () => {},
    duplicatePage: () => {},
    deletePage: () => {},
    renamePage: () => {},
    insertReportDraft: () => undefined,
    saveNow: async () => {},
  };
  return { api, calls };
}

test("NASAQ palette is not imposed on a named customer brief", () => {
  assert.equal(imposeNasaqPalette("هوية نَسَق NASAQ"), true);
  assert.equal(imposeNasaqPalette("تقرير لجهة العميل"), false);
  assert.equal(imposeNasaqPalette("هوية نَسَق لهوية العميل"), false);
  const customer = planTwin({ prompt: "ملف شركة العميل مع شعار العميل", pages: 1 });
  const nasaq = planTwin({ prompt: "لوحة داخلية لنَسَق NASAQ", pages: 1 });
  assert.equal(customer.imposeNasaqPalette, false);
  assert.equal(nasaq.imposeNasaqPalette, true);
});

test("design twin benchmark — measured, not a target score", () => {
  const report = runDesignTwinBenchmarks();
  console.log(`TWIN_BENCH ${JSON.stringify(report)}`);
  assert.equal(report.briefs, 10);
  assert.equal(report.rows.length, 10);
  for (const row of report.rows) {
    assert.equal(row.source, "constitution");
    assert.ok(row.pages >= 1, row.id);
    assert.ok(row.elements >= 1, row.id);
    assert.equal(row.valid, true, row.id);
    assert.equal(row.rtlDefects, 0, row.id);
    assert.equal(row.outOfBounds, 0, row.id);
    assert.equal(row.roundTripOk, true, row.id);
    assert.ok(row.rounds <= 2, row.id);
  }
  assert.equal(report.valid, 10);
  assert.equal(report.rtlClean, 10);
  assert.equal(report.inBounds, 10);
  assert.equal(report.roundTripOk, 10);
  assert.equal(report.rows.find((row) => row.id === "nasaq")?.nasaqPalette, true);
  assert.equal(report.rows.find((row) => row.id === "corporate")?.nasaqPalette, false);
});

test("a twin delivery opens through the editor document command", async () => {
  const delivery = executeDesignTwin({
    prompt: "تقرير عربي من صفحة واحدة عن جاهزية التشغيل",
    pages: 1,
    maxPages: 1,
  });
  const { api, calls } = recordingEditor();
  const results = await applyAIEditorOperations(api, [{
    type: "generate_document",
    project: delivery.project,
  }]);
  assert.equal(results[0]?.ok, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].pages[0].elements.length > 0);
});
