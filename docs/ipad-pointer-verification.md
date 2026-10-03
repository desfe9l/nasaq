# iPad / pointer input verification

Date: 2026-09-26. Base: fetched `origin/main` at `3e931cddfca388c3839aab7c8dfb46411d3069ef`.
Work remains on `arena/01a0de37-nasaq`.

## Interaction contract

- `CanvasPointerSession` owns the workspace pointer lifecycle. Window move/up/cancel events are routed only to the owning pointer ID; blur, hidden documents, lost capture and unmount clean up ownership/timers.
- Priority: resize/rotate grip, selected artwork, other artwork, blank-workspace navigation/selection. Explicit desktop Space+drag remains available; it does not override grips.
- A touch element press is pending until movement reaches 6 screen pixels. A second finger can promote that pending press into canvas navigation. An acquired resize/rotate, established drag/draw, pen operation or long press cannot be stolen by another finger.
- Two-finger navigation uses one initial document-space anchor: changing distance zooms the canvas, changing midpoint pans it. No separate TouchEvent path or browser page zoom. Ordinary wheel scrolling and Ctrl/Meta+wheel zoom are retained.
- Long press is one 550ms timer on element bodies, not grips. Motion, promotion, cancel or blur disposes it. It opens the existing context menu without creating history.
- Two-finger tap invokes the existing store `undo()` once after both fingers lift. Three-finger redo is retained. Contacts must join within 180ms, finish within 350ms and stay within 6 screen pixels individually. A pinch with a stationary midpoint, returning pan, cancellation, extra finger or drag cannot undo.
- Hit tests use page-relative coordinates without limiting them to page bounds. Existing canvas visual overflow and export clipping are unchanged.
- Resize hit regions grow outward, not across the element body. Touch corner targets are 44 screen pixels; side targets occupy the remaining interval between corners on tiny artwork. Rotation regions are separate. Dots stay 7 screen pixels. The contextual toolbar measures the full grip bounds to avoid covering their touch regions.
- Touch properties use the existing complete `RightPanel` inside a non-modal floating sheet: 320px initial height, 56px folded height, maximum 72dvh; narrower landscape width. Drag only the header grip; controls still scroll normally. Opening/folding/resizing it does not resize the canvas stage. Desktop properties remain docked as before.
- Selecting artwork/artboards does not fit the viewport. First autosave assigning an ID to the same document no longer triggers a fit. Cmd+0 still explicitly fits the active artboard.

## Automated verification

```sh
npm run typecheck
npm run build
node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/editor/*.test.ts
node scripts/verify-canvas-input.mjs
```

The interactive script requires the dev server and Playwright Chromium. It accepts an optional base URL and `CHROMIUM_PATH`. Fixtures use the existing editor store; interactions use real browser mouse/CDP touch/pen events, not direct handler calls.

| Requested scenario | Result in browser emulation |
| --- | --- |
| Pinch zooms canvas only | Passed, including a gesture beginning over artwork |
| Two-finger pan | Passed; document geometry and zoom unchanged |
| Pen selects and moves | Passed |
| Pen resize / rotate | Passed; only the corresponding geometry changes |
| Long press with finger / pen | Passed; existing context menu, no drag/history |
| Two-finger undo exactly once | Passed with sequential lifts and real undo history |
| Entire element outside artboard | Passed, grabbed from visible overflow |
| Half-outside element | Passed, grabbed from the outside portion |
| Toolbar and browser scale unchanged | Passed |
| Compact properties | Passed at 1024×768, 768×1024, 1366×1024 and 390×844; fold/drag tested |
| Mouse / trackpad-equivalent input / keyboard | Passed mouse drag, ordinary wheel, Ctrl+wheel, Cmd+0, Ctrl+Z and double-click text editing |
| Pointer conflicts / runtime errors | No uncaught JavaScript errors in the interactive suite; ownership, cancel, capture-loss and competing-finger checks passed |

Additional checks: disjoint grips on 4mm elements at 20%, 100% and 200% zoom; contextual toolbar clearance; cancellation of a held drag's long press; first-save and selection zoom preservation. **20 interactive groups passed.**

The pure session suite adds **8 passing regression tests**. The complete editor suite reports **299/300 passing**. The one failure is the existing `library-import.test.ts` assertion `estimateTitleHeight("عنوان", 180) >= 11`; reproducing the test and its modules directly from fetched main gives the same failure. It is unrelated and was not changed.

Typecheck, the production build, and focused ESLint checks for the canvas/session/viewport/floating toolbar/sheet modules pass.

## Production smoke and environment limitations

The built editor was rendered in Chromium at iPad and desktop sizes; the iPad production smoke also exercised pinch and properties opening without changing stage dimensions. Screenshots are in `screenshots/ipad-input-verified.png`, `screenshots/production-ipad-input.png` and `screenshots/production-desktop-input.png`.

Local production preview without `DATABASE_URL` exposed an existing packaging problem: the generated PGLite bundle lacked its `pglite.data`, `pglite.wasm` and `initdb.wasm` assets. For smoke verification only, those three installed-package assets were copied into the ignored generated build's `_libs` directory. No database/build configuration or generated binaries were added to Git. An unmodified local preview may still need that existing packaging issue addressed separately.

Production console network failures were limited to blocked external Google Fonts and the platform extension script. No editor JavaScript/pointer errors occurred; this is not a claim that every network resource loaded successfully.

**Physical iPad/iPhone, Safari/WebKit, a real Apple Pencil, palm rejection on hardware, and a physical trackpad were not available.** Chromium touch/pen emulation verifies the shared input architecture but does not replace device-level acceptance testing, especially Safari gesture/callout behavior and Pencil palm rejection.
