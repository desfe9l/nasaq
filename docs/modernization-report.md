# Modernization report — shape-render test suite recovery (2026-10-12)

This report records **only what was verified in this session** against the live
repository `desfe9l/nasaq`. Anything not run here is listed under
"Not verified" rather than assumed.

## 1. Repository state at the start of the session

| Item | Verified value |
| --- | --- |
| `main` SHA | `2ca9f28a56311c610d4f33c450beb0f1911de7cf` — *Merge pull request #205 from desfe9l/arena/731f35f4-nasaq* |
| Working branch | `arena/731f35f4-nasaq` **exists on the remote** (head `8584ca9`, pushed 2026-10-12 17:52 UTC). It was not lost. |
| Commits on that branch since it forked from `main` after PR #203 | **11** — 9 already merged + 2 still open (see §2) |
| Open PRs | #206 — *fix(editor): restore the link controls and drop unreachable page helpers* (head `8584ca9`, 2 commits, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`, checks `verify` ✅ `browser` ✅) |
| Latest production deployment | GitHub deployment `7020879314`, environment **Production**, SHA `2ca9f28` (= `main`), state `success`, created 2026-10-12 18:38:57 UTC, URL `https://nasaq-aw2jtu5ti-ararcomksa-2423s-projects.vercel.app`. Commit status context `Vercel` = `success`. |
| CI on `main` | check-runs `verify`, `browser`, `build`, `deploy`, `report-build-status` all `success` |

## 2. The nine commits from `arena/731f35f4-nasaq` — already merged vs. missing

| # | SHA | Subject | Landed in |
| --- | --- | --- | --- |
| 1 | `cd78da2` | fix(editor): no phantom undo step for an unchanged commit | PR #204 → `main` |
| 2 | `efe5dd8` | ci(verify): run the pointer-gesture interaction suite in the required gate | PR #204 → `main` |
| 3 | `4158144` | test(editor): cover touch, Apple Pencil, the two-finger undo tap and group drags | PR #204 → `main` |
| 4 | `bdfc9ec` | docs(editor): record measured import/export fidelity and its limits | PR #204 → `main` |
| 5 | `739b1f9` | test(editor): pin canvas insertion, screen↔document mapping and panel clamping | PR #204 → `main` |
| 6 | `372a9a0` | test(editor): make the window smoke test exercise the real shell | PR #204 → `main` |
| 7 | `75e6055` | chore(deps)!: remove the AI ×4 upscale engine and its dependencies | PR #205 → `main` |
| 8 | `c34691f` | test(editor): pin the non-destructive crop geometry (**cropping tests**) | PR #205 → `main` |
| 9 | `5c1a42d` | test(a11y): audit the editor chrome's labels and structure in CI | PR #205 → `main` |
| 10 | `893169a` | fix(editor): restore the link controls the toolbar lost | **PR #206 — open, not merged** |
| 11 | `8584ca9` | refactor(store): drop the two unreachable page helpers | **PR #206 — open, not merged** |

**All nine reported commits are already in `main`.** Nothing from that branch
needed recovery; the two remaining commits are in open PR #206, which is clean
and green and was left for its owner to merge (no duplicate PR was created).

### Work that was reported but never pushed

A search of **every** branch on the remote (104 branches), all commit messages
since 2026-10-10, and the full history of `arena/731f35f4-nasaq` found **no
commit** for:

- a graphic-heading style-merging fix,
- an iOS device-detection fix,
- tests for shape rendering, shadows, library export, SVG sanitization, fonts,
  or page-navigation performance.

Those items existed, if at all, only in a sandbox that is gone. They were **not
recreated blindly**: each area was inspected in the current code, the two bugs
were confirmed to be real, and the tests were written against the behaviour
that actually ships.

## 3. Changes made in this session (branch `arena/72c5abad-nasaq`)

### Fixes (both confirmed as genuine defects in `main`)

| Area | File | Defect found in `main` | Fix |
| --- | --- | --- | --- |
| iOS device detection | `src/lib/editor/fonts.ts` → `detectPlatform()` | `/Mac OS X\|Macintosh/` was tested **before** `/iPhone\|iPad\|iPod/`. Every iPhone/iPod UA contains `like Mac OS X`, and the legacy iPad UA does too, so the font panel reported an iPhone as **«ماك»**. The iPadOS-13+ (Macintosh + touch) case was already right. | iOS tokens are tested first: iPhone/iPod → «آيفون», legacy iPad → «آيباد»; iPadOS 13+ unchanged; a real Mac (0–1 touch points) stays «ماك». |
| Graphic-heading style merging | `src/lib/editor/graphic-headings.ts` → `txt/boxEl/lineEl/shapeEl/imgEl` | Each helper did `{ ...over, style: { …defaults, …style } }`, so any `style` passed **inside `over`** was silently discarded. No current catalogue entry passes one (latent, not user-visible today), but any new heading would lose styles with no error. | `over.style` is merged last. Merge order is now: type defaults → heading defaults → builder style → per-instance `over.style`. The helpers are exported as `headingPrimitives` so the order is pinned by tests. |

### New test suites (67 tests, all passing)

