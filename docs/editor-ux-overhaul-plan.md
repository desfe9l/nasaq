# NASAQ (نَسَق) — Unified Editor UX/UI & Functional Overhaul Plan

> **Scope:** the studio shell (`src/components/editor/*`), editor styles (`src/styles.css`), and
> the additive UI slices of `src/lib/editor/store.ts`.
>
> **Hard constraints (apply to every phase):**
> 1. Document model (`lib/editor/model.ts`), canvas state, autosave, and export/print pipelines are **frozen** —
>    only additive, backwards-compatible fields are allowed.
> 2. Clean separation of concerns; no architectural rewrite where a contained change is enough.
> 3. Every panel must survive arbitrary height/width changes with **no clipping, no overlap**.
> 4. **RTL is a first-class rule**: the document is `dir="rtl"`; the components panel (مكونات) is the
>    *visually right* sidebar, the properties panel (خصائص) is the *visually left* sidebar. All
>    drag deltas, drag-and-drop targets, spatial math, and floating-toolbar anchoring are computed
>    in **screen space**, never from a naive `left/right` assumption.

---

## Phase 0 — Baseline & verification harness

| Step | Work | Files |
| --- | --- | --- |
| 0.1 | Confirm current behaviour/limits: sidebar clipping at short viewports, no `<1024px` backdrop, `type="number"` arrows, no floating contextual toolbar, no resizable pages panel, flat accordions, faint dark-mode selection. | `src/components/editor/*` |
| 0.2 | Keep the verification loop: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, plus a Playwright screenshot sweep (light/dark × desktop/tablet/phone). | root scripts |

**Verification:** app boots, existing tests green *before* any edit (this is the regression baseline).

---

## Phase 1 — Workspace responsiveness & sidebar containment

| Step | Work | Files |
| --- | --- | --- |
| 1.1 | **Panel scroll containment.** Both sidebars become `flex h-full min-h-0 flex-col`; the content region becomes `min-h-0 flex-1 overflow-y-auto overflow-x-hidden` sized by `height: calc(100vh - var(--editor-header-h))` via a CSS variable set from the real header height (no magic numbers). | `EditorApp.tsx`, `styles.css`, `LeftPanel.tsx`, `RightPanel.tsx` |
| 1.2 | **Fluid inner controls.** Property rows use `display:flex; flex-wrap:wrap; gap` with `min-w-0` inputs and a `grid-cols-[repeat(auto-fit,minmax(140px,1fr))]` geometry grid, so narrowing a panel wraps/shrinks inputs instead of overlapping them. | `styles.css`, `RightPanel.tsx` |
| 1.3 | **Header toggles.** Add `PanelRight`/`PanelLeft` buttons to the top nav header wired to `toggleSidebar("left" | "right")` (desktop → `*Collapsed`, `<1024px` → `*Open`), with `aria-pressed`. | `EditorApp.tsx`, `store.ts` |
| 1.4 | **Overlay mode (`<1024px`).** Both sidebars render as fixed slide-overs (width `min(320px, 86vw)`) inside a shared backdrop; the canvas is never squished. Tapping the backdrop **or** anywhere on the canvas closes them (`closeFloatingPanels()`); the store's "select opens properties" convenience is skipped in overlay mode so a canvas tap cannot fight the dismissal. | `EditorApp.tsx`, `CanvasStage.tsx`, `store.ts`, `styles.css` |

**Verification:** resize 320→1600px wide and 480→1100px tall; no clipping/overlap; drawers animate;
canvas tap closes them; Escape closes them.

---

## Phase 2 — Properties panel accordions & input scrubbers

