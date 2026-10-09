# AI design diversity — investigation and verification

Date: 2026-10-09. Base: `aa353015dfca3d2f11e99183800f968f9d913af9` (fetched main).
Status: implementation and local verification complete; **NOT approved for production**.

## Confirmed failure and pipeline

1. **Input:** `AITemplateStudio` calls `generateDesignBriefFn`; `DesignTwinPanel` and `TrainingCenterPage` call `prepareDesignTwinFn`. Authentication middleware, feature authorization, service controls and rate limits remain intact.
2. **Reference images:** training uploads validated PNG/JPEG/WebP data to `analyzeImageFn` → Gemini vision. The resulting description/OCR/objects and likes/dislikes are saved in `design_training_references`; optional image storage saves an asset ID. The generation functions previously never queried these reference analyses. Only some free-form likes/dislikes were copied to recurring memory. Analysis now asks for spatial relationships; generation loads account-owned global descriptions and preferences. Images are not copied into the new canvas or represented as fabricated photographs.
3. **Memory:** `design_memory` persists recurring preferences. Previously the twin sent unfiltered-category notes while the studio sent none. Both now load the same owner-scoped context, filter category-specific memory, and distinguish preferences from compositions. Explicit new format direction takes precedence over a saved default. Non-global reference records have no project/task binding in the existing schema, so they are deliberately not applied to unrelated requests; new non-global uploads no longer become global memory automatically. No schema or existing record is changed.
4. **Gemini request:** the original system prompt forced page 1 into a full-bleed/image/title hero. The brief contained prose `visualDirection` and page pattern metadata, but no model-authored element geometry. Sampling was not the core defect. The updated contract requires a bounded composition array: per-element position, size, plain copy and whitelisted style roles. Reference/memory data is supplied as user-context JSON, not interpolated into the system instruction. Timeout/rate controls and existing model fallback policy are retained; the output budget accommodates the larger bounded plan.
5. **Response/conversion:** `normalizeDesignBrief` → `generateDesignFromPrompt` → `generateFromIntent` formerly collapsed requests into fixed builders (notably the same title/top-band/central-image cover). `visualDirection`, columns and positioning did not control actual coordinates. The existing generator now converts validated model coordinates into ordinary editable text, shape and table elements using its existing constructors. Legacy catalog/manual generation remains intact. Page dimensions follow the actual selected format. Invalid or missing AI compositions fail rather than reverting to the catalog.
6. **Fallback/cache/display:** no generated-response cache or Gemini `cachedContent` reuse was found in this request path. The twin previously offered deterministic constitution output after provider failure. The AI entrypoints now stop and surface that failure. The studio also mounted a stock cybersecurity design and selected its sovereign variation, not the provider's primary result. It now starts empty, selects the primary result, and clears previous output when generation starts or inputs change. Style alternatives remain selectable; recolouring is not treated as diversity evidence.
7. **Review/handoff:** existing bounded critique/correction, entitlement checks and `applyAIEditorOperations` → editor `createDocument`/persistence remain. Request revision guards discard results after input/account changes, newer requests or unmount. Training checks again after editor hydration and before handing the document to the bridge.

## Regression evidence

Temporarily substituting only `design-generator.ts` from the base commit into the working test harness caused both new spatial regression tests to fail (2 failures, 3 passes at that point). The fixed generator passed both. This is a controlled **baseline-generator substitution**, not a claim that the complete modified suite existed on original main.

The final seven new tests cover:
- Five different fixture compositions surviving normalization, conversion and twin review without a stock cover substitution.
- Different reference-derived geometry for the same brief, with signatures that ignore text, colour and IDs.
- Invalid/missing/non-finite/out-of-bounds geometry rejection.
- Persistent preferences and explicit format precedence.
- Stale response/request/unmount invalidation.
- Real migrated PGlite SQL: reload preferences/references, isolate two owners, and respect deletion.
- Editable table conversion with correct rows/columns.

Provider-boundary tests additionally reject a successful-looking response without spatial compositions. These provider tests use HTTP test doubles, explicitly **not** real-provider evidence.

## Five real-provider evaluations

Command (production resolver, real provider function, no stub and no deterministic fallback):

```sh
node --experimental-strip-types --import ./scripts/app-alias-register.mjs scripts/evaluate-design-diversity.mjs
```

| Brief | Intended structural difference | Actual result |
| --- | --- | --- |
| Annual sustainability report | Right headline + side data column | BLOCKED: `not_configured` |
| Art exhibition invitation | Bottom headline + broad upper whitespace | BLOCKED: `not_configured` |
| Greeting card | Centered statement + sparse geometry | BLOCKED: `not_configured` |
| Executive brief | Wide decision column + vertical priority rail | BLOCKED: `not_configured` |
| Writing workshop poster | Broad heading + stepped learning sections | BLOCKED: `not_configured` |