| Suite | Tests | What it pins |
| --- | --- | --- |
| `src/lib/editor/shape-render.test.ts` | 11 | every library shape serialises to well-formed SVG with one primitive per part; `fill-rule="evenodd"` iff `isCompoundShape`; unknown id → rect; stroke inset `translate(s/2) scale((100-s)/100)`; negative stroke = none; dash formula (`4 3` floor, `16 12` at 10 units); `applyRectRadius` per-axis rx/ry, clamp 50, untouched reference for 0/negative/no box/circle; `strokeToUnits` geometric mean and NaN/0 safety; gradient `defs` with sanitised id; byte-identical output for identical input (canvas ≡ export) |
| `src/lib/editor/shadow.test.ts` | 8 | `buildShadow`/`parseShadow` round trip; clamps (±50 mm offsets, 0–50 mm blur, alpha 0–1, 2-dp alpha); alpha 0 → `""`; non-finite → 0; malformed colour → ink fallback; legacy preset strings (unitless, `rgb()`, no alpha) parse; hex/multi/inset/keyword → fresh defaults object |
| `src/lib/editor/library-export.test.ts` | 6 | exported file has only `{kind, version, folders, assets}` and canonical per-row keys; `remoteId`/`contentHash` never leave the device; null-normalised `folderId`/`parentId` survive JSON; order preserved, input not mutated, no aliasing; empty library imports; exported bytes import back with every asset placed; `downloadLibraryFile` creates a dated `nasaq-library-YYYY-MM-DD.json` anchor, clicks, removes, and revokes the blob URL after 4 s |
| `src/lib/editor/fonts.test.ts` | 12 | iPhone, iPod, legacy iPad, iPadOS 13+, Mac Safari/Chrome, Mac with 1 touch point, Windows, Android (not Linux), ChromeOS, Linux, no navigator, unknown UA; `detectDeviceFonts` returns `[]` without DOM / without 2d context, detects via two baselines, keeps bundled families, no duplicates, memoises |
| `src/lib/editor/graphic-headings.test.ts` | 13 | the merge order above for text/box/line/shape/image; no aliasing of caller style objects; every catalogue id × every theme builds a named group ≥ 2 children; unknown id → null; unknown theme → official; every text shrinks to fit with a font and placeholder; children inside the group box; theme palette applied; image headings carry the placeholder `data:` source with `objectFit: cover`; fresh ids per build |
| `src/lib/editor/svg-sanitize.test.ts` | 10 | `safeSvgHref` (fragment only), `safeSvgUrlRef` (all `url(#…)` quotings, nothing external); allow-lists contain no executable tag or `on*` attribute; `<style>` cannot `@import`/`url()` remote; `foreignObject` subtree removed and flagged; handlers survive no case/whitespace/unquoted tricks; `javascript:` behind whitespace/tab/entity/`xlink:href` refused; scrub is idempotent and always `<svg>…</svg>`; `safeLibrarySvg` keeps the root box but applies the same rules; 20 000-element input scrubs in < 2 s; null/number/binary input → `""` |
| `src/lib/editor/page-navigation.test.ts` | 7 | on a 60-page × 40-element document: `setActivePage` leaves the `pages` array **and every page object** referentially identical (the `ArtboardPage` memo contract); clears selection/edit state without a history entry or redo loss; same-page navigation publishes no new state; editing page 20 leaves the other 59 references intact; `elements` arrays shared until edited; 2 000 page switches at **< 0.5 ms each**; undo after navigating restores the edit |

### Test wiring

The suites run under a new `npm run test:editor:render` script that `npm test`
chains after `test:editor:products`. This was done deliberately instead of
appending to the single-line `test:src` list, because open PR #206 edits that
same line and the two PRs would otherwise conflict textually.

## 4. Verification on the reconciled tree (`main` + this branch)

| Command | Result | Warnings (not failures) |
| --- | --- | --- |
| `npm run typecheck` | clean | — |
| `npm run lint` | **0 errors**, 19 warnings | 19 pre-existing `react-refresh/only-export-components` warnings — identical count to PR #206 |
| `npm test` | **pass** — `test:src` 1308/1308 (165 suites), plus 3/3, 37/37, 32/32, 7/7 in the earlier `test:src` groups; `test:editor:tools` 52/52; `test:editor:products` 24/24; `test:editor:render` 67/67 | — |
| `npm run test:auth` | 109/109 | — |
| `npm run test:admin` | 191/191 | — |
| `npm run test:scripts` | 245/245 | — |
| `npm run test:editor:interaction` | 26/26 (`main` harness; PR #206 adds the 27th) | — |
| `npm run test:editor:a11y` | PASS — 503 controls named, no structural findings | jsdom prints `Not implemented: HTMLCanvasElement's getContext()` — pre-existing, harmless |
| `npm run test:editor:windows` | PASS(1) + PASS(2) | — |
| `npm run env:audit` | pass | — |
| `npm run verify:workflows` | pass | — |
| `npm run build` | pass — client, SSR and Nitro bundles built; `.vercel/output` generated | Vite: 7 CSS-optimisation notices and the chunk-size notice — pre-existing; `[migrate]` skipped because `NASAQ_PRIMARY_DATABASE_URL` is not set in the sandbox (documented PGLite fallback) |

No regressions were found; no failing check needed a rerun.

## 5. Not verified in this session (stated plainly)

- **Live login / session persistence on `nasaq.team` and `nasaq.work`.** The
  sandbox has outbound access only to GitHub/npm/PyPI hosts and holds no
  account credentials, so no browser session against production was possible.
  No claim is made about live behaviour. The cross-domain persistence code
  landed in PR #203 (`6298fed`) and is covered by its unit tests, which pass
  here, but that is not a live test.
- **Browser E2E jobs** (`test:offline-sync:e2e`, `test:nsq:browser`,
  `test:leave:browser`, `test:editor:browser`) need a Playwright Chromium
  download, which the sandbox cannot fetch. They run in the `browser` CI job,
  which is green on `main` and on PR #206, and will run on this PR.
- **Merge of PR #206 and of this PR.** Both are left open for an authorised
  reviewer; nothing was merged or force-pushed.
