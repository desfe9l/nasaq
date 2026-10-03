import assert from "node:assert/strict";
import test from "node:test";
import {
  applyInstitutionalBackground,
  normalizeInstitutionalCatalog,
  visibleInstitutionalBackgrounds,
} from "./institutional-backgrounds.ts";

const png = "data:image/png;base64,iVBORw0KGgo=";

test("catalog drops invalid sources and keeps order", () => {
  const catalog = normalizeInstitutionalCatalog({
    updatedAt: 5,
    items: [
      { id: "b", name: "ثاني", src: png, sortOrder: 2, published: true, w: 10, h: 20 },
      { id: "a", name: "أول", src: png, sortOrder: 0, published: false, w: 10, h: 20 },
      { id: "bad", name: "رابط", src: "https://example.com/x.png", published: true },
    ],
  });
  assert.equal(catalog.items.length, 2);
  assert.equal(catalog.items[0].id, "a");
  assert.equal(catalog.items[0].published, false);
  assert.deepEqual(visibleInstitutionalBackgrounds(catalog, false).map((item) => item.id), ["b"]);
  assert.equal(visibleInstitutionalBackgrounds(catalog, true).length, 2);
});

test("apply stays a page background, not an element", () => {
  const paint = applyInstitutionalBackground({ bgImageFit: "contain" }, { src: png });
  assert.equal(paint.bgImage, png);
  assert.equal(paint.bgImageFit, "contain");
  assert.equal("x" in paint, false);
});
