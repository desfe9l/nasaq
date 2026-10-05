import assert from "node:assert/strict";
import test from "node:test";
import { generateDesignFromPrompt } from "./pipeline";
import { parsePrompt } from "./prompt-analyzer";

const base = parsePrompt("صمم تقريرًا سنويًا احترافيًا من 5 صفحات عن الأمن السيبراني");

test("generation modes produce distinct editable art direction", () => {
  const creative = generateDesignFromPrompt(base.rawPrompt, {
    ...base,
    generationMode: "generate",
    coverStyle: "wave",
  });
  const balanced = generateDesignFromPrompt(base.rawPrompt, {
    ...base,
    generationMode: "balance",
    coverStyle: "geometric",
  });
  const professional = generateDesignFromPrompt(base.rawPrompt, {
    ...base,
    generationMode: "professional",
    coverStyle: "premium",
  });

  const projects = [creative.primaryResult.project, balanced.primaryResult.project, professional.primaryResult.project];
  assert.deepEqual(projects.map((project) => project.pages.length), [5, 5, 5]);
  assert.equal(new Set(projects.map((project) => JSON.stringify(project.pages[0].elements))).size, 3);

  for (const project of projects) {
    const elements = project.pages.flatMap((page) => page.elements);
    assert.ok(project.pages.every((page) => page.bgGradient), "every page has an editable page-owned gradient");
    assert.ok(elements.some((element) => element.type === "text" && element.style.direction === "rtl"));
    assert.ok(elements.some((element) => element.type === "image" && element.style.frameId));
    assert.ok(elements.some((element) => element.type === "shape" && element.style.gradient));
    assert.ok(elements.some((element) => element.type === "shape" && element.style.shapeId === "wave"));
    assert.ok(elements.some((element) => element.type === "shape" && element.style.shapeId === "curve-side"));
    assert.ok(elements.some((element) => element.type === "table"));
  }
});

test("cover directions change the editable composition without flattening", () => {
  const directions = ["minimal", "editorial", "gradient", "image-led", "legal", "media", "annual-report"] as const;
  const outputs = directions.map((coverStyle) =>
    generateDesignFromPrompt(base.rawPrompt, { ...base, pages: 2, coverStyle }).primaryResult.project,
  );
  assert.equal(new Set(outputs.map((project) => JSON.stringify(project.pages[0].elements))).size, directions.length);
  assert.ok(outputs.some((project) => project.pages[0].elements.some((element) => element.style.shapeId === "diagonal")));
  assert.ok(outputs.some((project) => project.pages[0].elements.some((element) => element.style.shapeId === "wave")));
  assert.ok(outputs.some((project) => project.pages[0].elements.some((element) => element.style.frameId === "arch-frame")));
});
