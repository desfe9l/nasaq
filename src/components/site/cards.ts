/*
 * Shared card styling for the marketing pages.
 *
 * One surface family for every card in the product: the same 1px border, the
 * same soft elevation token, and the same hover lift. Keeping the strings here
 * (instead of copy-pasting them per page) is what stops the Templates, Home and
 * Projects grids from drifting apart visually.
 */
import { cn } from "@/lib/utils";

/**
 * Elevation + lift for a clickable card.
 *
 * Light mode uses the `--shadow-card` drop shadow; dark mode swaps it for the
 * hairline-glow variant, because a black shadow is invisible on a dark page.
 * Hover raises the card by 4px with a larger shadow.
 */
export const SITE_CARD =
  "shadow-card border border-line transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover";

/**
 * Wrapping card row with a centered LAST row.
 *
 * `flex-wrap` + `justify-center` instead of `grid-cols-*`: a trailing partial
 * row (5 packs in a 3-up grid, for example) sits centered under the full rows
 * rather than hugging one edge. Pair with `CARD_W` on every child.
 *
 * The row is its own CONTAINER, and the card width is decided by how much room
 * the row actually has — not by the viewport. That is what stops the same card
 * from being 352px on `/templates` (a `max-w-6xl` page) and 296px on a category
 * page (which used to be `max-w-7xl` with a four-up grid): the columns are a
 * property of the shelf, so one card is one size wherever it is shown. It also
 * means a shelf placed inside a narrow column (the editor, a dialog) wraps
 * correctly without any surface-specific breakpoints.
 */
export const CARD_WRAP = "@container flex flex-wrap justify-center gap-4 @2xl:gap-6";

/**
 * Card width inside `CARD_WRAP` — one card per row until the row is wide enough
 * for two (42rem / 672px) and then three (64rem / 1024px).
 *
 * Each basis is `(100% − gaps) / columns` at the gap that is live in that same
 * container (16px under `@2xl`, 24px from `@2xl` up), which is what keeps
 * exactly N cards per row while the row stays centered. The thresholds are the
 * narrowest row that still leaves a card room to breathe (~328px at two up,
 * ~325px at three up), so a card never squeezes its own title or its primary
 * button — the fault that made «استخدام القالب» break into two lines.
 */
export const CARD_W =
  "basis-full @2xl:basis-[calc(50%-0.75rem)] @5xl:basis-[calc(33.3333%-1rem)]";

/**
 * The preview box inside a card, in px.
 *
 * Every card that paints a template — the catalog, a category page, the licensed
 * workspace shelf, the published shelf — reserves the SAME height, so cards in
 * neighbouring rows are the same height and mixed rows never look stitched
 * together. Landscape pages fit by width inside it (see `TemplateCard`).
 */
export const CARD_PREVIEW_H = 232;

/**
 * Icon-tile backgrounds — one tint per pillar, so tiles are distinguishable at
 * a glance instead of repeating the same pale square. The first (the flagship
 * template engine) is the solid brand tile, which makes the key selling point
 * read first. Presentation only: no behaviour is attached to a tint.
 */
export const ICON_TINTS = [
  "bg-navy text-on-brand shadow-sm",
  "bg-navy/10 text-brand",
  "bg-gold/25 text-ink",
  "bg-green/10 text-ink",
];

/** The tint for pillar `i`, cycling if there are more cards than tints. */
export function iconTint(i: number): string {
  return ICON_TINTS[i % ICON_TINTS.length];
}

/** Card surface: white in light mode, translucent ink in dark mode. */
export const CARD_SURFACE = "bg-surface";

/**
 * Convenience: the full class list for a clickable card.
 *
 * Radius, surface, border and elevation come from here; padding is passed by
 * the caller (`p-4` / `p-5` / `p-6`) so two padding utilities never end up in
 * the same class list, where the winner would depend on stylesheet order
 * instead of the author's intent.
 */
export function cardClass(...extra: Array<string | false | undefined>) {
  return cn("rounded-xl", CARD_SURFACE, SITE_CARD, ...extra);
}
