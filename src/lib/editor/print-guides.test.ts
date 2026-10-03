import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CanvasEl, Page } from "./model.ts";
import {
  BLEED_MM,
  CROP_MARK_LENGTH_MM,
  SAFE_MARGIN_MM,
  effectiveDpi,
  elementsInGutter,
  escapesFrame,
  guideGeometry,
  isEmptyPage,
  requiredPixels,
} from "./print-guides.ts";

const A4 = { w: 210, h: 297 };

/** An element with only the geometry the guides look at. */
const el = (over: Partial<CanvasEl> = {}): CanvasEl => ({
  id: "e1",
  type: "text",
  name: "عنصر",
  x: 0,
  y: 0,
  w: 40,
  h: 10,
  rotation: 0,
  opacity: 1,
  z: 1,
  content: "نص",
  style: {},
  ...over,
});

const page = (elements: CanvasEl[], size = A4): Page => ({
  id: "p1",
  name: "صفحة ١",
  elements,
  w: size.w,
  h: size.h,
});

describe("print guides — geometry", () => {
  it("insets the safe area by the safe margin on every side", () => {
    const { safe } = guideGeometry(A4);
    assert.equal(safe.x, SAFE_MARGIN_MM);
    assert.equal(safe.y, SAFE_MARGIN_MM);
    assert.equal(safe.w, A4.w - SAFE_MARGIN_MM * 2);
    assert.equal(safe.h, A4.h - SAFE_MARGIN_MM * 2);
  });

  it("puts the binding band against the RIGHT edge, in RTL reading order", () => {
    // Arabic documents bind on the right: a gutter on the left would be wrong.
    const { gutter } = guideGeometry(A4);
    assert.equal(gutter.x + gutter.w, A4.w);
    assert.equal(gutter.y, 0);
    assert.equal(gutter.h, A4.h);
  });

  it("makes the content box the safe area minus the binding band", () => {
    const geometry = guideGeometry(A4);
    assert.equal(geometry.content.x, SAFE_MARGIN_MM);
    assert.ok(geometry.content.x + geometry.content.w <= geometry.gutter.x);
    // …and never a negative width, even for an absurd gutter.
    const absurd = guideGeometry(A4, undefined, { gutter: 400 });
    assert.equal(absurd.content.w, 0);
  });

  it("draws crop marks only when bleed is on, outside the bleed line", () => {
    assert.equal(
      guideGeometry(A4, { safe: false, gutter: false, bleed: false }).cropMarks
        .length,
      0,
    );
    const marks = guideGeometry(A4, {
      safe: false,
      gutter: false,
      bleed: true,
    }).cropMarks;
    assert.equal(marks.length, 8);
    assert.equal(marks[0].w, CROP_MARK_LENGTH_MM);
    // Top-left tick sits above and left of the bleed box.
    assert.ok(marks[0].x < -BLEED_MM);
    assert.ok(marks[0].y < -BLEED_MM);
    // Bottom-right tick sits below and right of it.
    assert.ok(marks[6].x > A4.w + BLEED_MM);
    assert.ok(marks[6].y > A4.h + BLEED_MM);
  });

  it("expands the bleed box outside the trim", () => {
    const { bleed, trim } = guideGeometry(A4, {
      safe: false,
      gutter: false,
      bleed: true,
    });
    assert.equal(bleed.x, -BLEED_MM);
    assert.equal(bleed.w, trim.w + BLEED_MM * 2);
  });
});

describe("print guides — measurements", () => {
  it("reports the worst axis for a placed image", () => {
    // 1000×500 px at 100×50 mm is 254 dpi on both axes, and stretching it to
    // 200 mm wide halves only the horizontal one — which is what prints.
    assert.equal(effectiveDpi({ w: 1000, h: 500 }, { w: 100, h: 50 }), 254);
    assert.equal(effectiveDpi({ w: 1000, h: 500 }, { w: 200, h: 50 }), 127);
    assert.equal(effectiveDpi({ w: 1000, h: 500 }, { w: 50, h: 50 }), 254);
  });

  it("converts millimetres to the pixels a print needs", () => {
    assert.equal(requiredPixels(25.4, 300), 300);
    assert.equal(requiredPixels(210, 300), 2480);
    assert.equal(requiredPixels(0, 300), 1);
  });

  it("detects escapes with a sub-millimetre tolerance", () => {
    const frame = { x: 0, y: 0, w: 10, h: 10 };
    assert.equal(escapesFrame({ x: 0, y: 0, w: 10, h: 10 }, frame), false);
    assert.equal(escapesFrame({ x: 5, y: 5, w: 5, h: 5 }, frame), false);
    // A hair over the edge is rounding, not a design decision.
    assert.equal(escapesFrame({ x: 0, y: 0, w: 10.005, h: 10 }, frame), false);
    assert.equal(escapesFrame({ x: -0.5, y: 0, w: 10, h: 10 }, frame), true);
    assert.equal(escapesFrame({ x: 9.5, y: 0, w: 2, h: 10 }, frame), true);
  });
});

describe("print guides — page checks", () => {
  it("flags content in the binding band but not full-width furniture", () => {
    const band = page([
      el({ id: "logo", x: A4.w - 12, y: 20, w: 10, h: 10 }),
      el({ id: "header", x: 0, y: 0, w: A4.w, h: 20, type: "box" }),
      el({ id: "body", x: 20, y: 60, w: 60, h: 10 }),
    ]);
    assert.deepEqual(
      elementsInGutter(band, A4).map((e) => e.id),
      ["logo"],
    );
  });

  it("treats a page of empty boxes as blank, artwork as not blank", () => {
    assert.equal(isEmptyPage(page([])), true);
    assert.equal(isEmptyPage(page([el({ content: "   " })])), true);
    assert.equal(isEmptyPage(page([el({ content: "تقرير" })])), false);
    assert.equal(
      isEmptyPage(page([el({ type: "image", src: "x.png" })])),
      false,
    );
  });
});
