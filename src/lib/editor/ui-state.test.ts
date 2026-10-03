import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BUBBLE_FOLDS,
  BUBBLE_PARTS,
  MEASURE_TOLERANCE_MM,
  OVERLAY_BREAKPOINT,
  PAGES_PANEL_DEFAULT,
  PAGES_PANEL_MIN,
  anchorMenuPlacement,
  bubbleBarWidth,
  bubbleLayout,
  clampPagesHeight,
  clampParkedPoint,
  extractSvgMarkup,
  isOverlayViewport,
  measuredSelectionBox,
  panelSpawnRect,
  resolveEditorSurface,
  parseStoredPoint,
  placeFloatingToolbar,
  fitSideDockWidths,
  tipPlacement,
  type ScreenBox,
} from "./ui-state.ts";

/** Overlap area of two boxes, used to assert "never covers X". */
function overlap(
  _origin: { left: number; top: number },
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): number {
  const w =
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h =
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

const box = (
  left: number,
  top: number,
  width: number,
  height: number,
): ScreenBox => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe("fitSideDockWidths", () => {
  it("keeps both docks on a wide desktop", () => {
    assert.deepEqual(fitSideDockWidths(1440, 340, 380, 264, 500), {
      left: 340,
      right: 380,
    });
  });

  it("scales both docks on an iPad landscape that is only slightly tight", () => {
    const fit = fitSideDockWidths(1194, 340, 380, 264, 501);
    assert.ok(fit.left && fit.right);
    assert.ok(fit.left! >= 264 && fit.right! >= 264);
    assert.ok(fit.left! + fit.right! <= 1194 - 501);
  });

  it("floats the inspector on iPad portrait so the page keeps a floor", () => {
    const fit = fitSideDockWidths(834, 333, 333, 264, 350);
    assert.equal(fit.left, null);
    assert.ok((fit.right ?? 0) >= 264);
    assert.ok(834 - (fit.right ?? 0) >= 280);
  });
});

describe("clampPagesHeight", () => {
  it("never lets the pages panel collapse below its minimum", () => {
    assert.equal(clampPagesHeight(0), PAGES_PANEL_MIN);
    assert.equal(clampPagesHeight(-400), PAGES_PANEL_MIN);
    assert.equal(clampPagesHeight(PAGES_PANEL_MIN - 1), PAGES_PANEL_MIN);
  });

  it("leaves a sane height untouched, rounded to whole pixels", () => {
    assert.equal(clampPagesHeight(110), 110);
    assert.equal(clampPagesHeight(110.6), 111);
  });

  it("caps the panel so the artboard keeps usable room (headless viewport 900)", () => {
    // Even a very tall workspace keeps a single compact row.
    assert.equal(clampPagesHeight(5000), 144);
    assert.ok(clampPagesHeight(5000) < 900);
  });

  it("falls back to the default for a non-numeric value", () => {
    assert.equal(clampPagesHeight(Number.NaN), PAGES_PANEL_DEFAULT);
  });
});

describe("extractSvgMarkup", () => {
  it("keeps an svg that arrives with an XML prolog and a doctype", () => {
    const file = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>`;
    const out = extractSvgMarkup(file);
    assert.ok(out);
    assert.ok(out!.startsWith("<svg"));
    assert.ok(out!.endsWith("</svg>"));
    assert.ok(!out!.includes("<?xml"));
  });

  it("returns null when there is no svg root at all", () => {
    assert.equal(
      extractSvgMarkup("<html><body>لا يوجد رسم</body></html>"),
      null,
    );
    assert.equal(extractSvgMarkup(""), null);
  });

  it("rejects a root that is too small to be a real drawing", () => {
    assert.equal(extractSvgMarkup("<svg></svg>"), null);
  });

  it("matches the closing tag case-insensitively and tolerates whitespace", () => {
    const out = extractSvgMarkup(
      "<SVG xmlns='x'><rect width='4' height='4'/></SVG  >",
    );
    assert.ok(out);
  });
});

describe("isOverlayViewport", () => {
  it("reports docked mode when there is no browser viewport (SSR/tests)", () => {
    assert.equal(isOverlayViewport(), false);
  });

  it("keeps one breakpoint constant for the shell and the store", () => {
    /*
     * 768: iPad portrait docks the same windows as the desktop. Narrower viewports
     * stay slide-overs. The shell derives its `matchMedia` query from this same
     * constant (`EditorApp`).
     */
    assert.equal(OVERLAY_BREAKPOINT, 768);
  });
});

describe("placeFloatingToolbar", () => {
  const viewport = { width: 1440, height: 900 };
  const size = { width: 420, height: 44 };

  it("sits 16px above the element when there is room", () => {
    const out = placeFloatingToolbar(box(600, 400, 200, 120), size, viewport);
    assert.equal(out.placement, "above");
    assert.equal(out.top, 400 - 16 - 44);
    assert.equal(out.left, 600 + 100 - 210);
    assert.equal(out.clamped, false);
  });

  it("flips below when the element is near the top edge", () => {
    const out = placeFloatingToolbar(box(600, 6, 200, 120), size, viewport);
    assert.equal(out.placement, "below");
    assert.equal(out.top, 6 + 120 + 16);
  });

  it("never leaves the viewport horizontally (both edges)", () => {
    const rightEdge = placeFloatingToolbar(
      box(1380, 400, 40, 40),
      size,
      viewport,
    );
    assert.equal(rightEdge.left, viewport.width - size.width - 8);
    assert.equal(rightEdge.clamped, true);

    // dir="rtl" is irrelevant to the maths: the left edge clamps the same way.
    const leftEdge = placeFloatingToolbar(box(0, 400, 40, 40), size, viewport);
    assert.equal(leftEdge.left, 8);
    assert.equal(leftEdge.clamped, true);
  });

  it("keeps the toolbar visible when the element is taller than the viewport", () => {
    const tiny = { width: 380, height: 300 };
    const out = placeFloatingToolbar(
      box(20, 20, 300, 500),
      { width: 320, height: 44 },
      tiny,
    );
    assert.ok(out.top >= 8);
    assert.ok(
      out.top + 44 <= tiny.height,
      "toolbar stays inside the vertical bounds",
    );
    assert.ok(out.left >= 8 && out.left + 320 <= tiny.width);
  });

  it("pins to the margin when the viewport is narrower than the toolbar", () => {
    const narrow = { width: 300, height: 800 };
    const out = placeFloatingToolbar(
      box(20, 400, 200, 80),
      { width: 320, height: 44 },
      narrow,
    );
    assert.equal(out.left, 8);
    assert.equal(out.clamped, true);
  });

  it("centres on the element's screen box, not its flow position", () => {
    const a = placeFloatingToolbar(box(300, 500, 100, 50), size, viewport);
    const b = placeFloatingToolbar(box(700, 500, 100, 50), size, viewport);
    assert.equal(b.left - a.left, 400);
  });
});

describe("placeFloatingToolbar obstacle avoidance", () => {
  const viewport = { width: 1440, height: 900 };
  const size = { width: 420, height: 44 };
  /** The docked properties panel: a 320px column on the left edge. */
  const propertiesPanel: ScreenBox = {
    left: 0,
    top: 52,
    width: 320,
    height: 848,
    right: 320,
    bottom: 900,
  };

  it("steps around the properties panel instead of covering it", () => {
    const out = placeFloatingToolbar(
      box(200, 400, 200, 120),
      size,
      viewport,
      16,
      8,
      [propertiesPanel],
    );
    const box$ = {
      left: out.left,
      top: out.top,
      width: size.width,
      height: size.height,
    };
    assert.equal(
      overlap(out, box$, propertiesPanel),
      0,
      "bubble must not overlap the panel",
    );
    // Above/below would have centred it over the panel, so it moved to a side.
    assert.ok(
      out.placement === "right" ||
        out.placement === "above" ||
        out.placement === "below",
    );
    assert.ok(
      out.left >= propertiesPanel.right,
      `expected the bubble right of the panel, got ${out.left}`,
    );
  });

  it("keeps the preferred placement when nothing is in the way", () => {
    const out = placeFloatingToolbar(
      box(700, 400, 200, 120),
      size,
      viewport,
      16,
      8,
      [propertiesPanel],
    );
    assert.equal(out.placement, "above");
    assert.equal(out.top, 400 - 16 - 44);
  });

  it("avoids the header when the element is scrolled to the top", () => {
    const header: ScreenBox = {
      left: 0,
      top: 0,
      width: 1440,
      height: 52,
      right: 1440,
      bottom: 52,
    };
    const out = placeFloatingToolbar(
      box(700, 60, 200, 120),
      size,
      viewport,
      16,
      8,
      [header],
    );
    assert.ok(
      out.top >= header.bottom,
      `expected the bubble below the header, got ${out.top}`,
    );
  });

  it("never covers the selected element even when every side is blocked", () => {
    const walled: ScreenBox[] = [
      { left: 0, top: 0, width: 1440, height: 380, right: 1440, bottom: 380 },
      { left: 0, top: 560, width: 1440, height: 340, right: 1440, bottom: 900 },
    ];
    const anchor = box(600, 420, 240, 100);
    const out = placeFloatingToolbar(anchor, size, viewport, 16, 8, walled);
    const box$ = {
      left: out.left,
      top: out.top,
      width: size.width,
      height: size.height,
    };
    // Sides win: they have no vertical overlap with the walls at all.
    assert.ok(out.placement === "left" || out.placement === "right");
    assert.equal(overlap(out, box$, anchor), 0);
  });
});


describe("measuredSelectionBox", () => {
  /*
   * A 210mm page rendered 1px per mm at 1 zoom: scale = 1 mm/px, which makes
   * every expectation readable as millimetres.
   */
  const page = { left: 100, top: 50, width: 210 };
  const model = { x: 20, y: 30, w: 60, h: 40 };

  it("returns the artwork's own box when it matches the model", () => {
    const out = measuredSelectionBox({
      node: {
        left: page.left + model.x,
        top: page.top + model.y,
        right: page.left + model.x + model.w,
        bottom: page.top + model.y + model.h,
      },
      page,
      pageWidthMm: 210,
      model,
      rotation: 0,
    });
    assert.ok(out);
    assert.equal(out.x, model.x);
    assert.equal(out.y, model.y);
    assert.equal(out.w, model.w);
    assert.equal(out.h, model.h);
  });

  it("follows a node whose painted box carries padding", () => {
    const out = measuredSelectionBox({
      node: {
        left: page.left + model.x + 1,
        top: page.top + model.y + 1,
        right: page.left + model.x + model.w - 1,
        bottom: page.top + model.y + model.h - 1,
      },
      page,
      pageWidthMm: 210,
      model,
      rotation: 0,
    });
    assert.ok(out);
    assert.equal(out.w, model.w - 2);
    assert.equal(out.h, model.h - 2);
    // Shrinking is centred, so the frame keeps hugging the artwork.
    assert.equal(out.x, model.x + 1);
    assert.equal(out.y, model.y + 1);
  });

  it("un-rotates a quarter-turn box back to the model rectangle", () => {
    /*
     * Rotated 90°, a 60×40 element paints a 40×60 screen rect. Un-rotating its
     * corners about the model centre must return 60×40 — this is the case that
     * makes the frame land on the artwork instead of on its bounding square.
     */
    const cx = page.left + model.x + model.w / 2;
    const cy = page.top + model.y + model.h / 2;
    const out = measuredSelectionBox({
      node: { left: cx - 20, top: cy - 30, right: cx + 20, bottom: cy + 30 },
      page,
      pageWidthMm: 210,
      model,
      rotation: 90,
    });
    assert.ok(out);
    assert.equal(out.w, model.w);
    assert.equal(out.h, model.h);
    assert.equal(out.x, model.x);
    assert.equal(out.y, model.y);
  });

  it("refuses a measurement that contradicts the model", () => {
    const out = measuredSelectionBox({
      node: {
        left: page.left + model.x,
        top: page.top + model.y,
        // 20mm too wide: this is not the element's own rectangle.
        right: page.left + model.x + model.w + 20,
        bottom: page.top + model.y + model.h,
      },
      page,
      pageWidthMm: 210,
      model,
      rotation: 0,
    });
    assert.equal(out, null);
    assert.ok(MEASURE_TOLERANCE_MM < 20);
  });

  it("refuses unusable input instead of guessing", () => {
    const base = {
      page,
      pageWidthMm: 210,
      model,
      rotation: 0,
    };
    assert.equal(
      measuredSelectionBox({
        ...base,
        node: { left: 0, top: 0, right: 0, bottom: 0 },
      }),
      null,
    );
    assert.equal(
      measuredSelectionBox({
        ...base,
        pageWidthMm: 0,
        node: {
          left: page.left,
          top: page.top,
          right: page.left + 60,
          bottom: page.top + 40,
        },
      }),
      null,
    );
    // A slanted rotation makes the axis-aligned rect a poor proxy.
    assert.equal(
      measuredSelectionBox({
        ...base,
        rotation: 60,
        node: {
          left: page.left,
          top: page.top,
          right: page.left + 60,
          bottom: page.top + 40,
        },
      }),
      null,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Anchored menus, tooltips and floating panels                               */
/* -------------------------------------------------------------------------- */

describe("anchored menu placement", () => {
  const viewport = { width: 390, height: 844 };
  const size = { width: 232, height: 300 };

  it("aligns to the anchor's end edge — the RTL reading direction", () => {
    const at = anchorMenuPlacement(
      box(300, 200, 40, 40),
      size,
      viewport,
      { align: "end" },
    );
    assert.equal(at.left, 300 + 40 - 232);
    assert.equal(at.side, "bottom");
  });

  it("opens above when there is no room below", () => {
    const at = anchorMenuPlacement(box(40, 700, 40, 40), size, viewport);
    assert.equal(at.side, "above");
    assert.ok(at.top + size.height <= 700, "menu must end above the anchor");
  });

  it("never hangs off either edge of a phone", () => {
    const start = anchorMenuPlacement(box(2, 300, 30, 30), size, viewport, {
      align: "start",
    });
    const end = anchorMenuPlacement(box(360, 300, 30, 30), size, viewport);
    for (const at of [start, end]) {
      assert.ok(at.left >= 0, `left ${at.left} inside the viewport`);
      assert.ok(at.left + size.width <= viewport.width, "menu fits the width");
      assert.ok(at.top >= 0, "menu fits above the top edge");
      assert.ok(at.top + size.height <= viewport.height, "menu fits below the bottom edge");
    }
  });

  it("keeps a menu narrower than the viewport intact", () => {
    const at = anchorMenuPlacement(
      box(10, 10, 20, 20),
      { width: viewport.width - 16, height: 120 },
      viewport,
      { align: "start" },
    );
    assert.equal(at.left, 8);
  });
});

describe("tooltip placement", () => {
  const viewport = { width: 390, height: 844 };
  const size = { width: 180, height: 48 };

  it("prefers the requested side and stays centred on the control", () => {
    const at = tipPlacement({ left: 100, top: 400, width: 40, height: 40 }, size, viewport, "bottom");
    assert.equal(at.side, "bottom");
    assert.equal(at.left, 100 + 20 - 90);
  });

  it("flips rather than leaving the screen", () => {
    const at = tipPlacement({ left: 100, top: 810, width: 40, height: 40 }, size, viewport, "bottom");
    assert.equal(at.side, "above");
    assert.ok(at.top + size.height <= 810);
  });

  it("clamps a control that sits in the very corner", () => {
    const at = tipPlacement({ left: 370, top: 830, width: 20, height: 14 }, size, viewport, "bottom");
    assert.ok(at.left + size.width <= viewport.width, "tooltip fits the right edge");
    assert.ok(at.top + size.height <= viewport.height, "tooltip fits the bottom edge");
  });
});

describe("floating panel spawn", () => {
  it("hugs the stage corner without covering the artboard centre", () => {
    const stage = box(0, 52, 1440, 700);
    const at = panelSpawnRect(stage, { width: 320, height: 520 }, { width: 1440, height: 900 });
    assert.equal(at.width, 320);
    assert.equal(at.left, 1440 - 320 - 12);
    assert.equal(at.top, 52 + 12);
  });

  it("fits a phone instead of asking for desktop width", () => {
    const stage = box(0, 96, 390, 600);
    const at = panelSpawnRect(stage, { width: 320, height: 900 }, { width: 390, height: 844 });
    assert.ok(at.width <= 390 - 24, `panel width ${at.width}`);
    assert.ok(at.height <= 844 - 24, `panel height ${at.height}`);
    assert.ok(at.left >= 0 && at.left + at.width <= 390, "panel stays on screen");
    assert.ok(at.top + at.height <= 844, "panel stays on screen vertically");
  });
});

describe("selection bubble density", () => {
  const LANES = [1920, 1440, 1194, 1024, 834, 768, 700, 620, 480, 390, 320];

  it("keeps every control in the bar on a desktop or tablet lane", () => {
    for (const lane of [1920, 1194, 1024, 834, 768]) {
      const text = bubbleLayout("text", lane);
      assert.deepEqual(text.bar, [...BUBBLE_PARTS.text]);
      assert.deepEqual(text.drawer, []);
      const object = bubbleLayout("object", lane);
      assert.deepEqual(object.bar, [...BUBBLE_PARTS.object]);
    }
  });

  it("is decided by the lane alone, so switching tools cannot resize the bar", () => {
    // Same kind + same lane ⇒ byte-identical layout, whatever the element is.
    const a = bubbleLayout("text", 834);
    const b = bubbleLayout("text", 834);
    assert.deepEqual(a, b);
    assert.equal(bubbleBarWidth(a.bar), bubbleBarWidth(b.bar));
    // Two different lanes inside the same band agree too.
    assert.deepEqual(bubbleLayout("text", 800).bar, bubbleLayout("text", 1200).bar);
  });

  it("folds controls into a drawer instead of shrinking them on a phone lane", () => {
    const narrow = bubbleLayout("text", 390);
    assert.ok(narrow.drawer.length > 0, "something moved to the group drawer");
    assert.ok(narrow.bar.includes("drawer"), "the bar shows one drawer trigger");
    // Folding loses slots, never tools: everything is still reachable.
    const accounted = new Set([...narrow.bar, ...narrow.drawer, ...narrow.more]);
    for (const part of BUBBLE_PARTS.text)
      assert.ok(accounted.has(part), `${part} is still reachable`);
    // The structural controls never fold away.
    for (const part of ["grip", "more", "close"] as const)
      assert.ok(narrow.bar.includes(part), `${part} stays in the bar`);
  });

  it("drops the border control entirely when the element cannot carry one", () => {
    const plain = bubbleLayout("text", 1920, { stroke: false });
    assert.ok(!plain.bar.includes("stroke"));
    assert.ok(!plain.drawer.includes("stroke"));
    assert.ok(
      bubbleBarWidth(plain.bar) < bubbleBarWidth(bubbleLayout("text", 1920).bar),
      "no empty slot is left behind",
    );
  });

  it("never paints a bar wider than the lane it was given", () => {
    for (const kind of ["text", "object"] as const) {
      for (const stroke of [true, false]) {
        for (const lane of LANES) {
          const { bar } = bubbleLayout(kind, lane, { stroke });
          assert.ok(
            bubbleBarWidth(bar) <= lane,
            `${kind} (stroke=${stroke}) at ${lane}px paints ${bubbleBarWidth(bar)}px`,
          );
        }
      }
    }
  });

  it("folds in a fixed order, so the bar shrinks predictably", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const folded of BUBBLE_FOLDS.text) {
      const bar = BUBBLE_PARTS.text.filter((part) => !folded.includes(part));
      const width = bubbleBarWidth(bar);
      assert.ok(width < previous, `folding ${folded.join("+") || "nothing"} narrows the bar`);
      previous = width;
    }
  });
});

describe("parked floating drawers", () => {
  it("reads back a stored park and rejects anything unusable", () => {
    assert.deepEqual(parseStoredPoint('{"x":120,"y":80}'), { x: 120, y: 80 });
    assert.equal(parseStoredPoint(null), null);
    assert.equal(parseStoredPoint(""), null);
    assert.equal(parseStoredPoint("not json"), null);
    assert.equal(parseStoredPoint('{"x":12}'), null);
    assert.equal(parseStoredPoint('{"x":"12","y":8}'), null);
    assert.equal(parseStoredPoint('{"x":NaN,"y":8}'), null);
    assert.equal(parseStoredPoint("[1,2]"), null);
  });

  it("brings a park back on screen when the viewport shrank", () => {
    const at = clampParkedPoint(
      { x: 1200, y: 900 },
      { width: 240, height: 320 },
      { width: 834, height: 1194 },
    );
    assert.ok(at.x + 240 <= 834 - 8, `x ${at.x}`);
    assert.ok(at.y + 320 <= 1194 - 8, `y ${at.y}`);
  });

  it("leaves a park that already fits untouched", () => {
    const at = clampParkedPoint(
      { x: 120, y: 80 },
      { width: 240, height: 320 },
      { width: 1440, height: 900 },
    );
    assert.deepEqual(at, { x: 120, y: 80 });
  });

  it("keeps a drawer larger than the viewport pinned to the margin", () => {
    const at = clampParkedPoint(
      { x: 40, y: 40 },
      { width: 900, height: 400 },
      { width: 390, height: 844 },
    );
    // Horizontally pinned to the margin; vertically it still fits, so it stays.
    assert.deepEqual(at, { x: 8, y: 40 });
  });
});

describe("resolveEditorSurface — one responsive system, not a pile of queries", () => {
  const fine = false;
  it("desktop at every shipped desktop width", () => {
    assert.equal(resolveEditorSurface(1366, 768, fine), "desktop");
    assert.equal(resolveEditorSurface(1440, 900, fine), "desktop");
    assert.equal(resolveEditorSurface(1920, 1080, fine), "desktop");
  });
  it("iPad portrait gets the tablet band, not the phone band", () => {
    assert.equal(resolveEditorSurface(768, 1024, true), "tablet-portrait");
    assert.equal(resolveEditorSurface(810, 1080, true), "tablet-portrait");
    assert.equal(resolveEditorSurface(834, 1112, true), "tablet-portrait");
    assert.equal(resolveEditorSurface(1024, 1366, true), "tablet-portrait");
  });
  it("iPad landscape docks like a desktop but keeps touch density", () => {
    assert.equal(resolveEditorSurface(1180, 820, true), "tablet-landscape");
    assert.equal(resolveEditorSurface(1366, 1024, true), "tablet-landscape");
    assert.equal(resolveEditorSurface(1024, 768, false), "tablet-landscape");
  });
  it("phones resolve by orientation, portrait and landscape alike", () => {
    assert.equal(resolveEditorSurface(390, 844, true), "mobile-portrait");
    assert.equal(resolveEditorSurface(844, 390, true), "mobile-landscape");
    assert.equal(resolveEditorSurface(844, 390, false), "mobile-landscape");
    assert.equal(resolveEditorSurface(360, 640, false), "mobile-portrait");
  });
  it("fullscreen mode takes precedence across every device size", () => {
    assert.equal(resolveEditorSurface(1920, 1080, false, true), "fullscreen");
    assert.equal(resolveEditorSurface(1024, 768, true, true), "fullscreen");
    assert.equal(resolveEditorSurface(390, 844, true, true), "fullscreen");
  });
  it("garbage geometry falls back to the smallest surface, never crashes", () => {
    assert.equal(resolveEditorSurface(Number.NaN, Number.NaN, false), "mobile-portrait");
    assert.equal(resolveEditorSurface(-100, -50, false), "mobile-portrait");
  });
});
