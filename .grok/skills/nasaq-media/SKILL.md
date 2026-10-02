---
name: nasaq-media
description: >
  Art direction for NASAQ templates, taken from a working Saudi media-department
  system: white paper, deep green, gold, geometric covers, replaceable
  photography, arched frames, KPI cards, green tables, and a green footer with
  a gold page-number circle. Open this before creating, redesigning, reviewing,
  or refining any NASAQ template, page, pack, family, or product master.
  Arabic-first. Not a request to generate another template collection.
  Triggers on template, قالب, تصميم, redesign, art direction, page layout,
  report design, غلاف, تقرير, media, إعلام.
metadata:
  short-description: "NASAQ media system for templates"
user-invocable: false
---

# NASAQ media system

This skill is the art-direction source of truth for NASAQ templates. It replaces
the earlier editorial brief (binding spines, Amiri body, abstract plates, a ban
on cards). `src/lib/editor/design-skill.ts` only binds the generators to this
file.

The system comes from finished Arabic media documents: workshop covers, field
reports, visit files, tournament books, and indicator pages. It is a modern
institutional media system, not an old ministerial report and not a magazine.

## When this applies

Open this skill before designing or redesigning a template, page, pack, family,
or product master. Then edit only:

- `src/lib/editor/templates.ts`
- `src/lib/editor/template-families.ts`
- `src/lib/editor/template-layouts.ts`
- `src/lib/editor/product-templates.ts`

Do not add a parallel catalog, a second pack list, or a replacement set.

## What NASAQ is

NASAQ is not a generic document builder, Canva clone, dashboard builder, or
AI template generator.

NASAQ is a premium Arabic-first RTL platform for Saudi public-sector and
corporate media: reports, covers, field files, indicator pages, letters, and
presentations. The page should look like a communications department made it
for print, not like a UI kit.

## Palette

One document palette, used with discipline:

- white paper
- deep green `#0c3d2c` for fields, heavy titles, table headers, and the footer
- a lighter green `#1f6b45` for the key line when the field is white
- gold `#c6a05a` for the second line, names, diamonds, the frame thread, and
  the page number
- ink `#172033` for body
- gray `#6b7280` for English or Latin metadata under the Arabic name, never as
  the title

Gold is not used for long paragraphs. Do not invent a second accent. App chrome
in `src/lib/brand.ts` is the product UI, not a reason to repaint a document
that already has this palette. A non-official theme may keep its own primary,
but the official catalog speaks white, deep green, and gold.

## Ornament

Ornament is linear geometry: a white curve, a gold thread, a pale triangle in
the corner, a small gold diamond, and a green–gold geometric band on ceremonial
pages. Not blobs, not a book spine, not a random gradient, not a badge wall.

## Type

Arabic-first. Design the RTL page on purpose.

Do not take an English template and simply mirror it.

Roles, with fixed relationships in `template-layouts.ts`:

- Display — Tajawal, heavy, the headline
- H1, H2, H3 — Tajawal
- Body — Noto Naskh Arabic for prose only
- Caption and Metadata — IBM Plex Sans Arabic
- Page Number — inside the gold circle, not floating in the margin

Headlines are heavy geometric Arabic. Amiri is allowed on one ceremonial line
only (a greeting or a bismillah interstitial), never as body text and never as
the cover title. Noto Kufi Arabic is not the default display face.

English, when it exists, is small gray metadata under the Arabic name.

## Report rhythm

A long document moves in this order when the content needs it:

1. Cover
2. A quiet ceremonial line, if the document is a formal file — one line, not a
   decorated page of scripture pasted into every template
3. Leadership or identity page, with a replaceable image slot
4. Content: letter, goals, KPIs, or photos
5. Green footer, page number inside a gold circle

Do not repeat one composition for every page.

## Five compositions

Use these. Do not collapse them into one template, and do not invent a sixth
look (spine, academic rectangle, dashboard).

