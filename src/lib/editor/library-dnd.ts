/**
 * Smart-library drag-and-drop.
 *
 * Library cards can be dragged onto the canvas and dropped where the author
 * points, exactly like an image file — the gesture that makes a palette feel
 * like a palette instead of a list of buttons. The transport is a custom
 * `dataTransfer` flavour rather than the `Files` one, so the existing image drop
 * path stays untouched.
 *
 * Everything here is pure (no DOM, no store): the payload is validated on the
 * way out of the panel and again on the way into the canvas, because a
 * `dataTransfer` string is just untrusted text by the time it arrives. The
 * insertion arithmetic is injected with the store's `addAt`, which makes the
 * anchoring rule — "the first item lands under the cursor, the rest keep their
 * relative layout" — unit-testable without a browser.
 */

/** Custom drag flavour: never collides with `Files` or `text/plain`. */
export const LIBRARY_DND_MIME = "application/x-nasaq-library";

/** Element types a library card is allowed to create. */
export const LIBRARY_DROP_TYPES = [
  "table",
  "progress",
  "stat",
  "stamp",
  "box",
  "text",
  "line",
  "divider",
  "icon",
  "shape",
  "svg",
  "qr",
] as const;

/**
 * One element of a drop.
 *
 * `dx`/`dy` are millimetre offsets of this element's CENTRE from the drop
 * anchor, which is what lets a multi-part template (a 4-bar chart, a ring trio)
 * keep its layout wherever it lands.
 */
export interface LibraryDropItem {
  type: string;
  over?: Record<string, unknown>;
  dx?: number;
  dy?: number;
}

export interface LibraryDropPayload {
  items: LibraryDropItem[];
}

/** Guard against a hand-crafted payload inserting hundreds of elements. */
const MAX_ITEMS = 8;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a candidate payload.
 *
 * Unknown element types are dropped (not fatal): a payload written by an older
 * build of the panel should still insert the parts this build understands.
 */
export function normalizeLibraryDrop(
  input: unknown,
): LibraryDropPayload | null {
  if (!isPlainObject(input)) return null;
  const rawItems = input.items;
  if (!Array.isArray(rawItems)) return null;
  const items: LibraryDropItem[] = [];
  for (const raw of rawItems) {
    if (!isPlainObject(raw)) continue;
    const type = typeof raw.type === "string" ? raw.type : "";
    if (!(LIBRARY_DROP_TYPES as readonly string[]).includes(type)) continue;
    const item: LibraryDropItem = { type };
    if (isPlainObject(raw.over)) item.over = raw.over;
    if (typeof raw.dx === "number" && Number.isFinite(raw.dx)) item.dx = raw.dx;
    if (typeof raw.dy === "number" && Number.isFinite(raw.dy)) item.dy = raw.dy;
    items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  return items.length ? { items } : null;
}

/** Serialise a payload for `dataTransfer.setData`. */
export function serializeLibraryDrop(payload: LibraryDropPayload): string {
  return JSON.stringify(normalizeLibraryDrop(payload) ?? { items: [] });
}

/** Parse a `dataTransfer` string, returning null for anything unusable. */
export function parseLibraryDrop(
  raw: string | null | undefined,
): LibraryDropPayload | null {
  if (!raw) return null;
  try {
    return normalizeLibraryDrop(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Box of an element the insertion callback just created (page millimetres). */
export interface InsertedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Insert every element of a drop.
 *
 * · `at` given (a real drop) — the FIRST item is centred on the pointer and the
 *   remaining items keep their offsets from it.
 * · `at` omitted (a click on the card) — the first item is inserted the normal
 *   way (centred on what the author is looking at) and the rest follow it, so
 *   the template's internal geometry is identical in both paths.
 *
 * Returns how many elements were created.
 */
export function insertLibraryDrop(
  payload: LibraryDropPayload,
  at: { x: number; y: number } | null,
  addAt: (
    type: string,
    over: Record<string, unknown>,
    center?: { x: number; y: number },
  ) => InsertedBox | undefined,
): number {
  let anchor: { x: number; y: number } | null = at;
  let created = 0;
  for (const item of payload.items) {
    const dx = item.dx ?? 0;
    const dy = item.dy ?? 0;
    const center = anchor ? { x: anchor.x + dx, y: anchor.y + dy } : undefined;
    const box = addAt(item.type, item.over ?? {}, center);
    if (!box) continue;
    created += 1;
    // First successful insert defines the anchor for the rest of the template.
    if (!anchor) anchor = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
  return created;
}