The evaluator exited 1: zero real results, zero measured real compositions, `passed: false`. The sandbox has no `GEMINI_API_KEY`; the request stops before network I/O. Gemini's host is also outside the sandbox outbound allowlist. Nothing here proves actual Gemini diversity or reference-image sensitivity. The evaluator reports editable geometry and structural fingerprints when run in an authorized configured environment.

## Local checks

- `npm test`: **1,262 passed**, zero failures.
- `npm run test:auth`: **99 passed**.
- `npm run test:admin`: **191 passed**.
- `npm run test:scripts`: **243 passed**.
- `npm run typecheck`: passed.
- `npm run lint`: zero errors, **56 warnings**.
- `npm run env:audit`: passed, 52 documented variables.
- `npm run check:auth`: dev/build agree, sign-in enabled.
- `npm run test:auth:e2e`: **9/9** real local HTTP checks passed.
- `npm run test:ai:e2e`: **5/5** local auth/error-path checks passed; explicitly no configured Gemini generation.
- `npm run build`: passed, Vercel output generated. No production database was contacted; migration script skipped because `NASAQ_PRIMARY_DATABASE_URL` is absent.
- Dev and built-preview HTTP checks: `/`, `/training`, `/api/auth/ok` each returned 200. This is HTTP/SSR verification, not a browser-render or real-generation test.
- `git diff --check`: passed.
- `npm audit`: **FAILED**, 16 findings (10 high, 5 moderate, 1 low; zero critical). Production-only audit: 15 findings (9 high, 5 moderate, 1 low). Dependency declarations and `package-lock.json` are unchanged by this fix; these findings remain unresolved rather than being masked or force-upgraded in an unrelated AI patch.

## Files changed

- `src/lib/ai/design-composition.ts` and `.test.ts`: spatial contract, validation and regressions.
- `src/lib/ai/design-contract.ts`: preserve validated compositions.
- `src/lib/ai/design-context.ts`, `design-context.server.ts`: shared persistent, owner-scoped learning context.
- `src/lib/ai/generation-request.ts`, `use-generation-request.ts`: stale-response protection.
- `src/lib/ai/functions.ts`: load context through both secured entrypoints; explicit failures.
- `src/lib/ai/provider.server.ts`, `provider.test.ts`: spatial generation and reference-analysis instructions, bounded outputs, missing-plan regression.
- `src/lib/ai/design-twin.ts`: transfer compositions and honor current format.
- `src/lib/intelligence/design-generator.ts`, `pipeline.ts`, `prompt-analyzer.ts`: carry model geometry into the existing editable canvas and resolve page dimensions.
- `src/components/studio/AITemplateStudio.tsx`: primary output, no pre-generated stock result, stale-result guard.
- `src/components/editor/DesignTwinPanel.tsx`: stop on provider failure and discard stale delivery.
- `src/components/site/TrainingCenterPage.tsx`: scope-aware learning, no fallback generation, stale handoff guard.
- `scripts/evaluate-design-diversity.mjs`: reproducible real-provider evaluation with honest failure status.
- `package.json`: include spatial regression tests in the existing test gate.
- This verification report.

## Approval, deployment and remaining blockers

GitHub reports write/admin permission. Main has no branch protection or active rulesets; the established recent workflow is pull request → main → Vercel Git integration. Lack of merge authorization is **not** the blocker. The PR must remain unapproved/unmerged until the user's required real-provider acceptance evidence is obtained and security findings are reviewed/remediated through the appropriate dependency work.

Production URL documented by the repository: https://nasaq-sa.vercel.app . At investigation time, GitHub recorded successful Vercel production deployment of the **base** SHA. That is not deployment of this fix. No production configuration, infrastructure, database or project was changed.

Remaining checks:
1. In an authorized environment with the existing Gemini configuration and network access, run all five real-provider cases, compare actual geometry and inspect visual quality. Exercise real reference uploads and learned preferences through authenticated generation and editor handoff.
2. Browser QA is blocked locally: no Chromium executable is installed, and the browser download host is outside the outbound allowlist. Local HTTP success does not replace visual/editor interaction QA.
3. Resolve/review the failing dependency security audit; do not call it passed.
4. After acceptance and CI checks pass, approve/merge the PR through the existing workflow, confirm the resulting Vercel production deployment, then test real generation at the production URL. Vercel production and Gemini hosts are outside this sandbox's permitted outbound network, so live production verification is not possible here.

There is no truthful single 'authorize merge' step that substitutes for these missing acceptance checks.
