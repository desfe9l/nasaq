import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDesignBrief } from "./design-contract";
import {
  normalizeCompositions,
  compositionSignature,
} from "./design-composition";
import { generateDesignFromPrompt } from "@/lib/intelligence/pipeline";
import { validateProject } from "@/lib/intelligence/layout";
import { executeDesignTwin, planTwin } from "./design-twin";
import { designContextNotes } from "./design-context";
import { memoryRow } from "./design-memory";
import { createGenerationRequestGuard } from "./generation-request";

// Deliberately different spatial structures; these are unit fixtures, NOT real-provider evaluations.
const arrangements = [
  [
    [55, 8, 38, 18],
    [7, 38, 40, 45],
  ], // split
  [
    [8, 65, 84, 18],
    [8, 8, 84, 45],
  ], // bottom headline
  [
    [20, 38, 60, 18],
    [35, 68, 30, 20],
  ], // centered
  [
    [8, 8, 45, 20],
    [65, 8, 28, 80],
  ], // side rail
  [
    [8, 8, 84, 18],
    [8, 60, 84, 30],
  ], // stacked
];
const prompts = [
  "تقرير سنوي",
  "دعوة معرض",
  "بطاقة تهنئة",
  "موجز تنفيذي",
  "ملصق ورشة",
];
function compositions(index: number) {
  return normalizeCompositions(
    [
      {
        elements: arrangements[index].map(([x, y, w, h], i) => ({
          type: i ? "shape" : "text",
          content: i ? "" : "عنوان",
          role: "display",
          fill: "none",
          x,
          y,
          w,
          h,
        })),
      },
    ],
    1,
  );
}
function brief(index: number) {
  return normalizeDesignBrief(
    { pages: 1, compositions: compositions(index) },
    { prompt: prompts[index], mode: "professional" },
  );
}
function geometry(project: ReturnType<typeof executeDesignTwin>["project"]) {
  return JSON.stringify(
    project.pages.map((p) =>
      p.elements.map((e) => [e.type, e.x, e.y, e.w, e.h]),
    ),
  );
}

test("provider-authored positions survive normalization, canvas conversion and twin review for five briefs", () => {
  const outputs = prompts.map(
    (prompt, i) => executeDesignTwin({ prompt, geminiBrief: brief(i) }).project,
  );
  assert.equal(new Set(outputs.map(geometry)).size, 5);
  outputs.forEach((project, i) => {
    assert.deepEqual(validateProject(project), []);
    assert.equal(
      project.pages[0].elements.length,
      2,
      "no stock cover was substituted",
    );
    const title = project.pages[0].elements[0];
    assert.equal(title.x, (arrangements[i][0][0] * 210) / 100);
    assert.equal(title.style.direction, "rtl");
    assert.equal(title.type, "text");
  });
});

test("same brief with different reference-derived geometry is not collapsed by fixed builders", () => {
  const outputs = [0, 1].map(
    (i) =>
      generateDesignFromPrompt("نفس الموجز", {
        pages: 1,
        compositions: compositions(i),
      }).primaryResult.project,
  );
  assert.notEqual(geometry(outputs[0]), geometry(outputs[1]));
  assert.equal(
    compositionSignature(compositions(0)),
    compositionSignature(
      compositions(0).map((p) => ({
        elements: p.elements.map((e) => ({
          ...e,
          content: "نص مختلف",
          color: "accent" as const,
        })),
      })),
    ),
  );
});

test("malformed, missing, oversized and out-of-bounds geometry is rejected", () => {
  for (const value of [
    null,
    [],
    [{ elements: [] }],
    [{ elements: [{ type: "script", x: 0, y: 0, w: 10, h: 10 }] }],
  ]) {
    assert.throws(() => normalizeCompositions(value, 1), /invalid_composition/);
  }
  for (const n of [NaN, Infinity, -1, 101]) {
    const value = compositions(0);
    value[0].elements[0].x = n;
    assert.throws(() => normalizeCompositions(value, 1), /invalid_composition/);
  }
});

