/**
 * The build id baked into every bundle by `appBuildId()` in vite.config.ts.
 *
 * Both halves of one deployment — the client bundle and the server bundle —
 * are built by the same Vite config evaluation, so they carry the same id; a
 * later deployment carries a different one. That equality is what the update
 * guard compares (see `app-update.ts`).
 */
declare const __APP_BUILD_ID__: string | undefined;

import { DEV_BUILD_ID } from "./app-update";

export const APP_BUILD_ID: string =
  typeof __APP_BUILD_ID__ === "string" && __APP_BUILD_ID__ ? __APP_BUILD_ID__ : DEV_BUILD_ID;
