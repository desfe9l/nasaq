import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRAPHIC_HEADINGS,
  buildGraphicHeading,
  headingPrimitives,
  type GraphicHeadingId,
} from "./graphic-headings.ts";
import { THEMES, flattenElements, type CanvasEl } from "./model.ts";

/**
 * «العناوين الرسومية» — the ready-made heading compositions.
 *
 * Two contracts: (1) every catalogue entry builds a complete, RTL-sane group
 * for every theme, and (2) the primitive builders MERGE styles instead of
 * replacing them — type defaults, heading defaults, the builder's style and a
 * per-instance `over.style` all survive, in that order of precedence.
 */

const theme = THEMES.official;

describe("graphic headings — style merging", () => {
  it("text: heading defaults sit on top of the type defaults", () => {
    const el = headingPrimitives.txt(theme, { content: "x" });
    assert.equal(el.type, "text");
    // Heading defaults…
    assert.equal(el.style.fontFamily, "Cairo");
    assert.equal(el.style.textFit, "shrink");
    assert.equal(el.style.lineHeight, 1.45);
    assert.equal(el.style.color, theme.ink);
    // …while untouched type defaults from createElement remain.
    assert.equal(el.style.fontSize, 16);
    assert.equal(el.style.fontWeight, 600);
  });

  it("text: the builder's explicit style overrides the heading defaults", () => {
    const el = headingPrimitives.txt(
      theme,
      { content: "x" },
      { fontFamily: "Tajawal", fontSize: 20, color: "#123456" },
    );
    assert.equal(el.style.fontFamily, "Tajawal");
    assert.equal(el.style.fontSize, 20);
    assert.equal(el.style.color, "#123456");
    assert.equal(el.style.textFit, "shrink", "unrelated defaults survive");
  });

  it("a style passed INSIDE `over` is merged, not discarded", () => {
    // Regression: the helpers used to spread `over` and then assign a fresh
    // `style` object, so `over.style` vanished entirely.
    const el = headingPrimitives.txt(
      theme,
      { content: "x", style: { letterSpacing: 0.4, fontWeight: 900 } },
      { fontSize: 18 },
    );
    assert.equal(el.style.letterSpacing, 0.4, "over.style key kept");
    assert.equal(el.style.fontWeight, 900, "over.style wins over the type default");
    assert.equal(el.style.fontSize, 18, "builder style kept alongside");
    assert.equal(el.style.fontFamily, "Cairo", "heading default kept alongside");
  });

  it("box / line / shape merge the same way", () => {
    const box = headingPrimitives.boxEl(
      theme,
      { content: "", style: { shadow: "0 1mm 2mm rgba(0,0,0,.2)" } },
      { fill: "#ffffff" },
    );
    assert.equal(box.type, "box");
    assert.equal(box.style.fill, "#ffffff");
    assert.equal(box.style.shadow, "0 1mm 2mm rgba(0,0,0,.2)");
    assert.equal(box.style.radius, 3, "heading default radius kept");

    const line = headingPrimitives.lineEl(theme, { style: { borderDash: true } }, { stroke: 1.1 });
    assert.equal(line.type, "line");
    assert.equal(line.style.stroke, 1.1);
    assert.equal(line.style.color, theme.accent);
    assert.equal(line.style.borderDash, true);

    const shape = headingPrimitives.shapeEl(theme, { style: { shapeId: "circle" } }, { fill: theme.accent });
    assert.equal(shape.type, "shape");
    assert.equal(shape.style.fill, theme.accent);
    assert.equal(shape.style.shapeId, "circle");

    const img = headingPrimitives.imgEl(theme, { style: { frameId: "circle" } }, { objectX: 30 });
    assert.equal(img.type, "image");
    assert.equal(img.style.objectFit, "cover");
    assert.equal(img.style.objectX, 30);
    assert.equal(img.style.frameId, "circle");
  });

  it("the merge never aliases the caller's style objects", () => {
    const overStyle = { letterSpacing: 0.2 };
    const style = { fontSize: 11 };
    const el = headingPrimitives.txt(theme, { style: overStyle }, style);
    el.style.fontSize = 99;
    el.style.letterSpacing = 9;
    assert.equal(style.fontSize, 11);
    assert.equal(overStyle.letterSpacing, 0.2);
  });
});