test("persistent recurring preferences survive new briefs without overriding an explicit model format", () => {
  const memory = [
    memoryRow(
      {
        kind: "preference",
        category: "",
        brief: "",
        reason: "مساحات بيضاء",
        recurring: true,
        ruleKey: "format",
        ruleValue: "a4-book",
      },
      "saved",
    ),
  ];
  const restored = JSON.parse(JSON.stringify(memory));
  for (const prompt of prompts) {
    const context = JSON.parse(
      designContextNotes(prompt, restored, [
        { scope: "global", analysis: { description: "صورة على اليسار" } },
        { scope: "task", analysis: { description: "PRIVATE TASK" } },
      ]),
    );
    assert.equal(context.preferences.rules.format, "a4-book");
    assert.match(context.preferences.notes, /مساحات بيضاء/);
    assert.equal(context.references.length, 1);
    assert.equal(
      planTwin({
        prompt,
        memory: restored,
        geminiBrief: { ...brief(0), format: "wide-slide" },
      }).format,
      "wide-slide",
    );
  }
});

test("late responses cannot overwrite a changed brief, newer request, or unmounted session", () => {
  const guard = createGenerationRequestGuard();
  guard.update("account-a:brief-a");
  const old = guard.begin();
  guard.update("account-a:brief-b");
  assert.equal(guard.current(old), false);
  const latest = guard.begin();
  assert.equal(guard.current(latest), true);
  guard.invalidate();
  assert.equal(guard.current(latest), false);
});

test("saved reference analyses and preferences reload through real owner-scoped SQL", async () => {
  const { createTestSql } = await import("@/lib/commercial/test-db");
  const { setTestSql } = await import("@/lib/license/test-db-stub");
  const { recordDesignMemory } = await import("./design-memory.server");
  const { loadDesignContext } = await import("./design-context.server");
  const { sql, close } = await createTestSql();
  setTestSql(sql);
  try {
    await recordDesignMemory("alice", {
      kind: "preference",
      reason: "white space",
      recurring: true,
      ruleKey: "density",
      ruleValue: "light",
    });
    for (const owner of ["alice", "bob"]) {
      await sql`insert into design_training_references (id, user_id, file_name, content_type, analysis, scope)
        values (${owner}, ${owner}, 'reference.png', 'image/png', ${JSON.stringify({ description: `${owner} left-column visual` })}::jsonb, 'global')`;
    }
    const first = await loadDesignContext("alice", "تقرير");
    const reloaded = await loadDesignContext("alice", "ملصق");
    assert.equal(reloaded.memory[0].ruleValue, "light");
    assert.equal(reloaded.memory[0].id, first.memory[0].id);
    assert.match(reloaded.memoryNotes, /alice left-column/);
    assert.doesNotMatch(reloaded.memoryNotes, /bob/);
    assert.equal((await loadDesignContext("bob", "ملصق")).memory.length, 0);
    await sql`delete from design_training_references where user_id = 'alice'`;
    assert.doesNotMatch(
      (await loadDesignContext("alice", "ملصق")).memoryNotes,
      /alice left-column/,
    );
  } finally {
    setTestSql(undefined);
    await close();
  }
});

test("model-authored tables remain editable table elements with safe dimensions", () => {
  const plan = compositions(0);
  plan[0].elements.push({
    type: "table",
    content: "المحور\tالحالة\nالتدريب\tمخطط",
    role: "body",
    fill: "paper",
    color: "ink",
    shape: "rect",
    x: 55,
    y: 50,
    w: 38,
    h: 30,
  });
  const normalized = normalizeCompositions(plan, 1);
  const output = generateDesignFromPrompt("جدول حالة", {
    pages: 1,
    compositions: normalized,
  }).primaryResult.project;
  const table = output.pages[0].elements.find((el) => el.type === "table");
  assert.equal(table?.style.cols, 2);
  assert.equal(table?.style.rows, 2);
  assert.match(table?.content ?? "", /التدريب/);
});
