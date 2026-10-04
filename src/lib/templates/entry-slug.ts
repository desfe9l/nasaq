/*
 * URL identity for catalogue entries.
 *
 * A catalogue entry id (`pack:official`, `page:annual-cover`, `custom:abc123`)
 * is a stable internal key, not a web address: the colon survives an address
 * bar badly and reads like a scheme. `entrySlug` is the addressable spelling of
 * the same entry (`pack-official`), and `parseEntrySlug` turns an address back
 * into an id, so a template page can be linked, bookmarked and refreshed and
 * still resolve to exactly the same template.
 */

import type { CatalogEntry, CatalogEntryKind } from "@/lib/templates/catalog";

const KINDS: CatalogEntryKind[] = ["pack", "page", "custom"];

/** The address segment for an entry — stable for the life of the template. */
export function entrySlug(entry: Pick<CatalogEntry, "kind" | "sourceId">): string {
  return `${entry.kind}-${entry.sourceId}`;
}

/** The entry an address names, or null when the address is not one. */
export function parseEntrySlug(
  slug: string,
): { kind: CatalogEntryKind; sourceId: string } | null {
  const decoded = decodeURIComponent(slug ?? "");
  for (const kind of KINDS) {
    const prefix = `${kind}-`;
    if (decoded.startsWith(prefix) && decoded.length > prefix.length) {
      return { kind, sourceId: decoded.slice(prefix.length) };
    }
  }
  return null;
}

/** The entry a slug names, resolved against the live catalogue. */
export function findEntryBySlug(
  entries: readonly CatalogEntry[],
  slug: string,
): CatalogEntry | null {
  const parsed = parseEntrySlug(slug);
  if (!parsed) return null;
  return (
    entries.find(
      (entry) => entry.kind === parsed.kind && entry.sourceId === parsed.sourceId,
    ) ?? null
  );
}
