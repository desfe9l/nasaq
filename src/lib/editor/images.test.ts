import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fitImageBox,
  imageAdjustCss,
  isAcceptedImage,
  placeImageBox,
  safeImageSrc,
  sharpnessKernel,
  uniqueImageFiles,
} from "./images.ts";

describe("isAcceptedImage", () => {
  const file = (type: string) => ({ type }) as File;

  it("accepts the formats the platform renders", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/svg+xml",
      "image/gif",
    ]) {
      assert.equal(isAcceptedImage(file(type)), true, type);
    }
  });

  it("rejects non-image files", () => {
    assert.equal(isAcceptedImage(file("application/pdf")), false);
    assert.equal(isAcceptedImage(file("text/html")), false);
    assert.equal(isAcceptedImage(file("")), false);
  });
});

describe("fitImageBox", () => {
  it("fits a landscape image to the width and keeps the aspect ratio", () => {
    const box = fitImageBox({ width: 1600, height: 800 }, { w: 100, h: 90 });
    assert.equal(box.w, 100);
    assert.equal(box.h, 50);
  });

  it("fits a portrait image to the height when width would overflow", () => {
    const box = fitImageBox({ width: 800, height: 1600 }, { w: 100, h: 90 });
    assert.equal(box.w, 45);
    assert.equal(box.h, 90);
  });

  it("never exceeds either bound", () => {
    const box = fitImageBox({ width: 4000, height: 3000 }, { w: 60, h: 40 });
    assert.ok(box.w <= 60, `w ${box.w}`);
    assert.ok(box.h <= 40, `h ${box.h}`);
  });

  it("falls back to a 3:2 ratio for a zero-sized image", () => {
    const box = fitImageBox({ width: 0, height: 0 }, { w: 90, h: 90 });
    assert.equal(box.w, 90);
    assert.equal(box.h, 60);
  });

  it("keeps a square image square", () => {
    const box = fitImageBox({ width: 500, height: 500 }, { w: 40, h: 40 });
    assert.equal(box.w, box.h);
  });
});

describe("placeImageBox", () => {
  const page = { w: 210, h: 297 };

  it("uses a sensible contained size and preserves aspect ratio", () => {
    const box = placeImageBox({ width: 1600, height: 800 }, page);
    assert.equal(box.w, 80);
    assert.equal(box.h, 40);
    assert.equal(box.x, 65);
    assert.equal(box.y, 128.5);
  });

  it("gives repeated picker insertions deterministic, distinct positions", () => {
    const first = placeImageBox({ width: 800, height: 800 }, page, { sequence: 0 });
    const second = placeImageBox({ width: 800, height: 800 }, page, { sequence: 1 });
    assert.notDeepEqual(first, second);
    assert.ok(second.x >= 0 && second.y >= 0);
    assert.ok(second.x + second.w <= page.w);
    assert.ok(second.y + second.h <= page.h);
  });

  it("does not repeat placements in larger batches or when the page already has images", () => {
    const image = { width: 800, height: 800 };
    const placements = Array.from({ length: 24 }, (_, sequence) =>
      placeImageBox(image, page, { sequence }),
    );
    const keys = placements.map((box) => `${box.x},${box.y}`);
    assert.equal(new Set(keys).size, placements.length);

    // Regression: the former five-offset cycle placed sequence 12 on top of 2.
    assert.notDeepEqual(
      placeImageBox(image, page, { sequence: 2 }),
      placeImageBox(image, page, { sequence: 12 }),
    );
    for (const box of placements) {
      assert.ok(box.x >= 0 && box.y >= 0);
      assert.ok(box.x + box.w <= page.w);
      assert.ok(box.y + box.h <= page.h);
    }
  });

  it("honors the drop point without an artificial offset and clamps to the page", () => {
    const box = placeImageBox({ width: 1200, height: 600 }, page, {
      at: { x: 2, y: 296 },
    });
    assert.equal(box.x, 0);
    assert.equal(box.y, 257);
    assert.equal(box.w, 80);
    assert.equal(box.h, 40);
  });

  it("uses the smaller logo cap on arbitrary page sizes", () => {
    const box = placeImageBox({ width: 100, height: 50 }, { w: 30, h: 20 }, { intent: "logo" });
    assert.ok(box.w <= 30);
    assert.ok(box.h <= 20);
    assert.equal(box.w / box.h, 2);
  });
});

describe("uniqueImageFiles", () => {
  it("keeps every distinct selected image and drops duplicate browser entries", () => {
    const make = (name: string, size: number, lastModified: number) =>
      ({ name, size, lastModified, type: "image/png" }) as File;
    const files = uniqueImageFiles([
      make("one.png", 10, 1),
      make("two.png", 20, 2),
      make("one.png", 10, 1),
    ]);
    assert.deepEqual(files.map((file) => file.name), ["one.png", "two.png"]);
  });
});

describe("imageAdjustCss", () => {
  it("is absent at the identity and otherwise stays a CSS filter", () => {
    assert.equal(imageAdjustCss({}), undefined);
    assert.equal(imageAdjustCss({ brightness: 100, sharpness: 0 }), undefined);
    assert.equal(imageAdjustCss({ brightness: 130 }), "brightness(1.300)");
    assert.equal(
    imageAdjustCss({ contrast: 120, saturation: 80 }),
    "contrast(1.200) saturate(0.800)",
    );
    assert.match(imageAdjustCss({ sharpness: 40 }) ?? "", /^contrast\(/);
    assert.match(
      imageAdjustCss({ brightness: 80, sharpness: 50 }, "sharp-1") ?? "",
      /^url\(#sharp-1\) brightness\(/,
    );
    assert.equal(sharpnessKernel(0), "0 0.000 0 0.000 1.000 0.000 0 0.000 0");
    assert.equal(sharpnessKernel(100).includes("5.000"), true);
  });
});

describe("safeImageSrc", () => {
  it("keeps the data URLs the platform generates itself", () => {
    // Placeholder and QR artwork are URL-encoded SVG with a charset parameter
    // (`data:image/svg+xml;charset=UTF-8,…`); a stricter pattern than this would
    // blank out images the app created itself. Built literally here because
    // `model.ts` imports through the `@/` alias, which bare node cannot resolve.
    const qr = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
    assert.equal(safeImageSrc(qr), qr);
  });

  it("keeps ordinary sources", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    assert.equal(safeImageSrc(png), png);
    assert.equal(
      safeImageSrc("https://example.com/a.png"),
      "https://example.com/a.png",
    );
    assert.equal(
      safeImageSrc("blob:http://localhost/abc"),
      "blob:http://localhost/abc",
    );
  });

  it("drops sources that could execute script", () => {
    // `src` arrives from an imported .json file, so these are the values a
    // crafted project would carry.
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "data:application/javascript,alert(1)",
      " vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      assert.equal(safeImageSrc(bad), "", bad);
    }
  });

  it("returns an empty string for missing or non-string sources", () => {
    assert.equal(safeImageSrc(undefined), "");
    assert.equal(safeImageSrc(null), "");
    assert.equal(safeImageSrc(""), "");
    assert.equal(safeImageSrc("   "), "");
    assert.equal(safeImageSrc(42), "");
  });
});
