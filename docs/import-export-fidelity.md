# Import → edit → save → reopen → export: fidelity and limits

_Written 2026-10-12 against the tree including PR #204. Every claim below is
backed by an automated test; the test name is given so a reader can check it
instead of trusting this page. Nothing here is aspirational._

## The pipeline under test

```
foreign file → import (ONE dispatcher) → native NASAQ document → author edits
            → .nsq container → reopen → export (PNG/JPG/PDF/DOCX/PPTX/SVG/HTML)
```

The point of the round-trip suite (`src/lib/editor/import/round-trip.test.ts`,
`sources → native → edit → .nsq → reopen → export`) is the SEAM between
engines: each engine had its own tests, and the seam did not. It builds real
files (jszip-built OOXML, jsPDF-built PDF, real SVG), imports them, edits the
NATIVE model, writes a real `.nsq` container, reads it back, and then unzips the
Office export to inspect the XML. A flattened or discarded import cannot pass it.

## What each format becomes

| Source | Imported as | Explicitly reported (never silent) | Hard limit |
| --- | --- | --- | --- |
| **DOCX** | Native text elements, native tables, inlined images, headers noted | Mixed-run merging, unsupported drawings (surrounding text kept), bullets (imported as text), nested tables (flattened cells keep content), header placement approximation, empty body — `src/lib/editor/import/docx.ts` `builder.note(…)`, all surfaced through `run.ts` | Word fields/RTL-specific kerning heuristics are approximated, not reproduced verbatim |
| **PPTX** | One NASAQ page per slide, with native text/shapes/images in slide order | SmartArt/diagrams (skipped, **not** replaced by a slide screenshot), images without dimensions, shapes with no frame/fill, multi-size text, and the standing note that transitions/animations are not imported — `pptx.ts` | Slide masters/theme inheritance is flattened into the shapes actually used |
| **XLSX** | One page per worksheet, each a native editable table | Formula limits (values are carried, formulas are not re-evaluated), row/column truncation at the documented caps, hidden sheets noted — `sheet.ts`/`sheet-import.ts` | 400 rows × 60 columns per sheet; charts and pivot tables are not imported |
| **PDF** | Native text runs, vector paths for fills/strokes/lines, decoded images; page geometry kept in millimetres | Font colour not always recoverable, images that could not be decoded, complex/clipped/gradient/masked paint operations that could not be represented, and — when nothing extractable exists — an explicit `flattened` note saying the page was kept as its original image instead of being dropped (`pdf.ts`) | A corrupt or password-protected PDF is refused with a message that says so; **no page is ever silently dropped** |
| **SVG** | Native `svg` element whose markup is kept (vector), sized from the declared width/height | Text inside the artwork stays part of the artwork rather than becoming separate text elements (`raster.ts`) | Scripts/external references are stripped by the passive-SVG sanitiser (a security rule, not a fidelity one) |
| **PNG / JPG / SVG** (file import) | Native image element (SVG: native vector element), real dimensions | Original pixel size is reported for a raster; SVG text stays part of the artwork | Only these three raster/vector image types are accepted by the file-import dispatcher |
| **WebP / GIF / other image types** (drop or paste into a page) | Native image element via the image path (`images.ts`): decoded, resized around the long-edge/byte caps, transparency preserved as PNG | Resizing is reported through the element's own stored source; nothing is upscaled | SVG dropped as an image goes through the same passive sanitiser; animation is not preserved |
| **PSD/PSB** | Layer tree → native elements (vector shapes, text, images) via the PSD worker | Per-layer reasons when a layer is rasterised or dropped; a worker timeout falls back with a report rather than failing silently | 200 MB file cap; PSD text is rebuilt from layer text data, not from Photoshop's render |
| **`.nsq` (v2)** | The native document, verbatim | Format warnings (unknown element types, unsafe style values) are listed on read | 300 MB file / 600 MB uncompressed / 64 MB document / 5 000 entries / 50 000 elements / 500 pages |
| **Legacy JSON backup** | Normalised through the same validation as `.nsq` | Marked `legacy: true` so the UI can say so | Field-by-field, only the schema's own fields survive |

## Round-trip evidence (automated)

`src/lib/editor/import/round-trip.test.ts`:

- **DOCX** — text/table/image are native; no `about:blank` placeholder exists;
  an edit made to the native text survives `.nsq` save + reopen; the embedded
  picture is byte-identical after the container trip; the edit reaches Word as a
  real run and the table text survives into `word/document.xml`.
- **PPTX** — two slides become two pages in order, survive the container, and
  come back out as `ppt/slides/slide1.xml` and `slide2.xml` with real text.
- **XLSX** — one page per worksheet; cell values are editable text (not a
  picture); the formula/limit note is asserted to be **present**, so a future
  change cannot quietly drop the disclosure.
- **PDF** — page count and A4 geometry preserved; native elements produced;
  element count identical after the container trip.
- **SVG** — imported as a vector element with its markup intact, sized from its
  declaration, still vector after reopen, and exportable to Word.

Engine-level suites that back the same table: `nsq/nsq.test.ts` (container round
trip, "reopens with every editable property preserved", rejects tampered/newer
containers), `office-export.test.ts` (the DOCX/PPTX writers emit real runs,
tables and vector shapes), `import/import.test.ts` (classification, refusals and
the per-format conversions), `psd/psd.test.ts`.

## What the product deliberately refuses

- Legacy binary `.doc`, `.ppt`, `.xls` and CSV: refused with an Arabic
  explanation naming the supported alternative — an import that cannot preserve
  structure is worse than a clear "no" (`.docx`/`.pptx`/`.xlsx` are accepted,
  and the Office-open path repairs a package whose extension lies).
- Encrypted PDFs, and files above the documented size caps.
- Any attempt to execute content from an imported file: `.nsq` reads are
  data-only, SVGs go through the passive sanitiser, and no importer evaluates
  markup or scripts from the source document.

## Known fidelity gaps (documented, not hidden)

1. Word/PDF **font substitution** can shift line breaking when the original font
   is not installed; the importer uses the document's own declaration when it
   can and says so when it falls back.
2. PowerPoint **theme inheritance** is flattened: the slide looks right, but the
   deck's master relationships do not travel.
3. **Spreadsheet formulas** are not re-evaluated; the last stored value is what
   the table shows.
4. **PSD layer effects** (drop shadows, gradients, adjustment layers) are
   approximated by their nearest native equivalent and reported per layer.
5. **Animations, transitions and media** are never imported from Office files —
   the native model has no such concepts, and inventing decorative stand-ins
   would be worse than saying so.

Each gap above is surfaced in the import report the author sees, and the
round-trip suite keeps at least one assertion per family so a regression fails
CI instead of becoming a silent quality drop.
