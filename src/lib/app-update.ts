/**
 * Build identity + freshness rules for the deployed app.
 *
 * Why this exists: the only unversioned URL in the whole delivery chain is the
 * HTML document. Hashed `/assets/*` files are `immutable`, the editor is
 * client-rendered (`ssr: false` on `/editor`), and browsers happily replay a
 * still-warm document — from the HTTP cache, the back/forward cache, or a
 * long-lived tab/app window. When that happens the app keeps rendering the
 * PREVIOUS deployment's chrome: the user sees an interface that no longer
 * exists in the repository, and no amount of server-side work changes it,
 * because the browser never asks.
 *
 * `no-cache` on documents (scripts/grok-pwa-shared.mjs) covers a fresh
 * navigation. These helpers cover the rest: a page that is already open and
 * gets resumed/reshown compares the build it is RUNNING with the build the
 * deployment is SERVING, and replaces itself with an explicitly uncached copy
 * of the document — hashed asset URLs then follow the fresh document, so the
 * whole app moves to the current deployment in one step.
 *
 * Everything here is pure so the rules are unit-tested rather than eyeballed.
 */

/** How often a visible page re-asks the deployment which build it serves. */
export const UPDATE_POLL_MS = 120_000;

/**
 * Quiet period before a stale page reloads itself. Long enough that an author
 * mid-gesture is never interrupted (every input restarts it), short enough that
 * an idle tab fixes itself while the author is still looking at it.
 */
export const IDLE_RELOAD_MS = 30_000;

/** Marker used when no build id was baked in (tests, plain node imports). */
export const DEV_BUILD_ID = "dev";

/**
 * Which build the document in front of us was served by.
 *
 * The document carries it (`<body data-build="…">`, written by the SSR root
 * from the build-time constant), and reading it there is deliberate: the value
 * belongs to the DOCUMENT, not to whatever script happens to be running, so a
 * page whose chunks were replayed from an old deployment is exactly the case
 * this reports. Falls back to "dev" for tests and any document without it.
 */
export function documentBuildId(): string {
  const stamped =
    typeof document !== "undefined" ? (document.body?.dataset.build ?? "") : "";
  return stamped || DEV_BUILD_ID;
}

/**
 * A build id is useful only when it is a non-empty, non-dev token. Anything
 * else means "no information", which must never trigger a reload.
 */
export function normalizeBuildId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === DEV_BUILD_ID) return null;
  return trimmed;
}

/**
 * True only when both sides are known and different. An unknown id on either
 * side (offline, 404, older build without the endpoint) is "no answer", not
 * "stale" — guessing here would reload the app in a loop.
 */
export function isStaleBuild(running: unknown, served: unknown): boolean {
  const a = normalizeBuildId(running);
  const b = normalizeBuildId(served);
  if (!a || !b) return false;
  return a !== b;
}

/**
 * The current URL with a build-specific query parameter.
 *
 * A distinct URL cannot be answered from the HTTP cache entry of the old
 * document, and it is what makes the reload decisive: the fresh document
 * references the NEW hashed assets, so the old immutable chunks are never
 * requested again. Existing query parameters are preserved (`/editor?project=…`)
 * and repeated calls with the same build id are idempotent.
 */
export function withCacheBuster(href: string, buildId: unknown): string {
  const id = normalizeBuildId(buildId) ?? DEV_BUILD_ID;
  let url: URL;
  try {
    url = new URL(href, "https://app.invalid");
  } catch {
    return href;
  }
  url.searchParams.set("__v", id);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** True while an input gesture is still "live" for the idle timer. */
export const IDLE_RESET_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "visibilitychange",
] as const;