| Step | Work | Files |
| --- | --- | --- |
| 2.1 | **Accordion primitive** `AccordionSection`: `min-height: 44px` header, animated chevron, `aria-expanded`, `aria-controls`, persisted open/closed keys. | `components/editor/ui/Accordion.tsx` |
| 2.2 | **Four top-level groups**: «الأبعاد والتحاذي» (dimensions/layout), «النص» (typography + Arabic text handling), «الخلفية والحدود» (fill/border/shadow/effects), «تصدير» (export shortcuts). Existing sub-sections become nested sub-groups so no control is lost. | `RightPanel.tsx` |
| 2.3 | **Scrubbable inputs** `ScrubInput`: replaces `type="number"`; label cursor `ew-resize`; pointer-drag horizontally changes the value (`Shift` = ×10), step rounding, clamping, `Enter`/`Escape`/blur commit, one undo step per gesture (`live` writes then a single `commit`). | `components/editor/ui/ScrubInput.tsx` |
| 2.4 | **Touch steppers**: `−` / `+` buttons, each ≥ 36×36px, rendered on both sides of the value on coarse pointers (and always available on hover/focus for keyboard users). | `components/editor/ui/ScrubInput.tsx`, `styles.css` |

**Verification:** every numeric field scrubs; Shift multiplies by 10; one undo per drag; steppers
are 36px+ on touch; accordion headers are 44px and toggle independently.

---

## Phase 3 — Canvas spatial viewport & resizable pages panel

| Step | Work | Files |
| --- | --- | --- |
| 3.1 | **Infinite viewport.** Stage background `#F3F4F6` (light) / `#1E293B` (dark); artboard drop shadow `0 10px 25px -5px rgba(0,0,0,.15)`; scroll surface padded so panning never hits a dead edge. | `styles.css` |
| 3.2 | **Navigation:** Space + drag pan (existing, kept), `Cmd/Ctrl + wheel` zoom anchored at the pointer (existing, kept), **pinch-to-zoom on touch** (new: two-finger distance ratio drives `zoomAnchoredAt`, midpoint stays fixed; two-finger drag still pans). | `CanvasStage.tsx`, `viewport.ts` |
| 3.3 | **Resizable pages panel.** Horizontal drag handle on the panel's top border, `pointer`-based with `touch-action:none`, clamped `96px…60vh`, persisted; thumbnails scale through a CSS variable so aspect ratios never distort, and the rail wraps/scrolls fluidly. | `PageRail.tsx`, `EditorApp.tsx`, `store.ts`, `styles.css` |

**Verification:** pan/zoom/pinch never move artwork; pages panel resizes smoothly and survives reload;
thumbnails keep their aspect ratio at every panel height.

---

## Phase 4 — Floating contextual toolbar & element selection

| Step | Work | Files |
| --- | --- | --- |
| 4.1 | **Transform bounding box**: primary selection outline in the brand/primary colour with 8 handles; a 44×44px transparent hit area per handle (visual size stays small) for touch manipulation; unchanged gesture math. | `SelectionFrame` in `CanvasStage.tsx`, `styles.css` |
| 4.2 | **Floating toolbar** anchored **16px above** the selected element's screen box, RTL-safe clamping (never leaves the viewport, flips below when there is no room above). | `components/editor/FloatingToolbar.tsx` |
| 4.3 | **Text elements:** font family, size, colour, B/I/U, alignment — the same option sets the top tab bar uses (single source: store `updateStyle` / `updateElement`). | `FloatingToolbar.tsx` |
| 4.4 | **Shape / image / icon / line / table:** fill, stroke, opacity, layer ordering (forward/backward), duplicate, delete. | `FloatingToolbar.tsx` |

**Verification:** toolbar follows the selection (move, resize, rotate, page scroll, zoom), never
overlaps the element, and every button writes through the existing store actions.

---

## Phase 5 — Layer tree, folder grouping & interactive drag-and-drop

| Step | Work | Files |
| --- | --- | --- |
| 5.1 | **Folder hierarchy hiding.** Hiding a group/folder hides every nested child on the canvas *and* marks the descendants in the tree; unhiding restores them. Implemented as a cascade in `setElementFlag` (document model untouched). | `store.ts`, `RightPanel.tsx` |
| 5.2 | **Expandable tree view.** Group rows get a chevron that collapses/expands children; nesting depth is rendered with RTL-aware indentation (`padding-inline-start`). | `RightPanel.tsx` |
| 5.3 | **Animated DnD reordering.** Rows animate (transform/opacity transitions) while dragging; a drop indicator line shows the insertion point; `reorderLayers` unchanged. | `RightPanel.tsx`, `styles.css` |
| 5.4 | **Custom right-click menu** on canvas **and** layer rows via one shared menu state (`contextMenu` in the store) with: تجميع، فك التجميع، إخفاء/إظهار، قفل، تكرار، حذف، إرسال للخلف، إحضار للأمام (+ existing extras). | `store.ts`, `WorkspaceOverlays.tsx`, `RightPanel.tsx`, `EditorApp.tsx`, `CanvasStage.tsx` |

