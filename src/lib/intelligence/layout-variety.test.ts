import assert from "node:assert/strict";
import test from "node:test";
import { createElement, THEMES, type CanvasEl, type Page, type Project } from "@/lib/editor/model";
import {
  checkLayoutVariety,
  contentBlocks,
  enforceLayoutVariety,
  normalizePageLayoutDirectives,
  pageFingerprint,
  planPageLayouts,
  stampLayoutMeta,
} from "./layout-variety";
import {
  paletteFollows60_30_10,
  presetForDesignStyle,
  stylePresetFor,
  stylePresets,
} from "./style-presets";
import { generateVariations } from "./variations";
import { generateDesignFromPrompt } from "./pipeline";
import { parsePrompt } from "./prompt-analyzer";
import { validateProject } from "./layout";
import { normalizeDesignBrief, normalizeDesignBriefInput } from "@/lib/ai/design-contract";
import { applyAIEditorOperations, type AIEditorCommandApi } from "@/lib/ai/editor-bridge";

// ── Helpers ────────────────────────────────────────────────────────────────

function textBlock(name: string, content: string, x: number, y: number, w: number, h: number, size: number): CanvasEl {
  return createElement(
    "text",
    {
      name,
      content,
      x,
      y,
      w,
      h,
      style: { fontSize: size, fontWeight: 700, textAlign: "right", direction: "rtl", color: "#172033" },
    },
    THEMES.official,
  );
}

/** Two content blocks, full width — the classic stacked page. */
function stackedPage(id: string): Page {
  return {
    id,
    name: id,
    w: 210,
    h: 297,
    bg: "#ffffff",
    elements: [
      textBlock("عنوان", "عنوان القسم", 16, 24, 178, 12, 16),
      textBlock("متن", "نص المستند", 16, 44, 178, 30, 10),
    ],
  };
}

function fakeApi(overrides: Partial<AIEditorCommandApi> = {}): AIEditorCommandApi {
  const page = stackedPage("p1");
  return {
    pages: [page],
    activePageId: page.id,
    selectedIds: [],
    saveState: "saved",
    beginAITransaction: () => {},
    commitAITransaction: () => {},
    finalizeAITransaction: () => {},
    rollbackAITransaction: () => {},
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
    ...overrides,
  };
}

const textsOf = (project: Project): string[] =>
  project.pages.flatMap((page) => page.elements.map((el) => el.content ?? ""));

// ── Layout planner ─────────────────────────────────────────────────────────

test("planner: page 1 is a hero cover and no two consecutive pages share a pattern", () => {
  const plan4 = planPageLayouts({ pages: 4 });
  assert.deepEqual(
    plan4.map((d) => d.pattern),
    ["hero-cover", "executive-summary", "stat-cards", "table-matrix"],
  );

  const plan8 = planPageLayouts({ pages: 8 });
  assert.equal(plan8.length, 8);
  assert.equal(plan8[0].pattern, "hero-cover");
  assert.equal(plan8[7].pattern, "closing-endorsement");
  for (let i = 1; i < plan8.length; i += 1) {
    assert.notEqual(plan8[i].pattern, plan8[i - 1].pattern, `pages ${i + 1} and ${i + 2} repeat a pattern`);
  }
  // The old bug: every interior page after the fourth was the same summary.
  assert.notEqual(plan8[5].pattern, plan8[6].pattern);
});

test("planner honors provider directives but never a consecutive repeat", () => {
  const plan = planPageLayouts({
    pages: 5,
    directives: [
      { page: 2, pattern: "asymmetric-editorial" },
      { page: 3, pattern: "asymmetric-editorial" }, // would repeat -> rotated
      { page: 99, pattern: "stat-cards" }, // out of range -> dropped
      { page: 4, pattern: "not-a-pattern" }, // invalid -> dropped
    ],
  });
  assert.equal(plan.length, 5);
  assert.equal(plan[1].pattern, "asymmetric-editorial");
  assert.notEqual(plan[2].pattern, "asymmetric-editorial");
});

