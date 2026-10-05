/**
 * SVG allow-list scrubber — the DOM-free half of the editor's SVG sanitising.
 *
 * This is the guard behind three real boundaries: a library icon painted with
 * `dangerouslySetInnerHTML`, a synced account catalog stored on the server, and
 * an SVG template an administrator uploads for public rendering. Every case
 * below is a construct that reached one of those boundaries before the
 * allow-list was applied to it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectSvgMarkup,
  safeLibrarySvg,
  scrubSvgMarkup,
  svgDangerFindings,
} from "./svg-scrub.ts";

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
  '<path d="M2 2h20v20H2z" fill="#101820" stroke="#c9a86a" stroke-width="1.5"/></svg>';

test("a real drawing survives untouched", () => {
  const report = inspectSvgMarkup(ICON);
  assert.match(report.markup, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(report.markup, /<path d="M2 2h20v20H2z"/);
  assert.deepEqual(report.removedTags, []);
  assert.deepEqual(report.dangerous, []);
});

test("root width/height: dropped by default, kept for library thumbnails", () => {
  assert.equal(scrubSvgMarkup(ICON).includes('width="24"'), false);
  assert.equal(safeLibrarySvg(ICON).includes('width="24"'), true);
  assert.equal(safeLibrarySvg(ICON).includes('height="24"'), true);
  // Keeping the box is a layout choice, never a security finding.
  assert.deepEqual(svgDangerFindings(ICON), []);
});

test("event handlers are removed in every syntactic position", () => {
  for (const payload of [
    '<svg onload="alert(1)"><rect width="4" height="4"/></svg>',
    "<svg/onload=alert(1)><rect width=\"4\" height=\"4\"/></svg>",
    "<svg\n\tonload\t=\talert(1)><rect width=\"4\" height=\"4\"/></svg>",
    '<svg><rect width="4" height="4" onmouseover="alert(1)"/></svg>',
    '<svg><text x="1" y="1" ONCLICK="alert(1)">hi</text></svg>',
  ]) {
    const clean = scrubSvgMarkup(payload);
    assert.equal(/on\w+\s*=/i.test(clean), false, clean);
    assert.ok(svgDangerFindings(payload).some((f) => f.startsWith("handler:")), payload);
  }
});

test("executable and remote-content elements lose their whole subtree", () => {
  const script = scrubSvgMarkup(
    '<svg><script>alert(document.cookie)</script><rect width="4" height="4"/></svg>',
  );
  assert.equal(script.includes("script"), false);
  assert.equal(script.includes("alert"), false);
  assert.ok(script.includes("<rect"));

  const foreign = scrubSvgMarkup(
    '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">' +
      '<img src=x onerror=alert(1)></body></foreignObject><rect width="4" height="4"/></svg>',
  );
  assert.equal(foreign.includes("onerror"), false);
  assert.ok(foreign.includes("<rect"));

  for (const [tag, payload] of [
    ["style", '<svg><style>@import url(https://evil.example)</style></svg>'],
    ["iframe", '<svg><iframe src="https://evil.example"></iframe></svg>'],
    ["embed", '<svg><embed src="https://evil.example"/></svg>'],
    ["object", '<svg><object data="https://evil.example"></object></svg>'],
    ["animate", '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>'],
  ] as Array<[string, string]>) {
    const clean = scrubSvgMarkup(payload);
    assert.equal(clean.toLowerCase().includes(`<${tag}`), false, tag);
  }
});

test("references must stay inside the document", () => {
  const clean = scrubSvgMarkup(
    '<svg><use href="https://evil.example/x.svg#a"/><use href="#local"/>' +
      '<rect fill="url(#g)" stroke="url(https://evil.example#g)" width="4" height="4"/></svg>',
  );
  assert.equal(clean.includes("evil.example"), false);
  assert.ok(clean.includes('href="#local"'));
  assert.ok(clean.includes('fill="url(#g)"'));
  assert.ok(svgDangerFindings('<svg><use href="https://evil.example/x.svg#a"/></svg>')
    .some((f) => f.startsWith("href:")));
  assert.ok(svgDangerFindings('<svg><rect fill="url(https://evil.example#g)"/></svg>')
    .some((f) => f.startsWith("urlref:")));
});

test("script URIs are refused wherever they appear in tag markup", () => {
  for (const payload of [
    '<svg><a href="javascript:alert(1)"><text x="1" y="1">x</text></a></svg>',
    '<svg><a href="JaVaScRiPt:alert(1)"><text x="1" y="1">x</text></a></svg>',
    '<svg><a href="data:text/html;base64,PHNjcmlwdD4="><text x="1" y="1">x</text></a></svg>',
  ]) {
    assert.ok(svgDangerFindings(payload).length > 0, payload);
    assert.equal(scrubSvgMarkup(payload).includes(":"), false);
  }
});

test("SVG that is merely unstyled is NOT treated as hostile", () => {
  /*
   * A Figma/Illustrator export carries attributes this editor does not render.
   * Refusing those would break real template imports — they are stripped, not
   * reported as dangerous.
   */
  const export_ =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
    'data-name="Layer 1" enable-background="new 0 0 24 24" version="1.1">' +
    '<image xlink:href="embed.png" width="4" height="4"/></svg>';
  assert.deepEqual(svgDangerFindings(export_), []);
  const clean = scrubSvgMarkup(export_, { keepRootBox: true });
  assert.ok(clean.startsWith("<svg"));
  // Unlisted (but harmless) metadata attributes are dropped, not refused.
  assert.equal(clean.includes("data-name"), false);
  assert.equal(clean.includes("enable-background"), false);
  assert.equal(clean.includes("xmlns:xlink"), true);
});

