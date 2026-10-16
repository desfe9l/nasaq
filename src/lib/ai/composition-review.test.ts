import assert from "node:assert/strict";
import test from "node:test";
import { contrastRatio } from "@/lib/intelligence/analyze";
import type { PaletteRoles } from "@/lib/intelligence/schema";
import {
  COMPOSITION_ISSUE_LABELS,
  COMPOSITION_TEXT_SCALE,
  reviewCompositions,
} from "./composition-review";
import type {
  DesignComposition,
  DesignCompositionElement,
} from "./design-composition";

/** The institutional palette the product ships — not a mock. */
const PALETTE: PaletteRoles = {
  field: "#0c3d2c",
  paper: "#f7f6f3",
  ink: "#172033",
  accent: "#c6a05a",
  muted: "#5c6570",
  onField: "#f7f6f3",
};
const SIZE = { w: 210, h: 297 };

function el(
  over: Partial<DesignCompositionElement>,
): DesignCompositionElement {
  return {
    type: "text",
    x: 8,
    y: 8,
    w: 40,
    h: 10,
    content: "نص",
    role: "body",
    fill: "none",
    color: "ink",
    shape: "rect",
    ...over,
  };
}

function plan(elements: DesignCompositionElement[]): DesignComposition[] {
  return [{ elements }];
}

/**
 * The documented height model, restated here on purpose: if the module's
 * estimate changes, this test must be updated with it instead of silently
 * agreeing with whatever the module now does.
 */
function estimateHeightPercent(
  element: DesignCompositionElement,
  size: { w: number; h: number },
): number {
  const scale = COMPOSITION_TEXT_SCALE[element.role];
  const charWidthMm = scale.fontSize * 0.5 * (25.4 / 72);
  const charsPerLine = Math.max(
    1,
    Math.floor((element.w / 100) * size.w / charWidthMm),
  );
  const lines = element.content.split("\n").reduce((total, row) => {
    if (element.type === "table") {
      const cells = row.split("\t");
      return (
        total +
        Math.max(
          1,
          ...cells.map((cell) => Math.ceil(cell.trim().length / charsPerLine)),
        )
      );
    }
    return total + Math.max(1, Math.ceil(row.length / charsPerLine));
  }, 0);
  return (lines * scale.fontSize * scale.lineHeight * (25.4 / 72) / size.h) * 100;
}

const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test("unreadable role pairings are repaired with a readable role on the same fill", () => {
  const input = plan([
    el({ fill: "paper", color: "accent", content: "عنوان بلون غير مقروء" }),
    el({ role: "display", x: 60, fill: "field", color: "onField", content: "عنوان مقروء" }),
  ]);
  const before = snapshot(input);
  const review = reviewCompositions(input, PALETTE, SIZE);

  assert.deepEqual(snapshot(input), before, "the input plan is never mutated");
  const [repaired, kept] = review.compositions[0].elements;
  assert.ok(
    contrastRatio(PALETTE.accent, PALETTE.paper) < 4.5,
    "the fixture pairing must actually fail",
  );
  assert.equal(repaired.color, "ink", "the readable role on paper is ink");
  assert.ok(contrastRatio(PALETTE[repaired.color], PALETTE.paper) >= 4.5);
  assert.equal(repaired.content, "عنوان بلون غير مقروء", "copy is not rewritten");
  assert.equal(kept.color, "onField", "a passing pairing is left alone");
  assert.deepEqual(
    review.issues.map((issue) => [issue.code, issue.corrected]),
    [["contrast", true]],
  );
});

test("a palette with no readable role is reported, not guessed around", () => {
  const flat: PaletteRoles = {
    field: "#808080",
    paper: "#808080",
    ink: "#808080",
    accent: "#808080",
    muted: "#808080",
    onField: "#808080",
  };
  const review = reviewCompositions(
    plan([el({ fill: "paper", color: "accent", content: "نص" })]),
    flat,
    SIZE,
  );
  assert.equal(review.compositions[0].elements[0].color, "accent");
  assert.deepEqual(
    review.issues.map((issue) => [issue.code, issue.corrected]),
    [["contrast", false]],
  );
});

test("an opaque shape painted over text is moved beneath it, while a card stays put", () => {
  const review = reviewCompositions(
    plan([
      el({ role: "display", x: 10, y: 10, w: 40, h: 12, content: "قسم محجوب" }),
      el({ type: "shape", x: 8, y: 8, w: 44, h: 16, fill: "field", content: "" }),
    ]),
    PALETTE,
    SIZE,
  );
  const elements = review.compositions[0].elements;
  assert.equal(elements[0].type, "shape", "the shape paints first (bottom)");
  assert.equal(elements[1].content, "قسم محجوب");
  assert.deepEqual(
    review.issues.map((issue) => [issue.code, issue.corrected]),
    [["coverage", true]],
  );

  // A panel listed before the text is a card, not a cover-up: untouched.
  const clean = reviewCompositions(
    plan([
      el({ type: "shape", x: 6, y: 18, w: 88, h: 18, fill: "field", content: "" }),
      el({ x: 10, y: 20, w: 40, h: 12, content: "بطاقة" }),
    ]),
    PALETTE,
    SIZE,
  );
  assert.equal(clean.issues.length, 0);
  assert.deepEqual(
    clean.compositions[0].elements.map((element) => element.type),
    ["shape", "text"],
  );
});

