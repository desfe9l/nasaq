import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateDesignFromPrompt } from "@/lib/intelligence/pipeline.ts";
import { validateProject } from "@/lib/intelligence/layout.ts";
import { contrastRatio } from "@/lib/intelligence/analyze.ts";
import { buildDraftDocument } from "@/lib/editor/raw-document.ts";
import { pageSize, type CanvasEl, type Project } from "@/lib/editor/model.ts";
import { applyAIEditorOperations, type AIEditorCommandApi } from "./editor-bridge.ts";
import { normalizeCompositions } from "./design-composition.ts";
import { normalizeDraft } from "./contract.ts";

/**
 * THE JOIN this suite exists for: an AI result must become a document the real
 * editor model accepts — pages, sized text/shape/image elements, RTL Arabic
 * typography — and must reach the editor through the SAME command bridge the
 * editor itself uses (`applyAIEditorOperations` → `createDocument`).
 *
 * A test that only asserted "the provider returned JSON" would pass while the
 * product stayed broken: the failure mode is a project shape the editor cannot
 * open, not a missing model response.
 */

/** Minimal editor double that records what the bridge asked it to do. */
function recordingEditor() {
  const calls: { createDocument: Project[]; saved: number } = {
    createDocument: [],
    saved: 0,
  };
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
      calls.createDocument.push(project);
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
    saveNow: async () => {
      calls.saved += 1;
    },
  };
  return { api, calls };
}

function walk(elements: readonly CanvasEl[]): CanvasEl[] {
  return elements.flatMap((element) => [
    element,
    ...(element.children ? walk(element.children) : []),
  ]);
}