test("prolog, doctype, comments and wrappers are dropped, root casing kept", () => {
  const wrapped =
    '<?xml version="1.0"?>\n<!DOCTYPE svg>\n<html><body>' +
    "<SVG xmlns='x'><rect width='4' height='4'/></SVG  >" +
    "<script>alert(1)</script></body></html>";
  const clean = scrubSvgMarkup(wrapped, { keepRootBox: true });
  assert.ok(clean.startsWith("<SVG"));
  assert.ok(clean.endsWith("</SVG>"));
  assert.equal(clean.includes("<?xml"), false);
  assert.equal(clean.includes("DOCTYPE"), false);
  assert.equal(clean.includes("script"), false);
  assert.equal(clean.includes("<html"), false);
  assert.equal(scrubSvgMarkup('<svg><!-- c --><rect width="4" height="4"/></svg>').includes("<!--"), false);
});

test("attribute values are re-escaped so a value cannot open a new tag", () => {
  const payload = '<svg><text x="1" y="1" class="a&quot; onload=&quot;alert(1)">hi</text></svg>';
  const clean = scrubSvgMarkup(payload);
  // The entity is escaped a second time, so a browser decodes the value back to
  // the literal text `a&quot; onload=&quot;alert(1)` inside ONE `class`
  // attribute — never a second attribute, never a handler.
  assert.ok(clean.includes("&amp;quot;"));
  assert.deepEqual(svgDangerFindings(payload), []);
  assert.deepEqual(inspectSvgMarkup(clean).removedAttrs, []);
  assert.deepEqual(inspectSvgMarkup(clean).dangerous, []);

  // A quote-breaking value: the whole payload stays inside `id`, escaped.
  const breakout = scrubSvgMarkup(
    '<svg><rect id=\'a"><script>alert(1)</script>\' width="4"/></svg>',
  );
  assert.ok(breakout.includes("&lt;script&gt;"));
  assert.equal(breakout.includes("<script"), false);
});

test("non-SVG input yields nothing rather than an error", () => {
  assert.equal(scrubSvgMarkup(""), "");
  assert.equal(scrubSvgMarkup("<html><body>لا يوجد رسم</body></html>"), "");
  assert.equal(scrubSvgMarkup(null), "");
  assert.equal(scrubSvgMarkup(undefined), "");
  assert.equal(scrubSvgMarkup(42), "");
});

test("nested svg roots are preserved and the outer close ends the scrub", () => {
  const clean = scrubSvgMarkup(
    '<svg viewBox="0 0 10 10"><svg viewBox="0 0 5 5"><rect width="2" height="2"/></svg>' +
      '<rect width="4" height="4"/></svg><p>trailing</p>',
  );
  assert.equal(clean.split("<svg").length - 1, 2);
  assert.equal(clean.includes("trailing"), false);
});
