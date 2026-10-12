# Dependency security — findings, reachability, decisions

_Last verified: 2026-10-12, Node 22.22.3, npm 10.9.8, `package-lock.json` as
committed on `main` (`2aca5b2`), against the production build of the same tree.
Re-run `npm run security:deps` after any dependency change; the numbers move, the
method does not._

## Method

`npm audit` reports what a package **declares**, not what the product **ships**.
A production advisory only matters if the vulnerable code is (a) reachable from an
entry point that runs in production and (b) fed untrusted input. So every finding
below is traced twice:

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

13 advisories: 8 high, 5 moderate, 0 critical (`npm run security:deps`).
591 bundles scanned in `.vercel/output`: **none** of `image-size`, `braces`,
`argparse`, `sprintf-js`, `wireit`, `chokidar` or `micromatch` is present.

| Package | Severity | Reached from | Vulnerable code shipped? | Patched release | Decision |
| --- | --- | --- | --- | --- | --- |
| `image-size` | high (×2: JXL/HEIF, ICNS) | `pptxgenjs@4.0.1` | **No** — `pptxgenjs/dist/*` contains 0 references (the dependency is declared but never imported) | 2.0.3 (ESM-only, breaking API) | No override. Documented residual. |
| `braces` | high (ReDoS) | `upscaler@1.0.0 → wireit@0.14.13 → chokidar@3 / fast-glob → micromatch` | **No** — `wireit` is upscaler's build tool; `upscaler/dist/browser/esm` never imports it, and no built asset mentions `wireit`, `chokidar` or `micromatch` | none published (`first_patched_version: null`) | Documented residual. Upstream must republish. |
| `argparse` → `sprintf-js` | moderate (ReDoS) | `@tensorflow/tfjs@4.11.0` (CLI: `yargs`/`chalk`) | **No** — the browser entry (`dist/index.js`) does not import it; it exists for the Node CLI | none for `argparse@1.x` | Documented residual. |
| `esbuild`, `vite`, `js-yaml`, `@babel/*`… | moderate | dev/build tooling only | **No** — never in `.vercel/output` | tracked by Dependabot-style updates | No action beyond routine upgrades. |

Nothing above is reachable from a request handler, a browser bundle or a server
function. That is a reachability statement, not a claim that the packages are
harmless: the moment a dependent starts importing one of them, the answer changes
and the check above must be re-run.

## Rejected "fixes" (and why)

- **`npm audit fix --force`**: the suggestions for this tree are wrong.
  `pptxgenjs` is offered a *downgrade* to 4.0.0 (older than the installed 4.0.1)
  and `upscaler` a downgrade to 0.12.3 while the upstream latest is 1.0.0.
  A forced downgrade trades a real API regression for an unreachable advisory.
- **Overriding `image-size` to 2.x**: it is a breaking major (ESM-only) applied to
  a package nothing imports. The override cannot reduce risk today, and it would
  guarantee a confusing failure if a future `pptxgenjs` starts using it.
- **Ignoring the audit**: `npm audit --omit=dev` output is still reviewed on every
  dependency change; the residual-risk table above is what makes that review
  possible.

## Residual risk

1. `braces@3.0.3` stays in the tree through `upscaler`. The window is narrow
   (build tooling of a dependency) but it is not patched upstream, so a
   compromised or newly-patched release must be picked up deliberately.
2. A future `pptxgenjs`/`tfjs` release could start importing `image-size`/`argparse`.
   The bundle check above is the tripwire: it is part of this document's method and
   must be repeated when those packages change.
3. Tooling advisories in dev dependencies are unaffected by anything the user can
   do; they are upgraded on the normal schedule.
