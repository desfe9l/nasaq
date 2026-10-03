import type { CanvasEl } from "./model";

export type LayerDropSide = "before" | "after";

/**
 * Visual stack order: index 0 is the front (highest z), matching the layers
 * panel. Array position and z are rewritten together so drag-reorder, the
 * up/down buttons, the canvas and export cannot disagree.
 */
export function stackFrontToBack(list: readonly CanvasEl[]): CanvasEl[] {
  return [...list].sort((a, b) => (b.z ?? 0) - (a.z ?? 0) || 0);
}

function withZ(ordered: CanvasEl[]): CanvasEl[] {
  return ordered.map((el, index) => ({
    ...el,
    z: ordered.length - index,
  }));
}

/** Move one layer toward the front (`dir` 1) or the back (`dir` -1). */
export function nudgeStack(
  list: readonly CanvasEl[],
  id: string,
  dir: -1 | 1,
): CanvasEl[] | null {
  const ordered = stackFrontToBack(list);
  const index = ordered.findIndex((el) => el.id === id);
  if (index < 0) return null;
  const target = index - dir;
  if (target < 0 || target >= ordered.length) return null;
  const [moved] = ordered.splice(index, 1);
  ordered.splice(target, 0, moved);
  return withZ(ordered);
}

/**
 * Insert `fromId` before or after `toId` in the same sibling list.
 * Returns null when either id is missing.
 */
export function restack(
  list: readonly CanvasEl[],
  fromId: string,
  toId: string,
  side: LayerDropSide = "before",
): CanvasEl[] | null {
  if (fromId === toId) return null;
  const ordered = stackFrontToBack(list);
  const fromIndex = ordered.findIndex((el) => el.id === fromId);
  if (fromIndex < 0) return null;
  const [moved] = ordered.splice(fromIndex, 1);
  let insertAt = ordered.findIndex((el) => el.id === toId);
  if (insertAt < 0) return null;
  if (side === "after") insertAt += 1;
  ordered.splice(insertAt, 0, moved);
  return withZ(ordered);
}
