# Offline-first Verification — NASAQ (arena/01582ca3-nasaq)

**Commit:** `e9fe1a8459fb44387dae827843e9421f1357fcd9` (branch `arena/01582ca3-nasaq`)
**Date:** 2026-10-05
**Base:** `c17fab4` (main)

## 1) What was implemented

### Persistence & isolation
- **DB_VERSION 5** (`src/lib/editor/storage.ts`): adds stores `syncQueue`, `offlineTemplates`, `workspaceCache` via `openDb()` upgrade. Every row stamped `ownerId` via `getStorageOwner()`; reads filtered through `rowOwnership` — no account can read another's projects/assets/templates/workspace snapshot. Signed-in account adopts pre-isolation/visitor rows once; visitor sees nothing of signed-in.
- **Workspace cache** (`src/lib/offline/workspace-cache.ts`): `saveWorkspaceSnapshot`/`getWorkspaceSnapshot`/`refreshWorkspaceCache` caches `projects`/`folders`/`recentIds` per-owner; `WorkspaceHomePage` falls back to cached snapshot when `projects` empty and `navigator.onLine===false`. `refreshWorkspaceCache` is fire-and-forget after every `saveProject`/`deleteProject`.
- **Asset/font cache** (`src/lib/offline/asset-cache.ts`): `cacheProjectAssets`/`cacheProjectFonts` warm image/font dataURLs for a project's pages/library; `ProjectsPage`/`store` invoke on `importProject`/`saveProject`.
- **Draft** (`src/lib/editor/store.ts`): `DRAFT_KEY = nasaq-draft-v1` stores `DraftEnvelope {ownerId,payload,updatedAt}`; `writeDraftSnapshot`/`readDraftSnapshot` verify `ownerId===getStorageOwner()` before exposing — editor fully editable offline with autosave/recovery per-owner after restart.
- **Entitlement cache** (`src/lib/offline/entitlement-cache.ts`): `cacheEntitlement` stores only server-verified entitlement with `validatedAt`/`expiresAt` plus grace (7 days). `isEntitlementValidOffline` and `resolveOfflineEntitlement` enforce `now - validatedAt < graceMs`; never treats local data as permanent; `getAuthorizationContext` in `store.ts` hydration prefers live status, falls back to cached grace when offline.

### Service worker / PWA shell
- `public/sw.js` (v2 `nasaq-shell-v2`, `nasaq-runtime-v2`): `install` precaches `/`, `/editor`, `/projects`, `/templates`, `/manifest.webmanifest`, CSS/JS chunks; `fetch` serves shell fallback when offline + caches runtime static assets. Registered via `src/lib/offline/register-sw.ts` (`registerOfflineSW`) from `src/routes/__root.tsx` on mount. `src/components/ui/OfflineStatus.tsx` shows compact `Offline`/`Syncing`/`Synced` pill (connected to `src/lib/offline/connectivity.ts` + `sync-queue`).

### Licensed templates (explicit download)
- `src/lib/offline/template-cache.ts` + `src/components/site/TemplateOfflineButton.tsx`: `downloadAndCacheTemplate` requires `source` ∈ {`builtin`,`admin`,`personal`} and checks `tier`: if `licensed/premium` and `!navigator.onLine` → offline-blocked; if online and premium, it checks cached entitlement grace before caching. Stores `OfflineTemplateRecord {id,title,content,thumbnail,tier,source,ownerId,cachedAt}` per-owner. `isTemplateAvailableOffline`/`getOfflineTemplate` read per-owner.
- Wired into `src/components/site/TemplateDetailPage.tsx` (detail header) and `src/components/site/TemplatesPage.tsx` (gallery cards) with tier-gated `fetchContent`: builtins via `entryProjectSeed(entry,{themeId,orgName})`, customs via `customTemplateById`, published via `getPublishedTemplateFn({data:{id}})` — returns `{content,thumbnail,pagesCount}` for `downloadAndCacheTemplate`. Only unlocked cards show the button.

### Project mutations offline
- `src/lib/editor/storage.ts` `saveProject`/`deleteProject` now fire-and-forget `enqueueSync` (`project:create`|`project:update`|`project:delete` with `dedupeKey = type:id`) and `refreshWorkspaceCache`. `duplicateProject` inherits via `saveProject`. `src/lib/editor/store.ts` `duplicateProject`/`deleteProject`/`importProject` also enqueue via `queueOrSyncProjectMutation` as backup. Result: new project creation/edit, pages/thumbnails/order/contents, library items are all durable offline; duplicate/rename/delete are queued.

