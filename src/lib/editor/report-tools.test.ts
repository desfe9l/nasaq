import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { THEMES, pageSize, type Page } from "./model.ts";
import { MACROS } from "./macros.ts";
import {
  applyFurniture,
  clearFurniture,
  clearPageNumbers,
  furnitureRole,
  hasPageNumber,
  kpiCard,
  numberPages,
  signatureZone,
} from "./report-tools.ts";

const A4 = { w: 210, h: 297 };
const theme = THEMES.official;

const page = (
  id: string,
  elements: Page["elements"] = [],
  size = A4,
): Page => ({
  id,
  name: `صفحة ${id}`,
  w: size.w,
  h: size.h,
  elements,
  ...({} as object),
});

const sizeOf = (p: Page) => pageSize(p);

describe("report furniture", () => {
  it("classifies elements by the band they sit in", () => {
    assert.equal(furnitureRole({ ...blank(), y: 4 }, A4), "header");
    assert.equal(furnitureRole({ ...blank(), y: A4.h - 10 }, A4), "footer");
    assert.equal(furnitureRole({ ...blank(), y: 120 }, A4), null);
    // An explicit role always wins over geometry (a locked footer moved up).
    assert.equal(
      furnitureRole({ ...blank(), y: 120, hfRole: "footer" }, A4),
      "footer",
    );
  });

  it("copies the source page's header and footer onto every same-size page", () => {
    const source = page("1", [
      { ...blank(), id: "h", y: 5, hfRole: "header" },
      { ...blank(), id: "f", y: A4.h - 12, hfRole: "footer" },
      { ...blank(), id: "body", y: 120 },
    ]);
    const target = page("2", [{ ...blank(), id: "own", y: 130 }]);
    const { pages, copied, skipped } = applyFurniture(
      [source, target],
      "1",
      sizeOf,
    );
    assert.equal(copied, 2);
    assert.deepEqual(skipped, []);
    const next = pages[1];
    assert.equal(next.elements.length, 3);
    // The target's own content is untouched; only furniture was added.
    assert.ok(next.elements.some((el) => el.id === "own"));
    const furniture = next.elements.filter((el) => el.hfRole);
    assert.equal(furniture.length, 2);
    // Fresh ids, and locked so an accidental drag cannot unhook the header.
    assert.notEqual(furniture[0].id, "h");
    assert.equal(furniture[0].locked, true);
    // The source keeps its own elements and simply gains the role markers.
    assert.equal(pages[0].elements.length, 3);
    assert.equal(pages[0].elements.filter((el) => el.hfRole).length, 2);
  });

  it("is idempotent: applying twice does not stack headers", () => {
    const source = page("1", [{ ...blank(), id: "h", y: 5 }]);
    const target = page("2", [{ ...blank(), id: "own", y: 130 }]);
    const once = applyFurniture([source, target], "1", sizeOf).pages;
    const twice = applyFurniture(once, "1", sizeOf).pages;
    assert.equal(twice[1].elements.length, 2);
  });

  it("skips pages of a different size instead of stretching the furniture", () => {
    const source = page("1", [{ ...blank(), id: "h", y: 5 }]);
    const slide = page("2", [], { w: 338, h: 190 });
    const { copied, skipped } = applyFurniture([source, slide], "1", sizeOf);
    assert.equal(copied, 0);
    assert.deepEqual(skipped, [2]);
  });

  it("removes every applied header and footer on request", () => {
    const source = page("1", [{ ...blank(), id: "h", y: 5 }]);
    const applied = applyFurniture([source, page("2")], "1", sizeOf).pages;
    const { pages, removed } = clearFurniture(applied);
    assert.equal(removed, 2);
    assert.equal(pages[0].elements.length, 0);
    assert.equal(pages[1].elements.length, 0);
  });
});

