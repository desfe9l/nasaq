import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OVERLAY_BREAKPOINT,
  PAGES_PANEL_DEFAULT,
  PAGES_PANEL_MIN,
  clampPagesHeight,
  extractSvgMarkup,
  isOverlayViewport,
  placeFloatingToolbar,
  type ScreenBox,
} from "./ui-state.ts";

const box = (left: number, top: number, width: number, height: number): ScreenBox => ({
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
    assert.equal(clampPagesHeight(210), 210);
    assert.equal(clampPagesHeight(210.6), 211);
  });

  it("caps the panel so the artboard keeps usable room (headless viewport 900)", () => {
    // 900 - 220 = 680 reserved-space bound vs 60% of 900 = 540 → 540 wins.
    assert.equal(clampPagesHeight(5000), 540);
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
    assert.equal(extractSvgMarkup("<html><body>لا يوجد رسم</body></html>"), null);
    assert.equal(extractSvgMarkup(""), null);
  });

  it("rejects a root that is too small to be a real drawing", () => {
    assert.equal(extractSvgMarkup("<svg></svg>"), null);
  });

  it("matches the closing tag case-insensitively and tolerates whitespace", () => {
    const out = extractSvgMarkup("<SVG xmlns='x'><rect width='4' height='4'/></SVG  >");
    assert.ok(out);
  });
});

describe("isOverlayViewport", () => {
  it("reports docked mode when there is no browser viewport (SSR/tests)", () => {
    assert.equal(isOverlayViewport(), false);
  });

  it("keeps one breakpoint constant for the shell and the store", () => {
    assert.equal(OVERLAY_BREAKPOINT, 1024);
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
    const rightEdge = placeFloatingToolbar(box(1380, 400, 40, 40), size, viewport);
    assert.equal(rightEdge.left, viewport.width - size.width - 8);
    assert.equal(rightEdge.clamped, true);

    // dir="rtl" is irrelevant to the maths: the left edge clamps the same way.
    const leftEdge = placeFloatingToolbar(box(0, 400, 40, 40), size, viewport);
    assert.equal(leftEdge.left, 8);
    assert.equal(leftEdge.clamped, true);
  });

  it("keeps the toolbar visible when the element is taller than the viewport", () => {
    const tiny = { width: 380, height: 300 };
    const out = placeFloatingToolbar(box(20, 20, 300, 500), { width: 320, height: 44 }, tiny);
    assert.ok(out.top >= 8);
    assert.ok(out.top + 44 <= tiny.height, "toolbar stays inside the vertical bounds");
    assert.ok(out.left >= 8 && out.left + 320 <= tiny.width);
  });

  it("pins to the margin when the viewport is narrower than the toolbar", () => {
    const narrow = { width: 300, height: 800 };
    const out = placeFloatingToolbar(box(20, 400, 200, 80), { width: 320, height: 44 }, narrow);
    assert.equal(out.left, 8);
    assert.equal(out.clamped, true);
  });

  it("centres on the element's screen box, not its flow position", () => {
    const a = placeFloatingToolbar(box(300, 500, 100, 50), size, viewport);
    const b = placeFloatingToolbar(box(700, 500, 100, 50), size, viewport);
    assert.equal(b.left - a.left, 400);
  });
});
