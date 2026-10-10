/**
 * Search-parameter normalization for route `validateSearch` functions.
 *
 * TanStack Router's default search parser JSON-parses every value, so
 * `?showcase=1` arrives as the NUMBER `1` and `?q=2024` as the NUMBER `2024`.
 * A `typeof value === "string"` guard then silently DROPS the parameter and
 * the router rewrites the address without it — which is how
 * `/editor?template=official&showcase=1` lost its `showcase` flag and booted
 * a persisting editor instead of the non-persisting marketing preview.
 *
 * Every route that reads a free-form string parameter goes through
 * `searchString`, which accepts what the parser actually produces (string,
 * number, boolean) and hands back the original text form.
 */
export function searchString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return undefined;
}

/** `?showcase=1` (and tolerant `true`) — the non-persisting preview flag. */
export function searchFlag(value: unknown): boolean {
  const text = searchString(value);
  return text === "1" || text === "true";
}
