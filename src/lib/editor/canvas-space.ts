import { pageSize, type Page } from "./model";
import {
  screenToDocument,
  visibleDocumentRect,
  type ScreenRect,
} from "./document-space";

/** Largest unobscured lane: palette clicks must not insert behind a floating panel. */
export function canvasViewport(
  stage: HTMLElement,
  fit?: { w: number; h: number },
): ScreenRect {
  const r = stage.getBoundingClientRect();
  let lanes: ScreenRect[] = [
    {
      left: r.left,
      top: r.top,
      width: stage.clientWidth,
      height: stage.clientHeight,
    },
  ];
  stage
    .closest(".editor-ui")
    ?.querySelectorAll<HTMLElement>("[data-editor-obstacle]")
    .forEach((node) => {
      if (!node.getClientRects().length) return;
      const s = getComputedStyle(node);
      if (s.visibility === "hidden" || s.display === "none") return;
      const obstacle = node.getBoundingClientRect();
      lanes = lanes.flatMap((lane) => {
        const l = Math.max(lane.left, obstacle.left),
          t = Math.max(lane.top, obstacle.top);
        const right = Math.min(lane.left + lane.width, obstacle.right);
        const bottom = Math.min(lane.top + lane.height, obstacle.bottom);
        if (right <= l || bottom <= t) return [lane];
        return [
          { ...lane, width: l - lane.left },
          { ...lane, left: right, width: lane.left + lane.width - right },
          { ...lane, height: t - lane.top },
          { ...lane, top: bottom, height: lane.top + lane.height - bottom },
        ].filter((box) => box.width > 32 && box.height > 32);
      });
    });
  const score = (lane: ScreenRect) =>
    fit
      ? Math.min(
          Math.max(0, lane.width - 32) / fit.w,
          Math.max(0, lane.height - 68) / fit.h,
        )
      : lane.width * lane.height;
  return lanes.sort((a, b) => score(b) - score(a))[0] || r;
}

export function visiblePageRect(stage: HTMLElement | null, page: Page) {
  const size = pageSize(page);
  const node = stage?.querySelector<HTMLElement>(
    `[data-page-id="${CSS.escape(page.id)}"]`,
  );
  return stage && node
    ? visibleDocumentRect(
        node.getBoundingClientRect(),
        canvasViewport(stage),
        size,
      )
    : null;
}

/** Palette clicks follow the visible page when the active page has been panned
 * entirely away. Explicit drops/replacements always retain their captured page. */
export function insertionPage(
  stage: HTMLElement | null,
  pages: Page[],
  activeId: string | undefined,
) {
  const active = pages.find((page) => page.id === activeId) || pages[0];
  if (!stage || (active && visiblePageRect(stage, active))) return active;
  const visible = pages
    .map((page) => ({ page, rect: visiblePageRect(stage, page) }))
    .filter((item) => item.rect && !item.page.hidden)
    .sort((a, b) => b.rect!.w * b.rect!.h - a.rect!.w * a.rect!.h);
  return visible[0]?.page || active;
}

/** Shared HTML5 and touch/pen drop resolver. Chrome releases cancel, not insert. */
export function canvasDropPoint(
  stage: HTMLElement | null,
  pages: Page[],
  clientX: number,
  clientY: number,
): { pageId: string; x: number; y: number } | null {
  if (!stage) return null;
  const sr = stage.getBoundingClientRect();
  if (
    clientX < sr.left ||
    clientX > sr.right ||
    clientY < sr.top ||
    clientY > sr.bottom
  )
    return null;
  const hit = document.elementFromPoint(clientX, clientY);
  if (hit && !stage.contains(hit)) return null;
  for (const page of pages) {
    if (page.locked || page.hidden) continue;
    const node = stage.querySelector<HTMLElement>(
      `[data-page-id="${CSS.escape(page.id)}"]`,
    );
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    )
      continue;
    return {
      pageId: page.id,
      ...screenToDocument(rect, pageSize(page), clientX, clientY),
    };
  }
  return null;
}

/** Reveal only when needed; never scroll the outer app or disturb an exact drop. */
export function revealInsertedElement(
  pageId: string,
  elementId: string | string[],
) {
  requestAnimationFrame(() => {
    const stage = document.querySelector<HTMLElement>(".editor-canvas-stage");
    if (!stage) return;
    const ids = typeof elementId === "string" ? [elementId] : elementId;
    const boxes = ids
      .map((id) =>
        stage
          .querySelector<HTMLElement>(
            `[data-page-id="${CSS.escape(pageId)}"] .canvas-el[data-el-id="${CSS.escape(id)}"]`,
          )
          ?.getBoundingClientRect(),
      )
      .filter((rect): rect is DOMRect => !!rect);
    if (!boxes.length) return;
    const left = Math.min(...boxes.map((rect) => rect.left)),
      top = Math.min(...boxes.map((rect) => rect.top));
    const rightEdge = Math.max(...boxes.map((rect) => rect.right)),
      bottomEdge = Math.max(...boxes.map((rect) => rect.bottom));
    const r = {
        left,
        top,
        right: rightEdge,
        bottom: bottomEdge,
        width: rightEdge - left,
        height: bottomEdge - top,
      },
      v = canvasViewport(stage);
    const right = v.left + v.width,
      bottom = v.top + v.height;
    if (
      r.left + r.width / 2 >= v.left &&
      r.left + r.width / 2 <= right &&
      r.top + r.height / 2 >= v.top &&
      r.top + r.height / 2 <= bottom
    )
      return;
    stage.scrollLeft += r.left + r.width / 2 - (v.left + v.width / 2);
    stage.scrollTop += r.top + r.height / 2 - (v.top + v.height / 2);
  });
}