### 1. White geometric cover

The official cover. White field. A small replaceable logo slot and a gold
diamond at the top — never a copied official emblem. Heavy green title. Short
gold thread. A green block on the lower page with a gold thread along its top
edge. A photo may sit on the boundary between white and green. This is a cover,
not a magazine cover.

### 2. Green cover

For occasions and field files. Green field. A white line, then a lighter-green
line. A full-width photo or a geometric band. A geometric band at the bottom.
Title in white, second line in gold or lighter green.

### 3. Leadership page

A replaceable photo in a gold arch (`arch` / `arch-frame`), or a cutout sitting
on a green wave, or a cutout on green with a thin gold rule. The name sits
under the photo in gold or green. Not an academic rectangle. Do not bake a real
official portrait into the template. The image slot is empty of identity until
the author replaces it.

### 4. Data page

This is the data language. A 2×2 or 2×3 of white cards: dark-green icon tile,
huge number (western digits are correct here), a small gold diamond, then a
short label. A green summary bar underneath. A table with a green header, green
number circles, and a gold emphasis on the closing row. A small ratio may sit
beside the table. Cards here are information, not decoration.

Do not scatter rounded cards, pills, shadows, or dashboard chrome across prose,
letters, or covers. A text page stays a text page.

### 5. Photo essay and letter

Two stacked photos at the content width, a thin frame, and a green caption bar
on the photo. Or a curved photo mask on one side and text on the other, numbered
01 02 03 with small icon circles. A letter puts the portrait on the visual
left, the large greeting in the text column, and one column of body.

## Poster and story

A green field, one huge word, a pattern or a full photo, then a vertical
sequence of photo, portrait slot, and number capsules. Use this for greetings
and celebration covers, not for every report page.

## Images

Every photo is a real image element the author can replace. Plates in
`template-layouts.ts` are photographic stand-ins (a hall, a field, a meeting
table, a night exterior), not architectural diagrams and not labelled
placeholders. Crop and frame stay when the source changes.

## Protected marks

Do not draw, trace, or embed:

- police, MOI, or public-security badges
- the national flag
- an official National Day lockup
- a real person's official portrait

Educational templates stay professional and modern. They are not childish.
Their description must keep the sentence that they carry no protected logos and
make no claim of government accreditation.

## Families

Each family keeps its job, and all of them speak this system:

- Government / Institutional — white geometric cover, green block
- Corporate — white cover, photo band, green lower block
- Executive — one decision, one number, gold diamond
- Annual Report / Performance — KPI cards and a green summary bar
- Leadership — gold arch, name in gold
- Modern Editorial — photo and caption bar, geometric headline
- Minimal — one text column, green footer
- Premium — green field, gold thread, no charcoal magazine
- Financial — green-header table, gold closing emphasis
- Media & Communications — stacked photos or a curved photo plus numbers
- Project Report — numbered circles on one path
- Educational — school letter, no protected mark

## Grid

16mm margin, 178mm measure, 12 columns, 4mm gutter. `cell(0, 12)` is the full
measure. Pair x with w. Arabic pages do not grow a binding spine. The footer is
a full-width green bar; the page number sits in a gold circle toward the outer
(left) edge.

## Editor constraint

Use real editable elements: text, images, shapes, groups, tables, charts,
headers, footers, page numbers.

Do not flatten a professional template into an image.

## Quality

QUALITY OVER QUANTITY.

The bar is: would a professional Saudi government communications team publish
this page as their own file? If it looks like a book from another decade, a
Canva frame, or a dashboard, redesign the composition.

## Visual review

Render the page. Check the green block, the gold thread, the arch, the KPI
cards, the caption bar, and the footer circle. Fix collisions before calling
the template done. Do not add decoration to hide a weak page.

## Most important rule

Preserve the existing template ids and the existing catalog. Change the art.
Five genuinely excellent pages are worth more than thirty mediocre pages.
