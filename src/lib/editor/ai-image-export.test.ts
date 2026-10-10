/**
 * AI-generated artwork must survive Office export.
 *
 * The editor's AI design generator paints pictures as `data:image/svg+xml`
 * URLs (a themed SVG plate), and an uploaded `.svg` or a pasted library asset
 * arrives the same way. The raster exporters (PNG/PDF) snapshot the live DOM,
 * so they always carried the artwork — but the editable Office writers embed
 * raster bytes only: `docx-writer` skipped any source its PNG/JPEG regex did
 * not match, and pptxgenjs rejected an SVG data URL for "`data` value lacks a
 * base64 header". A document made from an AI prompt therefore exported a Word
 * file and a PowerPoint deck with the cover picture simply missing.
 *
 * This file pins the decode/decision logic. The real pipeline — the picture
 * rasterised through a real browser and embedded by the real writers — is
 * verified by `scripts/test-ai-image-export.mjs`, which reads the exported
 * `.docx`/`.pptx` bytes, because rasterising SVG needs a browser `<img>` that
 * the Node canvas harness does not provide.
 */
import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { officeSvgMarkup, svgDataUrlMarkup } from "./svg.ts";
import { safeImageSrc } from "./images";

const ART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">' +
  '<rect width="100" height="60" fill="#0c3d2c"/>' +
  '<circle cx="50" cy="30" r="22" fill="#c6a05a"/></svg>';
const PERCENT_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ART)}`;
const BASE64_SRC = `data:image/svg+xml;base64,${Buffer.from(ART).toString("base64")}`;

test("decodes percent-encoded and base64 SVG data URLs", () => {
  assert.match(svgDataUrlMarkup(PERCENT_SRC), /<svg[\s\S]*<circle/);
  assert.match(svgDataUrlMarkup(BASE64_SRC), /<svg[\s\S]*<circle/);
});

test("ignores non-SVG sources so raster pictures are not needlessly decoded", () => {
  assert.equal(svgDataUrlMarkup("data:image/png;base64,AAAA"), "");
  assert.equal(svgDataUrlMarkup("https://example.com/a.png"), "");
  assert.equal(svgDataUrlMarkup("blob:http://localhost/deadbeef"), "");
  assert.equal(svgDataUrlMarkup(""), "");
  assert.equal(svgDataUrlMarkup(undefined), "");
});

test("an SVG-sourced picture yields markup for rasterisation", () => {
  const markup = officeSvgMarkup({ type: "image", src: PERCENT_SRC });
  assert.match(markup, /<svg/);
  assert.match(markup, /fill="#0c3d2c"/);
});

test("a base64 SVG picture yields markup too, not a dropped element", () => {
  const markup = officeSvgMarkup({ type: "image", src: BASE64_SRC });
  assert.match(markup, /<svg/);
  assert.match(markup, /<circle/);
});

test("a native svg element yields its sanitised markup", () => {
  const markup = officeSvgMarkup({ type: "svg", content: ART });
  assert.match(markup, /<svg/);
  assert.match(markup, /<circle/);
});

test("raster pictures and plain shapes yield nothing", () => {
  assert.equal(
    officeSvgMarkup({ type: "image", src: "data:image/png;base64,AAAA" }),
    "",
  );
  assert.equal(officeSvgMarkup({ type: "shape" }), "");
});
 test(\"AI-generated SVG data URL is allowed by safeImageSrc and yields correct markup for preview\", () => {
   const src = BASE64_SRC; // or PERCENT_SRC
   const safe = safeImageSrc(src);
   assert.equal(safe, src, \"safeImageSrc should return the SVG data URL unchanged\");
   const markup = svgDataUrlMarkup(safe);
   assert.match(markup, /<circle>/);
 });