test("planner clamps page counts and always returns one directive per page", () => {
  assert.equal(planPageLayouts({ pages: 0 }).length, 1);
  assert.equal(planPageLayouts({ pages: 99 }).length, 12);
  for (const total of [1, 2, 3, 5, 6, 7, 12]) {
    const plan = planPageLayouts({ pages: total });
    assert.equal(plan.length, total);
    assert.equal(plan[0].pattern, "hero-cover");
  }
});

test("directive normalization whitelists patterns and clamps fields", () => {
  const clean = normalizePageLayoutDirectives(
    [
      { page: 1, pattern: "hero-cover" },
      { page: 1, pattern: "stat-cards" }, // duplicate page -> dropped
      "garbage",
      { page: 2, pattern: "bogus" }, // unknown pattern -> dropped
      { page: 2, pattern: "stat-cards", accentCards: 99, columns: 9 },
      { page: 30, pattern: "stat-cards" }, // beyond the document -> dropped
    ],
    4,
  );
  assert.equal(clean.length, 2);
  assert.equal(clean[0].pattern, "hero-cover");
  assert.equal(clean[1].accentCards, 3);
  assert.equal(clean[1].columns, 2);
  assert.deepEqual(normalizePageLayoutDirectives(null, 4), []);
  assert.deepEqual(normalizePageLayoutDirectives({ nope: true }, 4), []);
});

// ── Variety validator & automatic secondary pattern ────────────────────────

test("variety check catches two consecutive pages with the same structure", () => {
  const twin: Project = {
    version: 2,
    name: "مكرر",
    theme: "official",
    orgName: "",
    pages: [stackedPage("p1"), stackedPage("p2")],
  };
  const report = checkLayoutVariety(twin);
  assert.equal(report.ok, false);
  assert.equal(report.pairs.length, 1);
  assert.equal(report.pairs[0].identical, true);
  assert.equal(pageFingerprint(twin.pages[0]), pageFingerprint(twin.pages[1]));
});

test("enforcement applies a secondary layout automatically and keeps every text", () => {
  const twin: Project = {
    version: 2,
    name: "مكرر",
    theme: "official",
    orgName: "",
    pages: [stackedPage("p1"), stackedPage("p2")],
  };
  const result = enforceLayoutVariety(twin);
  assert.ok(result.applied.length > 0, "a secondary pattern must be applied");
  assert.equal(result.report.ok, true);
  assert.notEqual(pageFingerprint(result.project.pages[0]), pageFingerprint(result.project.pages[1]));
  // Content is redistributed, never rewritten.
  assert.deepEqual(textsOf(result.project).sort(), textsOf(twin).sort());
  // The document is still a valid, fully editable NASAQ project.
  assert.deepEqual(validateProject(result.project), []);
});

test("enforcement is idempotent on a document that already varies", () => {
  const project: Project = {
    version: 2,
    name: "emen",
    theme: "official",
    orgName: "",
    pages: [
      { ...stackedPage("p1"), elements: [textBlock("عنوان", "عنوان", 16, 24, 178, 12, 16), textBlock("متن", "نص", 16, 44, 90, 30, 10), textBlock("sidebar", "جانبي", 112, 44, 82, 30, 10)] },
      stackedPage("p2"),
    ],
  };
  const result = enforceLayoutVariety(project);
  assert.equal(result.applied.length, 0);
  assert.equal(result.report.ok, true);
});

// ── Style Presets Engine ───────────────────────────────────────────────────

