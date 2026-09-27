import type { Page, CanvasEl } from "./model";
import { uid } from "../utils";
import { clone } from "./model";

export type ArtboardLayoutMode = "grid" | "vertical" | "horizontal";

export const ARTBOARD_GUTTER_MM = 16;
export const ARTBOARD_HEADER_HEIGHT_MM = 10;

/**
 * Calculates row and column count based on pages length and desired column count.
 */
export function getArtboardGridDimensions(
  pageCount: number,
  cols: number,
): { rows: number; cols: number } {
  const safeCols = Math.max(1, cols);
  const rows = Math.ceil(pageCount / safeCols) || 1;
  return { rows, cols: safeCols };
}

export interface SplitArtboardResult {
  firstPage: Page;
  secondPage: Page;
}

/**
 * Split an artboard either horizontally or vertically into two equal pages.
 * Elements are assigned to the respective half based on their midpoint.
 * Elements on the second page have their coordinates translated into page-relative space.
 */
export function splitArtboard(
  sourcePage: Page,
  direction: "horizontal" | "vertical",
): SplitArtboardResult {
  const currentW = sourcePage.w ?? 210;
  const currentH = sourcePage.h ?? 297;

  if (direction === "horizontal") {
    // Horizontal split divides height into two equal halves (top & bottom)
    const newH = Number((currentH / 2).toFixed(2));
    const newW = currentW;
    const splitLineY = currentH / 2;

    const page1Elements: CanvasEl[] = [];
    const page2Elements: CanvasEl[] = [];

    for (const el of sourcePage.elements) {
      const elMidY = el.y + el.h / 2;
      if (elMidY < splitLineY) {
        page1Elements.push(clone(el));
      } else {
        const cloned = clone(el);
        cloned.y = Number((cloned.y - splitLineY).toFixed(2));
        page2Elements.push(cloned);
      }
    }

    const firstPage: Page = {
      ...clone(sourcePage),
      id: sourcePage.id,
      name: `${sourcePage.name} (الجزء 1)`,
      w: newW,
      h: newH,
      elements: page1Elements,
    };

    const secondPage: Page = {
      ...clone(sourcePage),
      id: uid("page"),
      name: `${sourcePage.name} (الجزء 2)`,
      w: newW,
      h: newH,
      elements: page2Elements,
    };

    return { firstPage, secondPage };
  } else {
    // Vertical split divides width into two equal halves (right & left, or first half / second half)
    const newW = Number((currentW / 2).toFixed(2));
    const newH = currentH;
    const splitLineX = currentW / 2;

    const page1Elements: CanvasEl[] = [];
    const page2Elements: CanvasEl[] = [];

    for (const el of sourcePage.elements) {
      const elMidX = el.x + el.w / 2;
      if (elMidX < splitLineX) {
        page1Elements.push(clone(el));
      } else {
        const cloned = clone(el);
        cloned.x = Number((cloned.x - splitLineX).toFixed(2));
        page2Elements.push(cloned);
      }
    }

    const firstPage: Page = {
      ...clone(sourcePage),
      id: sourcePage.id,
      name: `${sourcePage.name} (القسم 1)`,
      w: newW,
      h: newH,
      elements: page1Elements,
    };

    const secondPage: Page = {
      ...clone(sourcePage),
      id: uid("page"),
      name: `${sourcePage.name} (القسم 2)`,
      w: newW,
      h: newH,
      elements: page2Elements,
    };

    return { firstPage, secondPage };
  }
}