describe("graphic headings — catalogue", () => {
  const themeIds = Object.keys(THEMES) as (keyof typeof THEMES)[];

  it("every catalogue id builds, for every theme, a named group with ≥ 2 children", () => {
    for (const def of GRAPHIC_HEADINGS) {
      for (const themeId of themeIds) {
        const el = buildGraphicHeading(def.id, themeId);
        assert.ok(el, `${def.id}/${themeId} builds`);
        assert.equal(el!.type, "group", `${def.id}/${themeId} is a group`);
        assert.ok((el!.children?.length ?? 0) >= 2, `${def.id}/${themeId} has children`);
        assert.ok(el!.name, `${def.id} group is named`);
        assert.ok(el!.w > 0 && el!.h > 0, `${def.id} has a size`);
      }
    }
  });

  it("an unknown id yields null rather than a broken element", () => {
    assert.equal(buildGraphicHeading("nope" as GraphicHeadingId, "official"), null);
  });

  it("an unknown theme falls back to the official theme", () => {
    const a = buildGraphicHeading("main", "no-such-theme" as never)!;
    const b = buildGraphicHeading("main", "official")!;
    const colours = (el: CanvasEl) =>
      flattenElements([el]).map((e) => [e.style.color, e.style.fill].join("|"));
    assert.deepEqual(colours(a), colours(b));
  });

  it("every heading carries one editable text that shrinks to fit (long Arabic titles)", () => {
    for (const def of GRAPHIC_HEADINGS) {
      const el = buildGraphicHeading(def.id, "official")!;
      const texts = flattenElements([el]).filter((e) => e.type === "text");
      assert.ok(texts.length >= 1, `${def.id} has a text`);
      for (const t of texts) {
        assert.equal(t.style.textFit, "shrink", `${def.id}/${t.name} shrinks`);
        assert.ok(t.style.fontFamily, `${def.id}/${t.name} names a font`);
        assert.ok(t.content, `${def.id}/${t.name} has placeholder content`);
      }
    }
  });

  it("children stay inside the group box (no overflow after grouping)", () => {
    for (const def of GRAPHIC_HEADINGS) {
      const g = buildGraphicHeading(def.id, "official")!;
      for (const c of g.children ?? []) {
        assert.ok(c.x >= -0.01 && c.y >= -0.01, `${def.id}/${c.name} origin inside`);
        assert.ok(c.x + c.w <= g.w + 0.01, `${def.id}/${c.name} right edge inside`);
        assert.ok(c.y + c.h <= g.h + 0.01, `${def.id}/${c.name} bottom edge inside`);
      }
    }
  });

  it("theme colours are applied, not hard-coded, where the design uses the palette", () => {
    const official = buildGraphicHeading("section", "official")!;
    const other = themeIds.find((t) => THEMES[t].primary !== THEMES.official.primary);
    assert.ok(other, "a second theme with a different primary exists");
    const alt = buildGraphicHeading("section", other!)!;
    const bar = (g: CanvasEl) => (g.children ?? []).find((c) => c.name === "شريط جانبي")!;
    assert.equal(bar(official).style.fill, THEMES.official.primary);
    assert.equal(bar(alt).style.fill, THEMES[other!].primary);
  });

  it("image-bearing headings use the placeholder image so «تغيير الصورة» replaces it in place", () => {
    for (const def of GRAPHIC_HEADINGS.filter((d) => d.kind === "image-text")) {
      const g = buildGraphicHeading(def.id, "official")!;
      const images = flattenElements([g]).filter((e) => e.type === "image");
      assert.ok(images.length >= 1, `${def.id} has an image`);
      for (const img of images) {
        assert.equal(img.style.objectFit, "cover", `${def.id} image covers its frame`);
        assert.ok(img.src?.startsWith("data:image/svg+xml"), `${def.id} image carries the placeholder source`);
      }
    }
  });

  it("each builder returns fresh ids — inserting twice never collides", () => {
    const a = flattenElements([buildGraphicHeading("card", "official")!]).map((e) => e.id);
    const b = flattenElements([buildGraphicHeading("card", "official")!]).map((e) => e.id);
    assert.equal(new Set([...a, ...b]).size, a.length + b.length);
  });
});