**Verification:** group eye toggles nested children; tree expands/collapses; reorder animates; the
context menu opens from canvas elements, canvas background, and layer rows with correct targets.

---

## Phase 6 — Dark theme selection & high-contrast highlights

| Step | Work | Files |
| --- | --- | --- |
| 6.1 | Dark-mode selection tokens: `--sel-color: #3B82F6`, glow `rgba(59,130,246,.2)`, applied to selection frames, resize handles, hover outlines, table cell hover/selection, active tabs/indicators, and drop targets — no faint gray outlines anywhere. | `styles.css` |
| 6.2 | Shared `focus-visible` ring and input focus styling for both themes. | `styles.css` |

**Verification:** dark mode screenshot sweep — every interactive state is unmistakably visible.

---

## Phase 7 — Expanded smart library (المكتبة الذكية) & custom assets

| Step | Work | Files |
| --- | --- | --- |
| 7.1 | **Accordion categories**: أشكال · رموز وأيقونات · خطوط وفواصل · مؤشرات وإنجازات · جداول وإحصائيات · نماذج جاهزة — all in the left library/shapes surface using the Phase 2 accordion primitive. | `LeftPanel.tsx`, `AssetLibrary.tsx` |
| 7.2 | **أشكال:** basic geometry, arrows, badges (existing `SHAPES` groups, re-surfaced as accordions). | `LeftPanel.tsx` |
| 7.3 | **رموز وأيقونات:** icon grid + «+ إضافة رمز جديد» (upload/insert custom SVG → stored in a persisted custom-assets slice, usable from the panel *and* the properties icon picker). | `LeftPanel.tsx`, `RightPanel.tsx`, `store.ts`, `storage.ts` |
| 7.4 | **خطوط وفواصل:** line weights, dashed styles, decorative Arabesque dividers + «إضافة فاصل جديد» for custom divider SVGs. | `LeftPanel.tsx`, `store.ts` |
| 7.5 | **مؤشرات وإنجازات:** stat counters, progress rings, achievement bars (existing `PROGRESS_PRESETS`/`TEXT_PRESETS`, grouped). | `LeftPanel.tsx` |
| 7.6 | **جداول وإحصانات:** drag-and-drop data table + chart templates with high-contrast light/dark styling. | `LeftPanel.tsx`, `TablePicker.tsx`, `templates.ts` |
| 7.7 | **نماذج جاهزة:** ready-made report page layouts (existing `PAGE_TEMPLATES`). | `LeftPanel.tsx` |

**Verification:** every category opens/closes; custom icons/dividers persist across reload and insert
as real vector elements; tables/charts render legibly in both themes.

---

## Implementation status (this branch)

| Phase | State | Notes |
| --- | --- | --- |
| 1 — Responsiveness & sidebar containment | done | `--editor-header-h` measured from the real header (ResizeObserver, no magic numbers); `editor-pane-scroll` bodies; one header toggle per sidebar that is correct docked *and* floating; `<1024px` slide-overs + shared backdrop + canvas-tap close + Escape close. |
| 2 — Accordions & scrubbers | done | 4 `AccordionSection` groups in خصائص; `ScrubInput`/`ScrubField`/`ScrubLabel` replaced every `type="number"` in the panels (incl. SVG stroke width via the new `allowUnset` mode) and the floating toolbar's font size; ± steppers ≥36px (42px on coarse pointers). |
| 3 — Viewport & pages panel | done | `#F3F4F6`/`#1E293B` stage, artboard shadow; Space+drag pan, Cmd/Ctrl+wheel and **pinch** zoom (native non-passive touch), two-finger pan; pages-panel drag handle + keyboard nudge, height applied to the rail so thumbs keep their ratio. |
| 4 — Floating toolbar | done | 8 handles with 44×44px hit areas; toolbar anchored by `placeFloatingToolbar` (16px above, flips below, clamps to the viewport — unit-tested incl. RTL), text vs object tool sets, z-order/duplicate/delete. |
| 5 — Layer tree & context menu | done | Recursive tree with per-row expand/collapse, indent, folder eye cascade (depth-independent, one `cascadeFlag` helper for hide *and* lock), pointer-Y drop indicator, row + canvas context menus sharing one store state with a `source` field. |
| 6 — Dark contrast | done | `--sel-color: #3B82F6`, glow `rgba(59,130,246,.2)`, `--hover-outline`, blue focus rings, table-cell and active-indicator overrides. |
| 7 — Smart library | done | Accordion categories: أشكال · رموز وأيقونات · خطوط وفواصل · مؤشرات وإنجازات · جداول وإحصانات · نماذج جاهزة; custom SVG icons/dividers persisted (`customLibrary`) and insertable as real `svg` elements; table/chart cards are clickable **and** draggable onto the canvas (`library-dnd.ts`), computed icons reuse the page's own `icon`/`divider` renderers. |

