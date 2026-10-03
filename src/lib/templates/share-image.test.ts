import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { templateShareImage } from "./share-image.ts";

describe("template share image", () => {
  it("points an SVG preview at the crawlable PNG endpoint, not the platform card", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="905" viewBox="0 0 210 297"></svg>`;
    const thumb = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const image = templateShareImage("nasaq-pack-official", thumb);
    assert.equal(image.type, "image/png");
    assert.match(image.url, /\/api\/templates\/thumbnail\?id=nasaq-pack-official&v=[0-9a-z]+$/);
    assert.equal(image.width, 1200);
    assert.ok(image.height > 1200);
    assert.doesNotMatch(image.url, /\/og\.jpg$/);
  });

  it("keeps the platform card only when the template has no preview", () => {
    const image = templateShareImage("missing", null);
    assert.match(image.url, /\/og\.jpg$/);
    assert.equal(image.type, "image/jpeg");
  });

  it("serves a stored JPEG through the same endpoint", () => {
    const image = templateShareImage("card", "data:image/jpeg;base64,QQ==");
    assert.equal(image.type, "image/jpeg");
    assert.match(image.url, /\/api\/templates\/thumbnail\?id=card&v=[0-9a-z]+$/);
  });
});
