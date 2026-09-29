import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MEASURE_TOLERANCE_MM,
  OVERLAY_BREAKPOINT,
  PAGES_PANEL_DEFAULT,
  PAGES_PANEL_MIN,
  anchorMenuPlacement,
  clampPagesHeight,
  extractSvgMarkup,
  isOverlayViewport,
  measuredSelectionBox,
  panelSpawnRect,
  placeFloatingToolbar,
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
     * 1100, not the classic 1024: at 1024–1100 two docked panels plus a usable
     * A4 artboard no longer fit, so the tablet slide-over layout has to start a
     * little earlier. The shell derives its `matchMedia` query from this same
     * constant (`EditorApp`), which is what makes "one breakpoint" true.
     */
    assert.equal(OVERLAY_BREAKPOINT, 1100);
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