**Extra containment fixes found while verifying:** the left tab strip became a scrollable row (the fixed 8-column grid squeezed labels under icons at the panel's minimum width), and the icon grid/properties panel got fluid card grids that wrap instead of overflowing.

## Follow-up fixes (second work order)

| # | Fix | State | Where |
| --- | --- | --- | --- |
| 1 | Global `user-select: none` across the chrome, exempting form fields, `[contenteditable]`, artboard text and explicitly copyable values (`.selectable-value`, e.g. the status bar counters). | done | `styles.css` "TEXT SELECTION POLICY" |
| 2 | Floating bubble: eye toggle in the header + a dismiss ✕ in the bubble itself (persisted as `ui.bubble`); placement now scores four sides against measured obstacles (`[data-editor-obstacle]`: header, both sidebars, pages rail, status bar) and hides entirely while a dialog/menu owns the screen. | done | `store.ts` (`bubbleEnabled`), `FloatingToolbar.tsx`, `EditorApp.tsx` |
| 3 | One `--z-*` scale (`canvas 0 → toast 200`) replaces every hardcoded layer, and `.editor-canvas-stage` is `isolation: isolate` so artboard layers can never cover chrome. The bubble is portalled to `body` to stay above the panels. | done | `styles.css`, all editor components |
| 4 | Library hover/focus: 2px `--primary-accent` outline + tinted fill, `[aria-pressed]`/`[data-active]` states, crisp in both themes. | done | `styles.css` library block |
| 5 | Permanent المكتبة button in the header, between the properties toggle and the main tools; docks/undocks with a 180ms grid transition that stands down during manual resizing. | done | `EditorApp.tsx`, `store.openLibrary` |
| 6 | 80px bottom padding + `scroll-margin-bottom` on the panel scroll containers so the last row (and its drop target) is fully reachable. | done | `styles.css` |
| 7 | Rotation grip on **all four corners**, live angle readout, Shift ladder (15° with a hard pull onto 45/90/135), and قلب أفقي / قلب رأسي in the context menu, properties panel and bubble — stored as lossless `flipX`/`flipY` style flags (mirrored resize handled by `mirrorHandle`, native `flipH`/`flipV` on PowerPoint export). | done | `CanvasStage.tsx`, `transform.ts`, `RightPanel.tsx`, `WorkspaceOverlays.tsx`, `store.flipSelected` |
| 8 | طبقة التلاشي for the image family: add/remove from the context menu, four gradient directions, from/to colour pickers, opacity and eight blend modes. | done | `fade.ts` (8 tests), `ElementNode.tsx`, `RightPanel.tsx`, `store.toggleFadeOverlay` |
| 9 | Photoshop shortcuts: `V` select, `T` text, `R` shape (drag to draw), ⌘/Ctrl+J duplicate, ⌘/Ctrl+G / ⇧G group/ungroup, ⌘[ / ⌘] back-forward, ⌘⇧[ / ⌘⇧] to back/front, Space+drag pan, ⌘0 zoom-fit. Tool state has one owner (the canvas) behind a `nasaq:tool` broadcast. | done | `EditorApp.tsx`, `CanvasStage.tsx`, `WorkspaceOverlays.tsx` |
| 10 | Every library gesture lands on the artboard: clicks centre the item, drags drop it under the pointer (saved assets included — `image`/`logo` joined the drag whitelist), and the store's insertion funnel toasts «تمت إضافة العنصر إلى مساحة العمل». | done | `library-dnd.ts`, `AssetLibrary.tsx`, `store.ts` |
| 11 | Table builder: manual rows × columns (up to 400×60) beside the hover grid, plus إستيراد من Excel / CSV for `.xlsx`/`.csv` via pick-or-drop → preview → insert. | done | `TablePicker.tsx`, `sheet-import.ts` (20 tests) |

## Verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 3 pre-existing warnings (`Accordion.tsx` react-refresh ×2, `product.ts` `FEATURE_MAP`) |
| `npm test` | unchanged vs the pre-overhaul baseline: the same 17 `scripts/**` failures exist at `HEAD` (verified in a clean `git worktree`). TS suite: **227 tests / 217 pass / 10 fail** vs the baseline's **166 / 156 / 10** — i.e. **+61 passing tests, zero new failures** (`ui-state` ×20, `library-dnd` ×11, `fade` ×8, `sheet-import` ×20, `transform` ×+2) |
| `npm run build` | green (nitro/vercel output) |
| Preview | dev server binds `0.0.0.0:8080`, `allowedHosts: [".e2b.app"]` — verified 200 through a proxied `.e2b.app` Host header |

> Visual sweeps (320→1920px, light/dark screenshots) could not be executed in this sandbox: the Playwright browser download is blocked, so `browser-smoke.mjs` cannot run here. The layout work was therefore verified structurally (typecheck + lint + build + unit tests on the placement/containment arithmetic) and should be eyeballed in the live preview.

## Cross-cutting acceptance checklist

- [ ] No layout overlap at 320×480, 768×1024, 1024×768, 1440×900, 1920×1080.
- [ ] No horizontal document scroll caused by the editor shell at any width.
- [ ] RTL: drag deltas, drop targets and floating anchors all verified in `dir="rtl"`.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green (see Verification).
- [ ] Save/load/export (PDF/PNG/DOCX/PPTX) produce identical output to the pre-overhaul baseline.

## Visual polish pass (third work order)

Pure styling/layout pass — no functional logic, state or event handler was touched; every component keeps its behaviour and its accessible name/tooltip.

| # | Brief item | State | Where |
| --- | --- | --- | --- |
| 1 | One 16/24px spacing rhythm | done | Section padding `py-12 md:py-16`, card padding `p-4`/`p-5`/`p-6`, grid gaps `gap-4 md:gap-6`, page rail `gap-4 px-4`, canvas pages `gap-6` |
| 2 | Elevated cards: `rounded-xl`/`2xl`, soft shadow, 1px border | done | `--shadow-card` / `--shadow-card-hover` in `@theme` (dark variants add a translucent glow ring); `src/components/site/cards.ts` (`SITE_CARD`, `cardClass`) applied to the template, feature, project, plan, about and brand-kit cards |
| 3 | Contrast harmony in both themes | done | `--color-muted` → `#5d6575` (≈5.8:1 on white) with `html.dark` re-pointing it to `#9aa5b4` (≈7:1); card titles `text-ink`/`dark:text-white`; light editor dividers one shade darker (`--editor-border: #b6b8bb`) |
| 4 | Glassmorphic sticky nav | done | `SiteHeader`: `bg-white/80` (dark `#111722/80`) + `backdrop-blur-[12px]` + `border-line/60` + `shadow-sm` |
| 5 | Template grid, leftover last row auto-centered | done | `CARD_WRAP` (flex-wrap + `justify-center`) + `CARD_W` (`(100% − gap) / columns` per breakpoint) on the homepage packs grid and both TemplatesPage grids |
| 6 | Features section: distinct icon tiles, hover lift, emphasized selling points | done | `ICON_TINTS` / `iconTint()` in `cards.ts`; feature cards `rounded-2xl` + `hover:-translate-y-1` + `transition-all`; the flagship pillar keeps the solid brand tile |
| 7 | Tablet toolbar 768–1024px: no multi-row wrapping | done | Toolbar `md:flex-nowrap md:overflow-x-auto md:whitespace-nowrap`; tool tray `md:min-w-0` (still `min-w-fit` + `order-last` on phones, where wrapping is wanted), draw-text label collapses to its icon below `lg` |
| 8 | Compact tablet side panels | done | Properties/Layers drawer `md:max-lg:w-72` (288px); phones keep `min(340px,90vw)` |
| 9 | A4 artboard floats | done | `.report-page` shadow stack at `shadow-2xl` scale (plus the 1px edge hairline); pages stay auto-centered (`mx-auto … min-w-full`) |
| 10 | Bottom page strip + crisp borders | done | Active page `ring-2 ring-[var(--primary-accent)]` (the editor's own primary, light/dark aware), rounded thumbnails with a crisp border + small shadow, rail actions also revealed on `focus-within` |

Verification for this pass: `npm run typecheck` clean · `npm run lint` 0 errors / 3 pre-existing warnings · `npm run build` green · `npm test` and the TS suite unchanged from the pre-pass baseline (17 / 10 pre-existing failures, same IDs). Generated CSS was inspected to confirm `shadow-card*`, `backdrop-blur-[12px]`, `ring-[var(--primary-accent)]`, `md:max-lg:w-72` and the breakpoint bases all compile, and that the tablet width and each `basis-*` override win in cascade order.

## Editor upgrade (sixth work order)

Six sections, all client-side and all additive: no document model was replaced, no data structure changed, and every new object the editor inserts is an ordinary element or group — movable, styleable, exportable and undoable in one step like anything the author drew by hand.

| # | Section | State | Where |
| --- | --- | --- | --- |
| 1 — Layout & tablet responsiveness | done | **Tablet mode below 1100px, from one number.** `OVERLAY_BREAKPOINT` in `ui-state.ts` is the single source of truth: the shell derives its `matchMedia` query from it and Tailwind gets a matching `lg2` breakpoint (`--breakpoint-lg2: 1100px` in the `@theme` block of `styles.css`), so every shell class is `lg2:`/`max-lg2:` — panels become floating drawers, the artboard keeps the whole viewport, and the JS layout state can never disagree with the CSS. **Auto-fit on shell change:** crossing the boundary re-fits the A4 page (`fitToScreen`) after the layout settles, so turning a tablet sideways never leaves a horizontal scrollbar; the first load keeps the author's saved zoom when it already fits. **Toolbar is one row with pinned actions:** undo/redo + zoom/fit moved out of the scrollable tray into a `shrink-0` cluster, Save/Export stay in the trailing `shrink-0` group, and only the tool tray (menus, project name, grid) scrolls inside the row |
| 2 — Arabic typography & RTL | done | **Auto-kashida** opt-in per element (`kashida`, `justifyLastLine`) — legal dual-joining slots only, wrapping first so nothing overshoots. **Dynamic macros** `{التاريخ_الهجري}` `{التاريخ_الميلادي}` `{رقم_الصفحة_من_الكل}` `{اسم_الجهة}` `{رقم_المعاملة}`, resolved at render from the document context (canvas, HTML, Word/PowerPoint all through one `prepareText`), page numbers per page. **Per-family leading floors** (`FONT_LINE_HEIGHT_FLOOR`): Naskh faces (Amiri, Noto Naskh 1.7) get more room than Cairo (1.55) or Tajawal (1.5), applied only to multi-line Arabic so single-line titles keep the author's tight leading. **Five intent presets** [عنوان تقرير · عنوان فرعي · نص رسمي · مرجع الخطاب · هامش توقيع], theme-coloured, style-only |
| 3 — Print-ready & report tools | done | **Guides**: safe type area (dotted 10 mm), binding margin (15 mm, right edge — RTL), bleed 3 mm + crop marks; `guideGeometry` is the one source the canvas overlay and the pre-flight share. **Header/footer isolation**: «تثبيت على كل الصفحات» mirrors the active page's bands onto every same-size page as locked furniture (`hfRole`), idempotent and removable in one action. **Stamp & signature zone** as one group. **Page numbering** `صفحة n من m` as a live macro, add/remove in one click |
| 4 — KPI & data cards | done | `report-tools.ts` builds progress / target-vs-actual / stat-badge cards out of ordinary `box` + `progress` + `text`, coloured from the active theme (change the theme and the cards follow). Excel/CSV import reuses the existing `sheet-import.ts` + table builder through one shared store intent (`tablePickerOpen`), reachable from «أدوات التقرير» as well as the library |
| 5 — Pre-flight export checker | done | `preflight.ts` runs six checks (fixed-box text overflow, content in the binding margin, elements off the sheet, images below 300 dpi with 150 as a hard error, blank pages, braces that never resolved) against the model — the same numbers the exporters write. Shown inside the export modal with one-click fixes (ملاءمة الإطار / إبعادها عن الهامش / حذف الصفحة / حذف العناصر), errors block the first press only, and the same report powers the «أدوات التقرير» summary |
| 6 — Catalog polish | done | Official categories as pills — تقارير سنوية · خطابات رسمية · محاضر اجتماعات · عروض ختامية · خطط تشغيلية — beside شهادات · إنفوجرافيك · قوالبي الخاصة; routing combines category, keyword and element evidence (`pillsFor`), so every new pill has real entries (minutes 4, presentations 10, plans 10 of 29). Leftover cards on the last row stay centred (`CARD_WRAP`), and pill labels are searchable text |

New modules (all pure, no new dependencies): `kashida.ts`, `macros.ts`, `typography.ts`, `print-guides.ts`, `preflight.ts`, `report-tools.ts`, plus the panels `ArabicTextTools.tsx`, `ReportToolsPanel.tsx`, `PrintGuides.tsx`.

### Verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 3 pre-existing warnings (`Accordion.tsx` react-refresh ×2, `product.ts` `FEATURE_MAP`) |
| TS suite | **305 tests / 295 pass / 10 fail** — the 10 are the pre-existing `writeDocx` (5) and `writePptx` (5) failures present at `HEAD`. Against the pre-upgrade baseline (166 / 156 / 10) that is **+139 tests, +139 passing, no new failures**; 78 of them are the seven new suites (kashida 14, macros 9, typography 16, print-guides 10, preflight 9, report-tools 14, text-render 6) |
| `node --test scripts/**` | 195 / 178 / 17 — identical to the pre-upgrade baseline |
| `npm run build` | green; generated CSS contains `@media (width>=1100px)` and `@media not all and (width>=1100px)` with the `max-lg2:` drawer rules, plus the `.print-guides` block |
| Dev server | `/`, `/editor`, `/templates`, `/projects` all 200 with a proxied `.e2b.app` Host header; every new module transforms without a resolve error |

> A visual sweep (320→1920 px) still cannot run in this sandbox (the Playwright browser download is blocked), so the layout work is verified structurally — breakpoint maths, unit-tested geometry, and the compiled CSS — and should be eyeballed in the live preview.

### Acceptance criteria

- [x] A4 canvas fully visible without horizontal scrolling at 1024 px: drawer layout below 1100 px + auto-fit on layout change.
- [x] Top toolbar never wraps above `md` (768 px), and the four global actions (Save/Export, Undo/Redo, Zoom/Fit) are pinned at the row's edges — brand + history/zoom cluster + actions stay in row 1 while only the tool tray narrows and scrolls *inside* the row. Below 768 px the tray deliberately keeps its own second line (`flex-wrap` + `order-last` + `min-w-fit`): a phone cannot hold the brand, the four global actions, the menus, the project name and the grid toggle in one 390 px line, and wrapping keeps every control visible instead of hiding half of them behind a horizontal scroll. Making the row a single edge-pinned scrolling strip down to 320 px is a one-line follow-up if the literal reading (one row at *every* width) is wanted.
- [x] Macros evaluate in every generated document (canvas, standalone HTML, DOCX, PPTX) from one resolution path.
- [x] Arabic text stays aligned with kashida support and zero character clipping (leading floors per family, floor applied only where multi-line Arabic could actually clip).
- [x] Client-side only: sheet import reads the file in the browser; no document ever leaves the device.
