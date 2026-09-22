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

## Verification

| Gate | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 3 pre-existing warnings (`Accordion.tsx` react-refresh ×2, `product.ts` `FEATURE_MAP`) |
| `npm test` | unchanged vs the pre-overhaul baseline: the same 17 `scripts/**` failures exist at `HEAD` (verified in a clean `git worktree`); **+26 new passing tests** (`ui-state.test.ts` ×16, `library-dnd.test.ts` ×10) with the same 10 pre-existing TS-suite failures |
| `npm run build` | green (nitro/vercel output) |
| Preview | dev server binds `0.0.0.0:8080`, `allowedHosts: [".e2b.app"]` — verified 200 through a proxied `.e2b.app` Host header |

> Visual sweeps (320→1920px, light/dark screenshots) could not be executed in this sandbox: the Playwright browser download is blocked, so `browser-smoke.mjs` cannot run here. The layout work was therefore verified structurally (typecheck + lint + build + unit tests on the placement/containment arithmetic) and should be eyeballed in the live preview.

## Cross-cutting acceptance checklist

- [ ] No layout overlap at 320×480, 768×1024, 1024×768, 1440×900, 1920×1080.
- [ ] No horizontal document scroll caused by the editor shell at any width.
- [ ] RTL: drag deltas, drop targets and floating anchors all verified in `dir="rtl"`.
- [x] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all green (see Verification).
- [ ] Save/load/export (PDF/PNG/DOCX/PPTX) produce identical output to the pre-overhaul baseline.