describe("page numbering", () => {
  it("adds a rule and a live «صفحة n من m» macro to every page", () => {
    const { pages, added } = numberPages([page("1"), page("2")], theme, sizeOf);
    assert.equal(added, 4);
    for (const p of pages) {
      assert.equal(hasPageNumber(p), true);
      const label = p.elements.find((el) =>
        el.content?.includes(MACROS[2].token),
      );
      assert.ok(label);
      // The macro, not a number: adding a page later renumbers everything.
      assert.match(label.content!, /صفحة/);
    }
  });

  it("does not double-number a page that already has one", () => {
    const first = numberPages([page("1")], theme, sizeOf).pages;
    const second = numberPages(first, theme, sizeOf);
    assert.equal(second.added, 0);
    assert.equal(second.pages[0].elements.length, first[0].elements.length);
  });

  it("can be undone exactly", () => {
    const numbered = numberPages([page("1"), page("2")], theme, sizeOf).pages;
    const { pages, removed } = clearPageNumbers(numbered);
    assert.equal(removed, 4);
    assert.deepEqual(
      pages.map((p) => p.elements.length),
      [0, 0],
    );
  });
});

describe("stamp & signature zone", () => {
  it("comes back as one movable group", () => {
    const zone = signatureZone(theme, { x: 100, y: 220 });
    assert.equal(zone.type, "group");
    assert.equal(zone.name, "منطقة الختم والتوقيع");
    assert.ok((zone.children?.length ?? 0) >= 4);
    // Children are group-relative, so the zone can be dragged as a unit.
    for (const child of zone.children ?? []) {
      assert.ok(child.x >= 0 && child.y >= 0);
      assert.ok(child.x + child.w <= zone.w + 0.01);
    }
  });

  it("can be built with a signature line only", () => {
    const zone = signatureZone(theme, { x: 20, y: 200, parts: ["signature"] });
    const types = (zone.children ?? []).map((el) => el.type);
    assert.ok(types.includes("text"));
    assert.equal(types.includes("stamp"), false);
    assert.match(zone.name, /التوقيع/);
  });
});

describe("KPI cards", () => {
  it("paints the document theme into every card", () => {
    for (const kind of ["progress", "target", "badge"] as const) {
      const parts = kpiCard(kind, "official", {
        x: 20,
        y: 20,
        caption: "نسبة الإنجاز",
        value: 62,
      });
      const card = parts[0];
      assert.equal(card.type, "box");
      assert.equal(card.style.fill, theme.surface);
      assert.equal(card.style.borderColor, theme.line);
      // The card carries real content: a caption plus its visualisation.
      assert.ok(parts.some((el) => el.content === "نسبة الإنجاز"));
      assert.ok(
        parts.some((el) => el.type === "text" && el.content?.includes("62")),
      );
      assert.ok(parts.length >= 3);
    }
  });

  it("uses the theme's own colours, not hardcoded ones", () => {
    const [card] = kpiCard("progress", "eid", {
      x: 0,
      y: 0,
      caption: "x",
      value: 10,
    });
    assert.equal(card.style.fill, THEMES.eid.surface);
    const bar = kpiCard("progress", "eid", {
      x: 0,
      y: 0,
      caption: "x",
      value: 10,
    }).find((el) => el.type === "progress");
    assert.equal(bar?.style.fill, THEMES.eid.primary);
  });

  it("clamps the bar and formats Arabic-Indic numerals on request", () => {
    const over = kpiCard("progress", "official", {
      x: 0,
      y: 0,
      caption: "x",
      value: 240,
    });
    assert.equal(over.find((el) => el.type === "progress")?.style.value, 100);
    const none = kpiCard("badge", "official", {
      x: 0,
      y: 0,
      caption: "x",
      value: 62,
      numerals: "arabic",
    });
    assert.ok(none.some((el) => el.content === "٦٢%"));
  });

  it("scales the target bar against the target's own denominator", () => {
    const parts = kpiCard("target", "official", {
      x: 0,
      y: 0,
      caption: "المستهدف",
      value: 60,
      target: 120,
    });
    assert.equal(parts.find((el) => el.type === "progress")?.style.value, 50);
    assert.ok(parts.some((el) => el.content === "60"));
    assert.ok(parts.some((el) => el.content === "120"));
  });
});

/** A minimal element the geometry-only helpers can read. */
function blank() {
  return {
    id: "x",
    type: "text" as const,
    name: "عنصر",
    x: 20,
    y: 20,
    w: 80,
    h: 10,
    rotation: 0,
    opacity: 1,
    z: 1,
    content: "نص",
    style: {},
  };
}
