---
name: nasaq-design
description: >
  Permanent art direction for NASAQ templates and documents. Open this before
  creating, redesigning, reviewing, or refining any NASAQ template, page, pack,
  family, product master, cover, report, presentation, or document layout.
  Arabic-first institutional editorial design for Saudi public-sector and
  corporate work. Not a request to generate another template collection.
  Triggers on template, قالب, تصميم, redesign, art direction, page layout,
  report design, غلاف, تقرير, annual report, make it professional, improve
  this page, document design.
metadata:
  short-description: "NASAQ art direction for templates and documents"
user-invocable: false
---

# NASAQ design

This skill is NASAQ's persistent design intelligence. It governs how templates
are created, redesigned, reviewed, and refined. It is not a template
collection, and opening it is not permission to generate one.

The prose here is the source of truth. `src/lib/editor/design-skill.ts` only
binds the existing generators to this file.

## When this applies

Open this skill before any of the following:

- designing a template, page, pack, family, or product master
- redesigning or "improving" an existing template
- "make it professional", "make it premium", "clean it up"
- adding pages to a document or a template family
- reviewing a page for visual quality

Then edit only the existing generators:

- `src/lib/editor/templates.ts` — packs and page templates
- `src/lib/editor/template-families.ts` — family pages
- `src/lib/editor/template-layouts.ts` — shared grid, type roles, image plates
- `src/lib/editor/product-templates.ts` — product masters

Do not add a parallel catalog, a second pack list, or a replacement set.

## What NASAQ is

NASAQ is not a generic document builder, Canva clone, dashboard builder, or
AI template generator.

NASAQ is a premium Arabic-first RTL institutional design platform for:

- Saudi government and public-sector work
- corporate institutions
- executive communication
- annual reports and official reports
- media and communications departments
- leadership presentations
- professional documents
- premium commercial templates

The visual language must feel premium, institutional, editorial, precise,
modern, calm, confident, and professional. It must feel designed by a senior
art director, not assembled from generic UI components.

## Core principle

Design decisions must be intentional.

Never add an element because the page looks empty. Never remove an element
because minimalism is fashionable. Every object earns its place:

- hierarchy
- navigation
- information
- emphasis
- balance
- rhythm
- branding
- visual storytelling

Whitespace, density, typography, images, and color are each intentional.

## Preferred direction

- premium Saudi institutional / editorial
- sophisticated rather than decorative
- clean but not empty
- minimal but not simplistic
- modern but not trendy
- formal without looking old-fashioned
- visual without becoming noisy
- strong hierarchy without oversized UI
- generous whitespace with meaningful content
- disciplined grids
- excellent Arabic typography
- strong page composition
- restrained color systems
- high-quality imagery
- subtle details
- consistent spacing
- strong alignment
- professional proportions

The design communicates authority and quality without shouting.

## Absolutely avoid

Do not fall into generic AI-template patterns. Avoid excessive:

- rounded cards
- shadows
- pills
- badges
- gradients
- decorative circles
- random blobs
- unnecessary icons
- meaningless lines
- floating shapes
- UI-like cards
- dashboard layouts
- centered-everything compositions
- repeated 2-column layouts
- identical image placeholders
- oversized headings on every page
- excessive accent colors
- excessive borders
- fake sophistication
- visual noise

Do not make every page look like a web dashboard. Do not make every page look
like Canva. Do not make every page look like the same component rearranged.
Do not use decoration to compensate for weak composition.

## Editorial intelligence

Think like a senior editorial designer. Before designing a page, answer:

1. What is this page communicating?
2. What is the primary visual focus?
3. What should the eye see first?
4. What should the eye see second?
5. What information should be grouped?
6. What should remain quiet?
7. Where should whitespace exist?
8. Where should visual tension exist?
9. How does this page relate to the previous and next page?
10. Does the composition feel intentional?

Use editorial grids, asymmetric compositions, visual anchors, controlled
scale, negative space, strong alignment, image hierarchy, typography
hierarchy, page rhythm, section transitions, and visual pacing. Never apply
these techniques mechanically.

## Arabic / RTL first

NASAQ is Arabic-first. Arabic typography is not an afterthought. Design the
RTL composition on purpose. Attend to:

- Arabic font quality
- line length
- line-height
- text density
- heading proportions
- paragraph width
- RTL alignment
- Arabic and Latin coexistence
- numeral treatment
- metadata
- page numbering
- the visual balance Arabic text actually creates

Do not take an English template and simply mirror it.

The current typefaces in `template-layouts.ts` are the system, not a
suggestion to replace casually:

- Tajawal — display
- Noto Naskh Arabic — prose
- IBM Plex Sans Arabic — metadata
- Amiri — ceremonial pages

A family may justify a different face. It may not invent a random one to look
"designed".

## Typography system

Every template has a real type system. Roles:

