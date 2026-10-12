# Dependency security — findings, reachability, decisions

_Last verified: 2026-10-12 after the user-directed removal of the ×4
super-resolution engine (`upscaler`, `@upscalerjs/esrgan-medium`,
`@tensorflow/tfjs`). Node 22.22.3, npm 10.9.8, `package-lock.json` as committed
on the branch, against a production build of the same tree. Re-run
`npm run security:deps` after any dependency change; the numbers move, the
method does not._

## Method

`npm audit` reports what a package **declares**, not what the product **ships**.
A production advisory only matters if the vulnerable code is (a) reachable from
an entry point that runs in production and (b) fed untrusted input. So every
finding below is traced twice:

1. **Dependency path** — `npm ls <package>`: which direct dependency pulls it in,
   and whether that path is a production dependency (`npm audit --omit=dev`).
2. **Real reachability** — does the dependent's *shipped* code import it at all,
   and is it in the built output?

```bash
npm run build          # produces .vercel/output — the artifact that ships
npm run security:deps  # audit summary + dependency paths + built-output scan
```

`security:deps` prints, for every flagged package, the production dependency path
and whether its code appears in the built bundles (matched on package-specific
signatures, because a plain name grep also matches our own identifiers).

## Snapshot

**2 advisories: 2 high, 0 moderate, 0 critical** — both the same finding seen
twice: `image-size` (two DoS advisories) reached through `pptxgenjs`. 584 bundles
scanned in `.vercel/output`: **none** of `image-size`, `braces`, `argparse`,
`sprintf-js`, `wireit`, `chokidar` or `micromatch` is present.

The previous snapshot on this branch was 13 advisories (8 high, 5 moderate). The
drop is not a suppression: it is the removal below, plus `argparse` now resolving
to the patched 2.0.1 through `@tanstack/start-plugin-core → xmlbuilder2 → js-yaml`
instead of the vulnerable 1.0.10 that `@tensorflow/tfjs`'s Node CLI pulled in.

| Package | Severity | Reached from | Vulnerable code shipped? | Patched release | Decision |
| --- | --- | --- | --- | --- | --- |
| `image-size` | high (×2: JXL/HEIF, ICNS) | `pptxgenjs@4.0.1` (declared dependency) | **No** — `pptxgenjs/dist/*` contains 0 references to it, and no built asset carries its signatures; the declaration is unused by the code we ship | 2.0.3 (ESM-only, breaking API) | Cannot be removed while `pptxgenjs` is our DOCX/PPTX writer. Documented residual, no override. |
| `pptxgenjs` | high (inherits the above) | the project's Office export writer | **No** — the advisory is about its unused dependency | 4.0.1 (installed); npm's only suggestion is a downgrade to 4.0.0 | Keep 4.0.1. Do not downgrade. |
| (everything else) | — | — | — | — | No advisories in the current tree. |

Nothing above is reachable from a request handler, a browser bundle or a server
function. That is a reachability statement, not a claim that the packages are
harmless: the moment a dependent starts importing `image-size`, the answer changes
and the check above must be re-run.

## The user-directed removal (2026-10-12)

At the product owner's direction the editor no longer ships an AI ×4
super-resolution feature, which removes its three dependencies outright:

- `upscaler@^1.0.0`, `@upscalerjs/esrgan-medium@^1.0.0`, `@tensorflow/tfjs@^4.11.0`
  deleted from `package.json` (and `package-lock.json`: 83 packages removed).
- `src/lib/editor/image-enhance/upscale.ts`, `scripts/emit-upscale-model.mjs` and
  the vendored `public/models/esrgan-medium-x4/` weights deleted; `vite.config.ts`
  no longer vendors the model.
- The `"upscale"` operation was removed from the enhancement contract entirely
  (`types.ts`, `limits.ts`, the local provider, and the «ترقية الدقة ×4» control in
  `ImageEnhanceTools.tsx`), so no dormant code path and no dead control remain.
  Background removal and denoise — both implemented in NASAQ's own worker — are
  unchanged.

This removed the `braces`/`chokidar`/`wireit` advisory chain (upscaler's build
tooling) and the `argparse@1.0.10 → sprintf-js` chain (TensorFlow.js's Node CLI)
from the tree. `image-size` is the one the owner asked about that could **not** be
removed by deleting a declaration: it is not a direct dependency of NASAQ at all
— it is declared by `pptxgenjs`, our Office writer. It ships no code (verified),
so it is documented here rather than forced out. Removing it would mean dropping
PPTX export.

## Rejected "fixes" (and why)

- **`npm audit fix --force`**: what is left of the suggestions is wrong. It offers
  `pptxgenjs` a *downgrade* to 4.0.0 — older than the installed 4.0.1 — to drop a
  dependency the package never imports. A forced downgrade trades a real API
  regression for an unreachable advisory.
- **Overriding `image-size` to 2.x**: it is a breaking major (ESM-only) applied to
  a package nothing imports. The override cannot reduce risk today, and it would
  guarantee a confusing failure if a future `pptxgenjs` starts using it.
- **Ignoring the audit**: `npm audit --omit=dev` output is still reviewed on every
  dependency change; the residual-risk table above is what makes that review
  possible.

## Residual risk

1. `image-size@1.2.1` stays in the tree through `pptxgenjs` with no patched 1.x
   available. It is unreachable from the shipped code today; the tripwire is the
   built-output scan in `npm run security:deps`, which must be re-run whenever
   `pptxgenjs` changes.
2. A future `pptxgenjs` release could start importing `image-size` (or a new
   dependency could pull another flagged package). The bundle check above is the
   tripwire, and it is part of this document's method.
3. Tooling advisories in dev dependencies are unaffected by anything the user can
   do; they are upgraded on the normal schedule.
4. The removed feature had its own risk profile (a browser-side TensorFlow.js
   runtime plus ~2.8 MB of weights fetched from `public/models`). That surface is
   gone with it; there is no replacement engine, and re-adding one is a product
   decision, not a dependency bump.
