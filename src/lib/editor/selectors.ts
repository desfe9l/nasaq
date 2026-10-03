import type { CanvasEl } from "./model";
import { useEditor } from "./store";

/**
 * Narrow, identity-stable selectors over the editor store.
 *
 * The classic re-render trap in this app was `useEditor((s) =>
 * s.selectedElements()[0])`: the selector allocates a fresh array on EVERY
 * store notification, and any consumer that derives from the returned element
 * re-rendered on every write — including every frame of a live drag, before
 * drags moved to the transient interaction layer.
 *
 * The selectors here return EXISTING object references (never allocations),
 * so a component re-renders only when the thing it actually shows changed.
 */

/** Resolve an element by id anywhere inside a page's group tree. */
function findIn(list: CanvasEl[], id: string): CanvasEl | undefined {
  for (const el of list) {
    if (el.id === id) return el;
    if (el.children?.length) {
      const found = findIn(el.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * The PRIMARY selected element, by identity. Re-renders the caller only when
 * that element (or the selection itself) changes — never when an unrelated
 * element or page is written.
 */
export function useSelectedElement(): CanvasEl | undefined {
  return useEditor((s) => {
    if (!s.selectedId) return undefined;
    const page = s.pages.find((p) => p.id === s.activePageId);
    return page ? findIn(page.elements, s.selectedId) : undefined;
  });
}
