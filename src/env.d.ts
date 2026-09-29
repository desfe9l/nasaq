/**
 * Build-time constants injected by `define` in vite.config.ts.
 *
 * Deliberately declared as GLOBALS and used directly at each call site: they
 * are replaced by string literals during the build, so no cross-module binding
 * exists for a bundler to rename or drop. (An earlier version imported a
 * module constant here; the built bundles emitted the import's identifier
 * unreplaced — `ReferenceError: APP_BUILD_ID is not defined` — in both the
 * client and the SSR output.)
 */
declare const __APP_BUILD_ID__: string;
