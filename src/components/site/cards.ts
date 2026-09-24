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
  "shadow-card dark:shadow-card-dark border border-line transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover dark:border-white/10 dark:hover:shadow-card-dark-hover";

/**
 * Wrapping card row with a centered LAST row.
 *
 * `flex-wrap` + `justify-center` instead of `grid-cols-*`: a trailing partial
 * row (5 packs in a 3-up grid, for example) sits centered under the full rows
 * rather than hugging one edge. Pair with `cardWidth()` on every child.
 */
export const CARD_WRAP = "flex flex-wrap justify-center gap-4 md:gap-6";

/**
 * Card width inside `CARD_WRAP`.
 *
 * Each basis is `(100% − gaps) / columns` at the gap that is live on that
 * breakpoint (16px below `md`, 24px from `md` up), which is what keeps exactly
 * N cards per row while the row stays centered.
 */
export const CARD_W =
  "basis-full sm:basis-[calc(50%-0.5rem)] md:basis-[calc(50%-0.75rem)] lg:basis-[calc(33.3333%-1rem)]";

/**
 * Icon-tile backgrounds — one tint per pillar, so tiles are distinguishable at
 * a glance instead of repeating the same pale square. The first (the flagship
 * template engine) is the solid brand tile, which makes the key selling point
 * read first. Presentation only: no behaviour is attached to a tint.
 */
export const ICON_TINTS = [
  "bg-navy text-white shadow-sm",
  "bg-navy/10 text-navy dark:bg-navy-2/20 dark:text-gold-2",
  "bg-gold/25 text-green dark:bg-gold/20 dark:text-gold-2",
  "bg-green/10 text-green dark:bg-white/10 dark:text-white",
];

/** The tint for pillar `i`, cycling if there are more cards than tints. */
export function iconTint(i: number): string {
  return ICON_TINTS[i % ICON_TINTS.length];
}

/** Card surface: white in light mode, translucent ink in dark mode. */
export const CARD_SURFACE = "bg-white dark:bg-white/5";

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