test("four architectural presets carry typography, spacing, radius, shadow and 60-30-10 rules", () => {
  const presets = stylePresets();
  assert.deepEqual(
    presets.map((p) => p.id),
    ["sovereign", "executive", "editorial", "digital"],
  );
  for (const preset of presets) {
    assert.ok(preset.typographyScale.display > preset.typographyScale.h1);
    assert.ok(preset.typographyScale.h1 > preset.typographyScale.h2);
    assert.ok(preset.typographyScale.h2 > preset.typographyScale.body);
    assert.ok(preset.spacing.marginMm >= 10);
    assert.ok(preset.spacing.gutterMm >= 3);
    assert.ok(preset.spacing.whitespaceRatio > 0 && preset.spacing.whitespaceRatio < 1);
    assert.ok(preset.borderRadius.card >= 0 && preset.borderRadius.image >= 0);
    assert.equal(preset.shadowElevation.card !== undefined, true);
    assert.equal(preset.paletteRules.rule, "60-30-10");
    assert.equal(
      preset.paletteRules.ratios.dominant + preset.paletteRules.ratios.secondary + preset.paletteRules.ratios.accent,
      100,
    );
    assert.equal(paletteFollows60_30_10(preset.palette), true, `${preset.id} breaks 60-30-10`);
    assert.ok(preset.layoutBias.length >= 4);
  }
  assert.equal(stylePresetFor("bogus"), null);
  assert.equal(presetForDesignStyle("institutional").id, "sovereign");
  assert.equal(presetForDesignStyle("government").id, "sovereign");
  assert.equal(presetForDesignStyle("executive").id, "executive");
  assert.equal(presetForDesignStyle("editorial").id, "editorial");
  assert.equal(presetForDesignStyle("corporate").id, "digital");
  assert.equal(presetForDesignStyle("presentation").id, "digital");
});

// ── Generator integration ──────────────────────────────────────────────────

test("generated 8-page document passes the variety check and stamps per-element layout options", () => {
  const generated = generateDesignFromPrompt("صمم تقريرًا رسميًا عن الأمن السيبراني", { pages: 8 });
  const project = generated.primaryResult.project;
  assert.equal(project.pages.length, 8);
  assert.equal(generated.layoutVariety.ok, true);
  assert.equal(generated.layoutVariety.pairs.length, 0);

  for (let i = 1; i < project.pages.length; i += 1) {
    assert.notEqual(
      pageFingerprint(project.pages[i - 1]),
      pageFingerprint(project.pages[i]),
      `pages ${i + 1} and ${i + 2} are structurally identical`,
    );
  }

  // Every content element carries its independent distribution options.
  const blocks = project.pages.flatMap((page) => contentBlocks(page));
  assert.ok(blocks.length > 10);
  for (const el of blocks) {
    assert.ok(el.layout, `«${el.name}» has no layout metadata`);
    assert.ok(el.layout?.role);
    assert.ok(el.layout?.positioning?.anchor);
    assert.ok([1, 2, 3].includes(el.layout?.positioning?.columnSpan ?? 0));
  }
  assert.ok(blocks.some((el) => el.layout?.role === "accent-card" || el.layout?.role === "stat-card"));
  assert.ok(blocks.some((el) => el.layout?.role === "summary-callout"));

  assert.deepEqual(validateProject(project), []);
});

test("the four variations carry their presets and each passes the variety check", () => {
  const variations = generateVariations(parsePrompt("صمم تقريرًا رسميًا عن الأمن السيبراني"));
  assert.deepEqual(
    variations.map((v) => v.id),
    ["sovereign", "executive", "editorial", "digital"],
  );
  for (const variation of variations) {
    assert.equal(variation.preset.id, variation.id);
    assert.equal(variation.layoutVariety.ok, true);
    assert.deepEqual(validateProject(variation.project), []);
  }
  // The styles are visually distinct palettes, not one palette four times.
  const fields = new Set(variations.map((v) => v.palette.field));
  assert.ok(fields.size >= 3);
});

// ── JSON contract (design brief) ───────────────────────────────────────────

