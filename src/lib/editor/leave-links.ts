/**
 * Which anchor clicks the editor's leave guard may intercept.
 *
 * The guard exists for in-app NAVIGATION between routes: following a link out
 * of the editor has to ask about unsaved work first. Two families of clicks
 * are not navigation and must pass through untouched:
 *
 *  · `download` anchors — every export (PNG, PDF, NSQ, JSON, the asset
 *    library) hands the browser a `blob:` URL plus the download attribute.
 *    A `blob:` URL inherits the page's origin, so the guard's same-origin
 *    test matched the export as an internal link: it cancelled the download
 *    (`preventDefault`) and then assigned the blob to the tab — the author
 *    lost the editor and never got their file.
 *  · Non-http(s) schemes — `blob:`, `data:` and the rest are file handles,
 *    never routes of this app.
 */

export interface LeaveClickLink {
  /** The anchor's `href` attribute as written. */
  href: string | null;
  /** Whether the anchor carries the `download` attribute. */
  download: boolean;
  /** The anchor's `target` attribute. */
  target: string | null;
  /** The page the click happened on. */
  currentHref: string;
}

/**
 * The URL a leave-intercepted click should navigate to, or `null` when the
 * click is not in-app navigation and must be left to the browser.
 */
export function leaveClickTarget({
  href,
  download,
  target,
  currentHref,
}: LeaveClickLink): URL | null {
  if (!href || href.startsWith("#") || /^(mailto:|tel:)/i.test(href)) {
    return null;
  }
  if (target === "_blank") return null;
  /*
   * A download is a file being written, never a navigation. Intercepting one
   * kills the export and then sends the tab to the blob.
   */
  if (download) return null;
  let url: URL;
  let current: URL;
  try {
    url = new URL(href, currentHref);
    current = new URL(currentHref);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== current.origin) return null;
  // Clicking a link to the exact page already open is not leaving it.
  if (url.pathname === current.pathname && url.search === current.search) {
    return null;
  }
  return url;
}
