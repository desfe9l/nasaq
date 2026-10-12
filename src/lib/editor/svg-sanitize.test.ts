/**
 * SVG sanitisation — the attack surfaces the core scrubber suite
 * (svg-scrub.test.ts) does not already pin: the two value guards used by the
 * React renderer, CSS-borne script, foreignObject/HTML smuggling, entity and
 * whitespace evasions, the library-import variant, and size/idempotence.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SVG_ALLOWED_ATTRS,
  SVG_ALLOWED_TAGS,
  safeLibrarySvg,
  safeSvgHref,
  safeSvgUrlRef,
  scrubSvgMarkup,
  svgDangerFindings,
} from "./svg-scrub.ts";

test("safeSvgHref: only an in-document fragment survives", () => {
  assert.equal(safeSvgHref("#grad"), "#grad");
  assert.equal(safeSvgHref("   #grad  "), "#grad");
  for (const bad of [
    "https://evil.example/a.svg#x",
    "//evil.example/a.svg",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "x.svg#frag",
    "",
    "   ",
  ]) {
    assert.equal(safeSvgHref(bad), "", bad);
  }
});

test("safeSvgUrlRef: url(#id) in every quoting style, nothing external", () => {
  for (const ok of ["url(#g)", "url('#g')", 'url("#g")', "  url(#g)  "]) {
    assert.equal(safeSvgUrlRef(ok), ok.trim(), ok);
  }
  for (const bad of [
    "url(https://evil.example#g)",
    "url('https://evil.example#g')",
    "url(data:image/svg+xml,%3Csvg%3E)",
    "url(javascript:alert(1))",
    "#g",
    "red",
    "",
  ]) {
    assert.equal(safeSvgUrlRef(bad), "", bad);
  }
});

test("the allow-lists never contain an executable or event-bearing name", () => {
  for (const tag of ["script", "foreignObject", "iframe", "object", "embed", "animate", "set", "handler"]) {
    assert.equal(SVG_ALLOWED_TAGS.has(tag), false, tag);
    assert.equal(SVG_ALLOWED_TAGS.has(tag.toLowerCase()), false, tag);
  }
  for (const attr of SVG_ALLOWED_ATTRS) {
    assert.ok(!/^on/i.test(attr), `event attribute ${attr} must not be allowed`);
  }
});

test("<style> cannot smuggle script or remote fetches", () => {
  const payload =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://evil.example/x.css");' +
    'rect{fill:url("https://evil.example/p.svg#a")}</style><rect width="4" height="4"/></svg>';
  const clean = scrubSvgMarkup(payload);
  assert.equal(clean.includes("evil.example"), false, clean);
  assert.ok(clean.includes("<rect"), "the drawing itself remains");
});

test("foreignObject and HTML inside it are removed as a whole subtree", () => {
  const payload =
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="100" height="100">' +
    '<body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/><script>alert(2)</script></body>' +
    '</foreignObject><circle cx="5" cy="5" r="2"/></svg>';
  const clean = scrubSvgMarkup(payload);
  assert.equal(/foreignobject|<img|<script|onerror|alert/i.test(clean), false, clean);
  assert.ok(clean.includes("<circle"));
  assert.ok(svgDangerFindings(payload).length > 0, "flagged as hostile, not merely unlisted");
});

test("event handlers survive neither case tricks nor odd whitespace", () => {
  for (const payload of [
    '<svg><rect ONLOAD="alert(1)" width="1" height="1"/></svg>',
    '<svg><rect onLoad = "alert(1)" width="1" height="1"/></svg>',
    "<svg><rect\nonload\n=\n'alert(1)' width='1' height='1'/></svg>",
    "<svg><rect onload=alert(1) width='1' height='1'/></svg>",
  ]) {
    const clean = scrubSvgMarkup(payload);
    assert.equal(/onload|alert/i.test(clean), false, `${payload} → ${clean}`);
    assert.ok(svgDangerFindings(payload).length > 0, payload);
  }
});

test("a javascript: URI hidden behind whitespace, tabs or entities is still refused", () => {
  for (const payload of [
    '<svg><a href=" javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><a href="java\tscript:alert(1)"><text>x</text></a></svg>',
    '<svg><a href="java&#x0A;script:alert(1)"><text>x</text></a></svg>',
    '<svg><a href="&#106;avascript:alert(1)"><text>x</text></a></svg>',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  ]) {
    const clean = scrubSvgMarkup(payload);
    assert.equal(/javascript|alert/i.test(clean), false, `${payload} → ${clean}`);
  }
});

test("scrubbing is idempotent and the output always fits inside <svg>…</svg>", () => {
  const hostile =
    '<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" onload="x()">' +
    '<script>1</script><g><path d="M0 0h1" fill="url(https://e.x#g)"/></g></svg><script>2</script>';
  const once = scrubSvgMarkup(hostile);
  const twice = scrubSvgMarkup(once);
  assert.equal(twice, once, "a second pass changes nothing");
  assert.ok(once.startsWith("<svg"), once);
  assert.ok(once.endsWith("</svg>"), once);
  assert.equal(svgDangerFindings(once).length, 0, "clean output has no findings");
});

test("safeLibrarySvg keeps the intrinsic box but applies the same security rules", () => {
  const payload =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" onload="x()">' +
    '<rect width="64" height="32" fill="#000"/><script>x()</script></svg>';
  const lib = safeLibrarySvg(payload);
  assert.ok(lib.includes('width="64"') && lib.includes('height="32"'), "box kept for measuring");
  assert.equal(/onload|script/i.test(lib), false, lib);
  // The canvas variant drops the box — the element's own frame drives size.
  const canvas = scrubSvgMarkup(payload);
  const root = canvas.slice(0, canvas.indexOf(">") + 1);
  assert.equal(/\swidth=|\sheight=/.test(root), false, root);
  assert.ok(canvas.includes('<rect width="64" height="32"'), "child geometry untouched");
});

test("a pathological input (huge, no root, binary noise) returns quickly and safely", () => {
  const big = "<svg>" + '<rect width="1" height="1"/>'.repeat(20000) + "</svg>";
  const t0 = performance.now();
  const clean = scrubSvgMarkup(big);
  const ms = performance.now() - t0;
  assert.ok(clean.length > 0);
  assert.ok(ms < 2000, `20k-element scrub took ${ms.toFixed(0)}ms`);

  assert.equal(scrubSvgMarkup("\u0000\u0001<svg\u0000>"), "");
  assert.equal(scrubSvgMarkup("<svg"), "");
  assert.equal(scrubSvgMarkup(null), "");
  assert.equal(scrubSvgMarkup(42), "");
  assert.deepEqual(svgDangerFindings(undefined), []);
});