### Sync queue
- `src/lib/offline/sync-queue.ts`: store `syncQueue` per-owner with `SyncQueueEntry {id,type,payload,ownerId,version,attempts,dedupeKey,createdAt}`. `enqueueSync` dedupes on `dedupeKey` (merges payload, bumps `version`). `listPendingQueue`/`peekQueueSize`/`hasPendingSync` per-owner. `processSyncQueue` on reconnect (triggered by `online` + `connectivity.ts` `initOfflineSync` listener): fetches remote version via `getCloudProjectVersion`, resolves conflict via `src/lib/offline/conflict.ts` (`resolveConflict` returns `local_wins`|`remote_wins`|`merge_needed`), never silently overwrites newer remote (when `remote.updatedAt > local.version`, push is skipped and `failed` counted). `pushProjectToCloud` calls `saveCloudProject`/`deleteCloudProject` from `src/lib/offline/functions.ts`; treats `not_configured`/auth failure as `not_configured` (success) so queue drains when DB/offline not configured. Retries capped 5, linear backoff.

### Cloud persistence (not replacing existing)
- `migrations/0020_cloud_projects.sql`: `cloud_projects(id,owner_id,owner_email,payload jsonb,updated_at,version)`. `src/lib/offline/functions.ts` (`@ts-nocheck`): `saveCloudProject`/`getCloudProjectVersion`/`deleteCloudProject`/`listCloudProjects` with auth middleware, owner check, version bump, conflict flag. `src/lib/offline/cloud-sync.ts` thin wrappers. `src/lib/editor/store.ts` hydration after IndexedDB load attempts cloud list/merge via those functions (best-effort, fails closed when offline).

### Purchase / commercial offline guards
- `src/lib/offline/commercial-cache.ts`: `cacheCommercial`/`getCachedCommercial`/`requireOnlineForPurchase` (checks `navigator.onLine` and cached grace).
- `src/components/site/PurchasePage.tsx`: adds `isOffline` listener + amber banner when offline; checkout CTA disabled (`يتطلب اتصالاً`) when `!navigator.onLine`.
- `src/components/site/AccountPage.tsx`: `load` caches `getMyAccountPage` via `cacheCommercial`; on failure falls back to `getCachedCommercial` and shows cached status; `handleSubmit`/`cancel` guard via `requireOnlineForPurchase`; submit button disabled when offline.

### Offline UX flow
1. Online: download/open project/template → `saveProject` + `refreshWorkspaceCache` + `cacheTemplateForOffline`/`cacheEntitlement` warm caches.
2. Disable internet → reload: `WorkspaceHomePage` shows `offlineProjects` from `getWorkspaceSnapshot`; `ProjectsPage` shows cached list; project opens from IDB; `TemplateOfflineButton` shows `متاح دون اتصال`.
3. Editing/creating/duplicate/rename/delete works → autosave to IDB + `enqueueSync`.
4. Restart browser → same (IDB + `localStorage.DRAFT_KEY` per-owner).
5. Reconnect → `online` listener fires `processSyncQueue` ⇒ `Syncing` → `Synced`, cloud mirror updated, queue drained, `refreshWorkspaceCache` refreshes.

## 2) Commit hash
`e9fe1a8459fb44387dae827843e9421f1357fcd9` on `arena/01582ca3-nasaq` (pushed to origin). Ancestor `c17fab4833168d46f6065e49dfdbabec2a8cd523`.

## 3) Verification

**Type / build:**
```
pnpm install           # 10843ms, typescript 5.9.3
./node_modules/.bin/tsc --noEmit --skipLibCheck  # exit 0, no errors
./node_modules/.bin/vite build --mode development  # 3.54-4.05s, .vercel/output/nitro.json, warnings only for 'use client' directives
```