describe("AI design generation becomes a real editor document", () => {
  const generated = generateDesignFromPrompt("صمم تقريرًا رسميًا عن الأمن السيبراني", {
    pages: 3,
  });
  const project = generated.primaryResult.project;

  it("produces a project the editor's own validator accepts", () => {
    assert.deepEqual(validateProject(project), []);
  });

  it("creates pages with real printable dimensions", () => {
    assert.ok(project.pages.length >= 1);
    for (const page of project.pages) {
      const size = pageSize(page);
      assert.ok(size.w > 100 && size.h > 100, `page ${page.id} has no usable size`);
    }
  });

  it("fills the pages with real editable elements, not one flattened image", () => {
    const elements = project.pages.flatMap((page) => walk(page.elements));
    assert.ok(elements.length > 3, "a generated document must contain elements");
    const types = new Set(elements.map((element) => element.type));
    assert.ok(types.has("text"), "Arabic text elements must exist");
    assert.ok(
      [...types].some((type) => type === "shape" || type === "box" || type === "line"),
      "composition needs structural elements",
    );
    // Every element must carry a position and a size the canvas can edit.
    for (const element of elements) {
      assert.ok(Number.isFinite(element.x) && Number.isFinite(element.y));
      assert.ok(Number.isFinite(element.w) && Number.isFinite(element.h));
    }
  });

  it("carries Arabic-capable typography and RTL text", () => {
    const texts = project.pages
      .flatMap((page) => walk(page.elements))
      .filter((element) => element.type === "text" && element.content);
    assert.ok(texts.length > 0, "the generated document must contain text");
    const arabic = texts.filter((element) => /[\u0600-\u06FF]/.test(element.content ?? ""));
    assert.ok(arabic.length > 0, "generated copy must be Arabic");
    for (const element of arabic) {
      assert.ok(element.style?.fontFamily, "text carries a font family");
      assert.ok((element.style?.fontSize ?? 0) > 0, "text carries a font size");
      assert.notEqual(element.style?.direction, "ltr", "Arabic text must not render LTR");
      assert.notEqual(element.style?.textAlign, "left", "Arabic text must not sit on the left edge");
    }
  });

  it("reaches the editor through the document command (lifecycle owns persistence)", async () => {
    const { api, calls } = recordingEditor();
    const results = await applyAIEditorOperations(api, [
      { type: "generate_document", project: { ...project, name: "تقرير الأمن السيبراني" } },
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, true, JSON.stringify(results[0]));
    assert.equal(calls.createDocument.length, 1);
    assert.equal(calls.createDocument[0].pages.length, project.pages.length);
    // `createDocument` is the editor's own open-and-persist command, so the
    // bridge must NOT also run an edit transaction around it.
    assert.equal(calls.saved, 0);
  });

  it("edits an open document through the same bridge and persists once", async () => {
    const { api, calls } = recordingEditor();
    const target = project.pages
      .flatMap((page) => walk(page.elements))
      .find((element) => element.type === "text");
    assert.ok(target, "the generated document must contain a text element");
    (api as unknown as { pages: unknown }).pages = project.pages;

    const results = await applyAIEditorOperations(api, [
      { type: "update_text", elementId: target.id, content: "نص محدث بالذكاء الاصطناعي" },
    ]);
    assert.equal(results[0].ok, true, JSON.stringify(results[0]));
    assert.equal(results[0].createdIds, undefined);
    assert.equal(calls.saved, 1, "an AI edit must be persisted exactly once");
  });

  it("refuses a document the validator rejects instead of opening it", async () => {
    const { api, calls } = recordingEditor();
    const broken = {
      ...project,
      pages: project.pages.map((page) => ({
        ...page,
        elements: [{ ...walk(page.elements)[0], type: "not-a-real-element" as never }],
      })),
    };
    const results = await applyAIEditorOperations(api, [
      { type: "generate_document", project: broken },
    ]);
    assert.equal(results[0].ok, false);
    assert.equal(calls.createDocument.length, 0, "an invalid document must never open");
  });
});

describe("a defective provider plan is corrected before it becomes editable elements", () => {
  const plan = normalizeCompositions(
    [
      {
        elements: [
          // Four defects a real provider plan can carry: an unreadable role
          // pairing, a copy box that outgrows itself, a colliding pair, and an
          // opaque panel painted over a heading.
          {
            type: "text",
            x: 8,
            y: 88,
            w: 84,
            h: 8,
            content:
              "تسعى المبادرة التدريبية إلى بناء قدرات الكوادر المؤسسية عبر مسارات تدريبية متكاملة تجمع بين التدريب العملي والتقييم المستمر ومتابعة الأثر بعد التخرج في بيئة عمل حقيقية مدعومة بأدوات قياس دقيقة",
            role: "body",
            fill: "paper",
            color: "accent",
          },
          {
            type: "text",
            x: 10,
            y: 90,
            w: 60,
            h: 8,
            content: "نص متداخل مع الفقرة السابقة",
            role: "meta",
            fill: "none",
            color: "ink",
          },
          {
            type: "text",
            x: 8,
            y: 20,
            w: 84,
            h: 14,
            content: "قسم محجوب خلف شكل معتم",
            role: "display",
            fill: "none",
            color: "ink",
          },
          {
            type: "shape",
            x: 6,
            y: 18,
            w: 88,
            h: 18,
            content: "",
            role: "body",
            fill: "field",
            color: "ink",
          },
        ],
      },
    ],
    1,
  );
  const generated = generateDesignFromPrompt("صمم صفحة لمبادرة تدريبية", {
    pages: 1,
    compositions: plan,
  });
  const project = generated.primaryResult.project;

  it("reports every plan defect with its measurement before anything is built", () => {
    assert.ok(generated.compositionReview, "the plan review must travel with the result");
    const codes = generated.compositionReview.issues.map((issue) => issue.code);
    for (const code of ["coverage", "contrast", "overlap"]) {
      assert.ok(
        codes.includes(code as never),
        `missing ${code}: ${JSON.stringify(generated.compositionReview.issues)}`,
      );
    }
    for (const issue of generated.compositionReview.issues) {
      assert.equal(issue.corrected, true, `uncorrected: ${JSON.stringify(issue)}`);
    }
  });

  it("keeps the corrected document valid, editable, readable and RTL", () => {
    assert.deepEqual(validateProject(project), []);
    const elements = project.pages.flatMap((page) => walk(page.elements));
    assert.equal(elements.length, 4, "no plan element was dropped or invented");

    const headingIndex = elements.findIndex(
      (element) => element.content === "قسم محجوب خلف شكل معتم",
    );
    const panelIndex = elements.findIndex((element) => element.type === "shape");
    assert.ok(headingIndex >= 0 && panelIndex >= 0, "the plan was built as written");
    assert.ok(
      panelIndex < headingIndex,
      "the opaque panel now paints beneath the heading it covered",
    );

    const texts = elements.filter((element) => element.type === "text" && element.content);
    assert.ok(texts.length >= 3);
    for (const element of texts) {
      assert.equal(element.style?.direction, "rtl", `RTL lost on: ${element.content}`);
      assert.equal(element.style?.textAlign, "right", `align lost on: ${element.content}`);
      const fill = element.style?.fill;
      const color = element.style?.color;
      if (
        typeof fill === "string" &&
        fill.startsWith("#") &&
        typeof color === "string" &&
        color.startsWith("#")
      ) {
        assert.ok(
          contrastRatio(color, fill) >= 3,
          `${color} on ${fill} is unreadable for: ${element.content}`,
        );
      }
    }

    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        const a = texts[i];
        const b = texts[j];
        const sharedW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const sharedH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        const shared = sharedW > 0 && sharedH > 0 ? sharedW * sharedH : 0;
        assert.ok(
          shared / Math.min(a.w * a.h, b.w * b.h) < 0.3,
          `texts still collide: ${a.content} / ${b.content}`,
        );
      }
    }
  });
});

describe("AI report draft becomes editable sections", () => {
  const draft = normalizeDraft(
    {
      title: "تقرير الأداء المؤسسي",
      summary: "ملخص تنفيذي مختصر.",
      sections: [
        { heading: "المؤشرات", body: "نص القسم الأول.", bullets: ["نقطة أولى", "نقطة ثانية"] },
        { heading: "التوصيات", body: "نص القسم الثاني.", bullets: [] },
      ],
      nextSteps: ["اعتماد الخطة"],
    },
    4,
  );

  it("composes a real document in the editor model", () => {
    const document = buildDraftDocument({
      draft,
      theme: "official",
      orgName: "جهة اختبار",
      title: "تقرير الأداء المؤسسي",
    });
    assert.deepEqual(validateProject(document), []);
    const elements = document.pages.flatMap((page) => walk(page.elements));
    assert.ok(elements.length >= 2, "the draft block must be composed of elements");
    const text = elements.filter((element) => element.type === "text");
    assert.ok(text.length > 0, "sections are real text elements");
    const content = text.map((element) => element.content ?? "").join("\n");
    assert.match(content, /المؤشرات/);
    assert.match(content, /التوصيات/);
  });
});