test("design brief contract emits one sanitized layout directive per page", () => {
  const brief = normalizeDesignBrief(
    {
      title: "تقرير",
      style: "institutional",
      format: "a4-book",
      pages: 5,
      pageLayouts: [
        { page: 1, pattern: "hero-cover" },
        { page: 2, pattern: "asymmetric-editorial" },
        { page: 2, pattern: "stat-cards" }, // duplicate page -> dropped
        { page: 9, pattern: "stat-cards" }, // out of range -> dropped
        { page: 3, pattern: "bogus" }, // invalid -> dropped
      ],
    },
    normalizeDesignBriefInput({ prompt: "تقرير رسمي" }),
  );
  assert.equal(brief.pageLayouts.length, 5);
  assert.equal(brief.pageLayouts[0].pattern, "hero-cover");
  assert.equal(brief.pageLayouts[1].pattern, "asymmetric-editorial");
  for (let i = 1; i < brief.pageLayouts.length; i += 1) {
    assert.notEqual(brief.pageLayouts[i].pattern, brief.pageLayouts[i - 1].pattern);
  }
  for (const directive of brief.pageLayouts) {
    assert.ok([1, 2, 3].includes(directive.columns));
    assert.ok(directive.visualHierarchy.length > 0);
    assert.ok(directive.accentCards >= 0 && directive.accentCards <= 3);
    assert.ok(["tight", "balanced", "airy"].includes(directive.whitespace));
    assert.ok(["hero", "asymmetric", "grid", "stacked"].includes(directive.positioning));
  }
});

// ── Editor boundary (Canvas & Editor Compatibility) ────────────────────────

test("generate_document auto-applies a secondary pattern when pages repeat, then opens", async () => {
  const monotonous: Project = {
    version: 2,
    name: "مكرر",
    theme: "official",
    orgName: "",
    pages: [stackedPage("pa"), stackedPage("pb")],
  };
  let opened: Project | null = null;
  const api = fakeApi({
    createDocument: async (project: Project) => {
      opened = project;
      return true;
    },
  });
  const results = await applyAIEditorOperations(api, [{ type: "generate_document", project: monotonous }]);
  assert.equal(results[0]?.ok, true);
  assert.ok(opened, "the document must be opened");
  const fixed = opened as unknown as Project;
  // The monotony is gone: the two pages no longer share a structure.
  assert.notEqual(pageFingerprint(fixed.pages[0]), pageFingerprint(fixed.pages[1]));
  assert.equal(checkLayoutVariety(fixed).ok, true);
  // Every block is still an ordinary, fully editable element with its text.
  assert.deepEqual(textsOf(fixed).sort(), textsOf(monotonous).sort());
  assert.deepEqual(validateProject(fixed), []);
});

test("stampLayoutMeta classifies roles, hierarchy and grid anchors", () => {
  const page = stackedPage("p1");
  page.elements.push(
    createElement("table", { name: "جدول", content: "a\tb", x: 16, y: 90, w: 178, h: 40, style: {} }, THEMES.official),
    createElement("shape", { name: "بطاقة التوصية", x: 16, y: 140, w: 80, h: 20, style: { fill: "#ffffff" } }, THEMES.official),
    createElement("shape", { name: "خيط زخرفي", x: 16, y: 170, w: 40, h: 1, opacity: 0.1, style: { fill: "#c6a05a" } }, THEMES.official),
  );
  stampLayoutMeta(page, "stat-cards");
  const byName = new Map(page.elements.map((el) => [el.name, el]));
  assert.equal(byName.get("عنوان")?.layout?.role, "heading");
  assert.equal(byName.get("عنوان")?.layout?.hierarchy, 2);
  assert.equal(byName.get("متن")?.layout?.role, "body");
  assert.equal(byName.get("جدول")?.layout?.role, "table");
  assert.equal(byName.get("بطاقة التوصية")?.layout?.role, "accent-card");
  assert.equal(byName.get("خيط زخرفي")?.layout?.role, "ornament");
  for (const el of page.elements) {
    assert.equal(el.layout?.pattern, "stat-cards");
  }
});