test("text that grows past the page bottom is raised, and an impossible fit is reported", () => {
  const long = "ا".repeat(500);
  const review = reviewCompositions(
    plan([el({ y: 90, w: 40, content: long })]),
    PALETTE,
    SIZE,
  );
  const moved = review.compositions[0].elements[0];
  const needed = estimateHeightPercent(moved, SIZE);
  assert.ok(needed > moved.h, "the copy must actually outgrow the box");
  assert.deepEqual(
    review.issues.map((issue) => [issue.code, issue.corrected]),
    [["overflow", true]],
  );
  assert.ok(
    moved.y + needed <= 100.01,
    `moved copy must fit the page (y=${moved.y}, needed=${needed}%)`,
  );
  assert.ok(moved.y < 90, "the box moved up");
  assert.equal(moved.h, 10, "the declared box size is untouched");
  assert.equal(moved.content, long, "copy is not rewritten");

  const impossible = reviewCompositions(
    plan([el({ y: 90, w: 40, content: "ا".repeat(4000) })]),
    PALETTE,
    SIZE,
  );
  assert.deepEqual(
    impossible.issues.map((issue) => [issue.code, issue.corrected]),
    [["overflow", false]],
  );
  assert.equal(impossible.compositions[0].elements[0].y, 90);
});

test("colliding texts are separated with the smallest verified move", () => {
  const review = reviewCompositions(
    plan([
      el({ x: 8, y: 10, w: 40, h: 12, role: "body", content: "نص أول" }),
      el({ x: 8, y: 18, w: 40, h: 12, role: "meta", content: "نص ثان" }),
    ]),
    PALETTE,
    SIZE,
  );
  const [first, second] = review.compositions[0].elements;
  assert.deepEqual(
    review.issues.map((issue) => [issue.element, issue.code, issue.corrected]),
    [[1, "overlap", true]],
  );
  assert.equal(first.y, 10, "the higher-priority text does not move");
  assert.equal(second.x, 8, "the horizontal position is kept when the gap fits below");
  assert.equal(second.y, 23.5, "the yielding text sits below with the 1.5% gap");
  assert.equal(second.content, "نص ثان", "copy is not rewritten");
  assert.equal(second.h, 12, "the declared box size is untouched");
  assert.equal(second.role, "meta", "the role is untouched");
});

test("a collision with no in-bounds separation is reported, not forced", () => {
  const review = reviewCompositions(
    plan([
      el({
        x: 20,
        y: 5,
        w: 60,
        h: 90,
        role: "body",
        content: "بطاقة أولى",
      }),
      el({
        x: 22,
        y: 7,
        w: 60,
        h: 90,
        role: "meta",
        content: "بطاقة ثانية",
      }),
    ]),
    PALETTE,
    SIZE,
  );
  assert.deepEqual(
    review.issues.map((issue) => [issue.code, issue.corrected]),
    [["overlap", false]],
  );
  assert.equal(review.compositions[0].elements[1].x, 22);
  assert.equal(review.compositions[0].elements[1].y, 7);
});

test("every defect class has an Arabic label for the surfaces that speak to the author", () => {
  for (const code of ["contrast", "coverage", "overflow", "overlap"] as const) {
    const label = COMPOSITION_ISSUE_LABELS[code];
    assert.ok(
      label && /[\u0600-\u06FF]/.test(label),
      `missing an Arabic label for ${code}`,
    );
  }
});

test("the review is idempotent and deterministic, and never touches copy or boxes", () => {
  const messy = plan([
    el({
      x: 8,
      y: 90,
      w: 84,
      h: 8,
      content: "ا".repeat(500),
      fill: "paper",
      color: "accent",
    }),
    el({ x: 10, y: 88, w: 60, h: 8, role: "meta", content: "نص متداخل" }),
    el({ role: "display", x: 8, y: 20, w: 84, h: 14, content: "قسم محجوب" }),
    el({ type: "shape", x: 6, y: 18, w: 88, h: 18, fill: "field", content: "" }),
  ]);
  const before = snapshot(messy);
  const first = reviewCompositions(messy, PALETTE, SIZE);
  assert.deepEqual(snapshot(messy), before, "the input plan is never mutated");
  assert.deepEqual(
    first.issues.map((issue) => [issue.page, issue.element, issue.code, issue.corrected]),
    [
      [0, 2, "coverage", true],
      [0, 0, "contrast", true],
      [0, 0, "overflow", true],
      [0, 1, "overlap", true],
    ],
  );

  const again = reviewCompositions(first.compositions, PALETTE, SIZE);
  assert.equal(again.issues.length, 0, JSON.stringify(again.issues));
  assert.deepEqual(again.compositions, first.compositions);
  assert.deepEqual(
    reviewCompositions(messy, PALETTE, SIZE).compositions,
    first.compositions,
    "two independent runs agree",
  );

  // Everything except position and the colour role survives, per element.
  const beforeByContent = new Map<string, DesignCompositionElement>(
    before[0].elements.map((element) => [
      `${element.type}:${element.content}`,
      element,
    ] as [string, DesignCompositionElement]),
  );
  for (const element of first.compositions[0].elements) {
    const original = beforeByContent.get(`${element.type}:${element.content}`);
    assert.ok(original, `no element was dropped (${element.content})`);
    assert.equal(element.w, original.w);
    assert.equal(element.h, original.h);
    assert.equal(element.role, original.role);
    assert.equal(element.fill, original.fill);
    assert.equal(element.shape, original.shape);
  }
  assert.equal(
    first.compositions[0].elements.length,
    before[0].elements.length,
    "element count is preserved",
  );
});
