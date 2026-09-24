import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fitImageBox, isAcceptedImage, safeImageSrc } from "./images.ts";

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
