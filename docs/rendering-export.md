# WYSIWYG export contract

## Single browser renderer

`ElementNode` paints both the interactive artboard and the hidden export pages.
`render-snapshot.ts` snapshots the latter with computed CSS and embedded images
and web/uploaded fonts. Preview, PNG/JPEG/PDF, standalone HTML, web SVG and the
**default Office fidelity mode** all consume this snapshot.

- `render-units.ts`: 96 CSS DPI; 1 inch = 25.4mm = 96px = 914400 EMU.
  Raster scale changes sampling only, never the physical page or layout.
- Exact fractional page dimensions and SVG viewBox; no `offsetWidth` rounding.
- Preserve fractional computed font sizes. The cloning library normally floors
  font sizes; the snapshot adapter explicitly restores the original metrics.
- Wait for fonts and image decoding; fail on unavailable image bytes rather than
  silently dropping a picture. Uploaded fonts use their recorded data URLs,
  not the nonexistent `FontFace.source` property.
- Clip definitions have instance-unique IDs. Masks resolve against the owning
  page/group, not whichever page happens to be active. Nested text inherits the
  correct page-number context. Authoring mask outlines are not artwork.

## Office modes

**Fidelity (default):** transparent lossless PNG layers at the selected output
resolution. Each top-level object is an independent, named Office picture;
explicit groups stay atomic to preserve group-opacity compositing. The page
background is its own layer. Text is shaped by the browser and rasterized, so
Office cannot substitute a font or reflow Arabic. This is **not** text-to-vector
outlining or embedded editable Office typography. Characters/table cells cannot
be edited in this mode; the layer can still be selected, moved or resized.
Rotated artwork and shadows are trimmed only by their actual alpha bounds and
page edges, not by the original unrotated element rectangle.

**Native editing (opt-in):** existing editable text, tables and vector shapes.
Office and browser font/layout engines differ; this mode does not promise pixel
identity. The dialog labels its preview as a design reference, not a rendering
of Word/PowerPoint. Keep the `.nsq` source for full design editing.

Word picture transformations take CSS pixels; drawing offsets take EMU, while
page size takes twips. Never interchange those three units. Fidelity pictures
share one minimal anchor paragraph per page to avoid generating overflow pages;
drawing IDs and stacking heights increase monotonically.

PowerPoint has a single presentation-wide slide size. Mixed-size selection is
rejected with an actionable message; it must not silently scale earlier slides.
Word/HTML support distinct page sizes.

## Web

HTML contains fixed-size relative page containers and the exact
absolute-positioned artboard DOM with inline computed CSS. Font/image data is
embedded for offline use. SVG uses the same DOM inside `foreignObject` with an
explicit pixel viewBox. It is a **web SVG**, not a universal paths-only SVG for
Office/vector-editing applications. Multiple SVG pages download as a ZIP.
System fonts without accessible font bytes still require an equivalent local
font on the viewing device; use uploaded/bundled webfonts for portable web text.
Embedded fonts remain subject to their own redistribution licenses.

## Regression checks

```sh
npm run typecheck
node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test \
  src/lib/editor/render-units.test.ts src/lib/editor/office-export.test.ts
# With the development server running and Playwright Chromium installed:
node scripts/test-render-browser.mjs
# Optional uploaded-font case:
TEST_FONT_FILE=/path/to/licensed-font.ttf node scripts/test-render-browser.mjs
# Optional strict readers (python-docx, python-pptx, Pillow):
python scripts/verify-render-office.py
```

The browser regression covers a non-active page, page-number macros, custom
font embedding, cover/contain and off-centre crops, a circular mask, rotated and
mirrored groups, transparency, shadows, negative positions, hidden layers,
offline HTML, an artboard screenshot comparison and reconstruction of the
Office layers. Artifacts are written only under ignored `.cache/render-test`.
Actual Microsoft Office rendering and Safari/Firefox remain manual compatibility
checks; parser success alone is not a pixel-level Office rendering test.