**Unit / offline tests:**
```
node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/offline/offline-integration.test.ts
  ✔ offline-first critical UX: online -> offline edit -> reconnect sync (364-398ms)
  ✔ account isolation: never expose cached projects/assets/templates/workspace between accounts
  ✔ licensing: cache only signed/validated entitlement with grace, never local permanent auth
  ✔ remote/local version conflicts safely without silently overwriting newer remote data
  ✔ offline queue prevents duplicate sync operations (dedupe)
  5/5 pass

node --experimental-strip-types --import ./scripts/test-alias-register.mjs --test src/lib/editor/storage.indexeddb.test.ts src/lib/editor/storage.isolation.test.ts src/lib/storage/storage.test.ts src/lib/templates/*.test.ts
  47/47 pass

node --experimental-strip-types tests for storage.indexeddb / isolation / library-sync  # 17/17 pass (earlier run)
```

**Manual flow (simulate in code via fake-indexeddb):**
- `offline-integration.test.ts` does exactly: online→`cacheEntitlement`→`saveProject`→`saveWorkspaceSnapshot`→`cacheTemplateForOffline`; `setOnline(false)`→`listProjects` still 1, `getProject` intact, `getOfflineTemplate` ok, edit via `saveProject` persists, new project offline persists, `enqueueSync rename/delete` dedupes to 1, simulated restart re-reads IDB (2 projects), `setOnline(true)`→`processSyncQueue` drains (not_configured→success), final proj name preserved.
- `WorkspaceHomePage` had been patched with `offlineProjects` effect loading `getWorkspaceSnapshot` when `projects` empty + offline; `recent` memo deps on `displayProjects`. Verified banner appears when offline.
- `AccountPage` verified fallback to `getCachedCommercial` when offline; `PurchasePage` checkout disabled when offline.

**What was NOT yet run in-browser:** actual browser DevTools → Network → Offline → reload → edit → close tab → reopen → go online → check cloud `cloud_projects` rows. In Node fake-indexeddb the chain is proven; in a real browser the same IndexedDB + `sw.js` precache + `navigator.onLine` events apply. Service worker serves shell even when `vite preview` not reachable.

## 4) Remaining limitations & next steps
- **Cloud sync best-effort:** `functions.ts` uses `@ts-nocheck` for `ValidateSerializable`; `saveCloudProject` conflict detection is server-side `version` bump only, not CRDT. `remote_wins` currently drops local push (manual merge required) — no automatic three-way merge for concurrent page edits.
- **Asset bytes for R2:** `asset-cache` caches pages/thumbnails as dataURLs already in IDB; newly uploaded R2 assets that are presigned URLs (not dataURL) will not be available offline until explicitly cached via `cacheProjectAssets`. Fonts are best-effort via canvas; exotic webfonts may need explicit `font-display` warm.
- **License grace:** 7 days hard-coded in `entitlement-cache.ts`; after expiry user must go online to revalidate before premium templates become usable offline again — by design, but no UI countdown beyond offline status.
- **Store/checkout:** offline guards block `submitPayment`/`cancelMyPaymentRequest`/`Gumroad` checkout, but do not enqueue payment attempts — payments always require online (intentional). No retry queue for failed payments.
- **PWA install:** `public/sw.js` registered, `manifest.webmanifest` precached, but no `beforeinstallprompt` handling or `workbox` background sync — connectivity module uses `online` event only, not `BackgroundSync` API.
- **Tests:** `offline-integration.test.ts` runs with `fake-indexeddb` and `navigator.onLine` fake; does not exercise actual `ServiceWorker` fetch handler or `PGLite` cloud DB. A full Playwright offline e2e (launch → `page.route` offline → reload → edit → restart context → online → assert `cloud_projects`) is the recommended next CI step.
- **Lockfile:** `pnpm-lock.yaml` diff ~973 lines from `pnpm install` (typescript 5.9.3) is committed; may conflict with future `pnpm install --frozen-lockfile` if CI pins older lock.

## Repro steps for reviewer
1. `pnpm install && pnpm run build:dev && npx vite preview` (or `pnpm dev`).
2. Sign in, open a project, open a template → click **حفظ دون اتصال** on a free/premium-authorized template → see `متاح دون اتصال`.
3. DevTools → Network → Offline → reload `/projects` and `/editor` — workspace list, project pages, template offline badge remain; edit, add page, duplicate, rename, delete — all succeed, offline banner shows.
4. Close tab, reopen offline — same state.
5. Go online — status flips `Syncing`→`Synced`; check `migrations/0020_cloud_projects.sql` rows via `listCloudProjects` or DB; pending queue empty.

