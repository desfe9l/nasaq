import { pageSize, sizePreset, type Page, type SizeId } from "./model.ts";

/**
 * How a new sheet chooses its size.
 *
 * Inheriting the previous page is an explicit choice. The default is the
 * document preset, never a silent copy of whatever sheet happens to be active.
 */
export type NewPageRequest =
  | SizeId
  | { mode: "inherit" }
  | { mode: "preset"; sizeId: SizeId };

/** Dimensions for a new empty page. Orientation is the width/height pair. */
export function resolveNewPageSize(input: {
  request?: NewPageRequest;
  source?: { w?: number; h?: number } | null;
  defaultSize?: SizeId | string;
}): { w: number; h: number } {
  const fallback = sizePreset(input.defaultSize || "a4-portrait");
  const request = input.request;
  if (!request) return { w: fallback.w, h: fallback.h };
  if (typeof request === "string") {
    const preset = sizePreset(request);
    return { w: preset.w, h: preset.h };
  }
  if (request.mode === "inherit") {
    return input.source ? pageSize(input.source) : { w: fallback.w, h: fallback.h };
  }
  const preset = sizePreset(request.sizeId);
  return { w: preset.w, h: preset.h };
}

/**
 * Insert `page` immediately after the active sheet.
 *
 * Document order is the Arabic reading order: index 0 is page 1. The rail and
 * the artboard both follow this array (RTL places index 0 at the start edge).
 * A new page is the next page, not an append that visually jumps to the
 * opposite side and not a prepend that renumbers everything.
 */
export function insertPageAfter<T extends { id: string }>(
  pages: readonly T[],
  page: T,
  afterId: string | null | undefined,
): T[] {
  const next = pages.slice();
  const index = afterId ? next.findIndex((item) => item.id === afterId) : -1;
  next.splice(index >= 0 ? index + 1 : next.length, 0, page);
  return next;
}

/** Badge numbers are the document index. They stay stable for pages before the insert. */
export function pageNumbers(pages: readonly { id: string }[]): Record<string, number> {
  const numbers: Record<string, number> = {};
  pages.forEach((page, index) => {
    numbers[page.id] = index + 1;
  });
  return numbers;
}

export type { Page };
