# Installed editor adaptation — 2026-10-05

## Scope

- The existing ProductNav now exposes all 12 destinations: library, elements,
  element tools, shapes, templates, document colours, fonts, settings, pages,
  properties, layers and report tools. Existing drawing, selection/crop,
  text/image insertion, alignment, document and export actions are retained.
- Both `display-mode: standalone` and iOS `navigator.standalone` use the same
  editor store, panel groups, components, canvas and document persistence.
- Installed openings start with the artboard unobstructed; explicit navigation
  opens one existing window at a time. Desktop/tablet floating windows retain
  moving, closing and docking. Phone windows become bounded bottom/side drawers.
- All phone navigation labels stay visible in a horizontally scrollable RTL
  strip with 44px hit targets. Drawer/group gestures cannot accidentally drag
  a tab while scrolling. Canvas/Pencil gesture code is unchanged.
- Child-tab navigation resolves the current group host, including custom groups,
  and reopening a collapsed window reveals its content.

## Focused verification

Passed:

- `npm run typecheck`
- `npm run build`
- 38 targeted tests across `surface-nav`, `panel-groups`, `pen-input`, `tools`
  and `interaction-store` (using the repository test alias loader).
- `node scripts/editor-installed-check.mjs` against development **and built
  production preview**, at desktop 1440×960, iPad 1024×768, iPhone 390×844 and
  landscape iPhone 844×390. The browser check creates a real local document,
  traverses every tab with custom saved grouping, checks Arabic label visibility,
  drawer bounds, single-window presentation, tool activation, touch insertion,
  undo/redo, export dialog, light/dark appearance, explicit close and persistence
  of artwork/name/theme across refresh. No uncaught browser errors.
- Visual inspection of light/dark desktop, tablet and phone screenshots.
- `git diff --check`.

No full npm test suite was run. `npm run theme:check` still reports 39 existing
findings in unrelated surfaces (including StorageVerificationCard,
SelectionAiActions and RawContentFlow); this change adds no hard-coded chrome
colours. External analytics requests are unavailable in the sandbox.

Installed state and touch input were emulated in Chromium. Physical iOS Safari
installation and real Apple Pencil pressure were not hardware-tested; existing
pen-input unit tests pass and canvas input handlers were not modified.

Screenshots are generated in ignored `screenshots/editor-focused/`. The focused
browser command accepts `BASE_URL` and `BROWSER_EXECUTABLE`; no credentials or
licence overrides are needed.
