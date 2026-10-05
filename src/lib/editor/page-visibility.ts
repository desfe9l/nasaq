/**
 * «إظهار العناصر خارج الصفحة» — one rule for what the artboard clips.
 *
 * Artwork routinely hangs off the sheet on purpose: a cover bleed, a decorative
 * arc, a photo the author is still positioning. The DOCUMENT keeps every one of
 * those elements no matter what this module decides — the decision is only ever
 * about paint inside the workspace, never about geometry, order or existence.
 *
 * Two independent switches feed one answer:
 *
 *   · `showOutsidePage` — the author's global, persisted workspace preference.
 *     ON (the default) means "never hide my artwork", so a page shows what sits
 *     outside its rectangle while it is being edited;
 *   · `page.clipContent` — an explicit per-page override for the author who
 *     wants ONE sheet to read as trimmed paper (a presentation slide, say)
 *     while the rest of the document keeps spilling visibly.
 *
 * A page is clipped when either asks for it, which keeps the per-page switch
 * meaningful in both directions of the global preference.
 */

/** Absent preference means SHOW — artwork outside the page is visible. */
export const SHOW_OUTSIDE_PAGE_DEFAULT = true;

/** The part of a page this rule reads. Structural typing keeps it testable. */
export interface ClippablePage {
  clipContent?: boolean;
}

/**
 * Normalise a persisted/serialised preference value.
 *
 * Only an explicit `false` hides; anything absent, corrupt or non-boolean falls
 * back to the visible default, so a stale UI slot can never silently swallow
 * someone's artwork.
 */
export function normalizeShowOutsidePage(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (clean === "false" || clean === "0" || clean === "off") return false;
    if (clean === "true" || clean === "1" || clean === "on") return true;
  }
  return SHOW_OUTSIDE_PAGE_DEFAULT;
}

/** True when this page must clip its paint to its own rectangle in the view. */
export function pageClipsView(
  page: ClippablePage | null | undefined,
  showOutsidePage: boolean | undefined,
): boolean {
  const show = normalizeShowOutsidePage(showOutsidePage);
  if (page?.clipContent === true) return true;
  return !show;
}

/** The artboard class that carries the clipping rule (see `styles.css`). */
export function pageClipClass(
  page: ClippablePage | null | undefined,
  showOutsidePage: boolean | undefined,
): string {
  return pageClipsView(page, showOutsidePage) ? "is-clip-view" : "";
}