- Display
- H1
- H2
- H3
- Body
- Caption
- Metadata
- Page Number

Define the relationships. Do not pick arbitrary font sizes. Do not oversized
a heading to make a page look impressive. Hierarchy comes from scale, weight,
spacing, width, placement, and contrast.

## Grid

Every professional template uses one coherent grid. Control page margins,
columns, gutters, text width, image zones, alignment edges, and vertical
rhythm. Objects align to structural relationships, not to taste in isolation.

The shared measure in `template-layouts.ts` is the default: 16mm margin,
178mm column on A4, 4mm vertical rhythm. A family may declare a different
measure only when that whole family shares it. The viewer should feel the
structure even when the composition is asymmetric. Avoid random placement.

## Page rhythm

A document is a sequence, not a pile of isolated pages. Use distinct roles
where the content needs them:

- Cover
- Introduction
- Section opener
- Editorial text
- Image-led page
- Data page
- KPI page
- Chart
- Table
- Timeline
- Comparison
- Quote
- Highlight
- Conclusion
- Closing

Pace the sequence. A useful rhythm is quiet, then visual, then
information-dense, then spacious, then image-led, then data-heavy, then a
section opener. Do not repeat the same composition throughout the document.

## Images

Images are design elements, not placeholders. Decide crop, scale, placement,
and aspect ratio. Full-bleed, strips, splits, a large hero, and a supporting
picture are all legitimate when the page needs them. Do not put every image
in the same rounded rectangle. Do not use a generic placeholder when a
meaningful picture is available. Plates in `template-layouts.ts` stay
replaceable image elements; the author changes the source, the crop stays.

## Color

Color creates hierarchy and identity. Prefer a restrained palette.

NASAQ's institutional direction may use deep emerald, navy, muted gold,
white, and controlled neutrals. Do not force the same palette onto every
template. Each family can have its own color architecture and still look
professional.

App chrome follows `src/lib/brand.ts` (emerald `#006c35`, gold `#c9a86a`).
That contract is for the product UI, not a reason to repaint every document.

Avoid rainbow palettes, excessive gradients, neon accents, random colors, and
decorative color without a job.

## Families

Each family has its own art direction. Possible families:

- Government / Institutional
- Corporate
- Executive
- Annual Report
- Leadership
- Modern Editorial
- Minimal
- Premium
- Financial
- Media & Communications
- Project Report
- Performance Report
- Presentation
- Image-led
- Educational

Educational templates are professional and modern. They are not childish,
playful, or covered in school-themed decoration.

## Existing templates

When improving what already exists:

- Do not throw the template away.
- Do not create a new collection as a shortcut.
- Do not create a parallel replacement set.
- Use the existing template as the design source.
- Preserve its strongest identity and purpose.
- Then improve composition, hierarchy, grid, typography, spacing, imagery,
  color, page rhythm, information density, and consistency.
- If the architecture is weak, improve that architecture. Do not paper over
  it with decoration.

## Quality standard

"Looks clean", "looks modern", "looks organized", or "renders correctly" is
not the bar.

The bar is: would a professional Saudi government communications team, a
corporate communications department, an executive office, a report designer,
or a professional designer consider this genuinely usable?

It must look like a finished commercial product. It must not look like a
coding demo, an AI experiment, a generic SaaS template, a Canva clone, a
dashboard, or a collection of UI cards.

## Visual review loop

Do not accept the first result.

1. Render the actual page.
2. Inspect the visual result.
3. Identify the weakest visual area.
4. Fix composition rather than adding decoration.
5. Check alignment.
6. Check typography.
7. Check whitespace.
8. Check image hierarchy.
9. Check color balance.
10. Check consistency with the template family.
11. Check the relationship with surrounding pages.
12. Render again if necessary.

If the result looks simple, generic, empty, repetitive, or AI-generated,
redesign it.

## Editor constraint

Designs must work in the NASAQ editor. Use real editable elements:

- text
- images
- shapes
- groups
- tables
- charts
- headers
- footers
- page numbers

Do not flatten a professional template into an image. Do not design a concept
that cannot be edited inside NASAQ.

## How to behave

When asked to design a template, do not start by placing components. First
decide purpose, audience, content type, visual identity, page sequence,
hierarchy, grid, typography, and imagery. Then design.

When asked to improve, do not merely change colors. Find the actual weakness
and fix the composition.

When asked to make it professional, that means art direction, typography,
grid, composition, rhythm, visual hierarchy, and detail. It does not mean
more colors, more cards, or more decoration.

When asked for more pages, do not duplicate the same layout. Design new
compositions that belong to the same visual system.

## Most important rule

QUALITY OVER QUANTITY.

Five genuinely excellent pages are worth more than thirty mediocre pages.
Never compensate for weak design by generating more templates. Never call a
template complete because it technically works. The visual result is the
acceptance criterion.
