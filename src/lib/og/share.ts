/**
 * The link/social-preview identity of the platform, in one place.
 *
 * WHY THIS MODULE
 *
 * The share card was broken in two independent ways, and both were symptoms of
 * the same omission: the platform never declared a share image at all.
 *
 *   1. The root route emitted a title and a description but NO Open Graph or
 *      Twitter tags. A crawler therefore had nothing to render and fell back to
 *      whatever it had cached from an earlier deploy — which is how the retired
 *      green document glyph kept showing up in shared links long after the mark
 *      had been replaced.
 *   2. The image that did exist (`public/og.jpg`) was the old artwork. It is
 *      regenerated now (see `scripts/generate-og-card.mjs`), from the CURRENT
 *      `public/nasaq-mark.svg`, at the 1200 × 630 every crawler expects.
 *
 * Absolute URLs are mandatory here: the Open Graph protocol does not resolve
 * relative `og:image` values, so a relative path is silently ignored by
 * WhatsApp, LinkedIn and Slack.
 */

/** Canonical public origin — the one the marketing and share URLs are built on. */
export const SITE_ORIGIN = "https://nasaq-sa.vercel.app";

/**
 * The platform's share card: the current نَسَق mark, in the brand's own green.
 *
 * Regenerate with `node scripts/generate-og-card.mjs` whenever the mark or the
 * tagline changes — never by hand-editing the JPEG.
 */
export const SITE_OG_IMAGE = `${SITE_ORIGIN}/og.jpg`;

/** Declared so a crawler can lay the card out before the image loads. */
export const SITE_OG_IMAGE_WIDTH = 1200;
export const SITE_OG_IMAGE_HEIGHT = 630;

export const SITE_OG_IMAGE_ALT = "نَسَق | NASAQ — منصة التصميم والتحرير المؤسسي";

/** `og:image:type` — og.jpg is a JPEG; crawlers that require it will not guess. */
export const SITE_OG_IMAGE_TYPE = "image/jpeg";
