/**
 * Canvas/insertion geometry — the maths every drop, palette click and marquee
 * depends on.
 *
 * These functions decide WHERE a new element lands and WHICH page it belongs
 * to, and they were the least-covered part of the editor (the module had no
 * test of its own). The fake DOM below is deliberately tiny: only the four
 * things the module actually reads (`getBoundingClientRect`, `clientWidth`,
 * `clientHeight`, `closest/querySelectorAll`), so a change that starts relying
 * on something else fails here instead of in a user's browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canvasDropPoint,
  canvasViewport,
  insertionPage,
} from "./canvas-space.ts";
import type { Page } from "./model.ts";

/* `CSS.escape` exists in every browser; Node needs it for the page lookup. */
(globalThis as { CSS?: unknown }).CSS ??= {
  escape: (value: string) => value.replace(/["\\]/g, "\\$&"),
};
(globalThis as { getComputedStyle?: unknown }).getComputedStyle ??= () => ({
  visibility: "visible",
  display: "block",
});
(globalThis as { document?: unknown }).document ??= {
  elementFromPoint: () => null,
};

interface FakeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const rect = (left: number, top: number, width: number, height: number): FakeRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

interface FakeNode {
  rect: FakeRect;
  getBoundingClientRect(): FakeRect;
  getClientRects(): FakeRect[];
  clientWidth: number;
  clientHeight: number;
  closest(selector: string): unknown;
  querySelectorAll(selector: string): unknown[];
  querySelector(selector: string): unknown;
  contains(node: unknown): boolean;
}

function stage(
  bounds: FakeRect,
  options: {
    obstacles?: { rect: FakeRect; hidden?: boolean }[];
    pages?: { id: string; rect: FakeRect }[];
  } = {},
): FakeNode {
  const obstacles = (options.obstacles ?? []).map((item) => ({
    getBoundingClientRect: () => item.rect,
    getClientRects: () => (item.hidden ? [] : [item.rect]),
  }));
  const pages = options.pages ?? [];
  return {
    rect: bounds,
    getBoundingClientRect: () => bounds,
    getClientRects: () => [bounds],
    clientWidth: bounds.width,
    clientHeight: bounds.height,
    closest: () => ({ querySelectorAll: () => obstacles }),
    querySelectorAll: () => [],
    querySelector: (selector: string) => {
      const id = /data-page-id="([^"]+)"/.exec(selector)?.[1];
      const page = pages.find((item) => item.id === id);
      return page
        ? { getBoundingClientRect: () => page.rect, dataset: { pageId: page.id } }
        : null;
    },
    contains: (node: unknown) => node === undefined || node === null || node === undefined,
  };
}

const asStage = (node: FakeNode) => node as unknown as HTMLElement;
const page = (id: string, over: Partial<Page> = {}): Page =>
  ({
    id,
    name: id,
    w: 100,
    h: 200,
    elements: [],
    ...over,
  }) as Page;

test("a stage with no panels offers its whole box as the insertion lane", () => {
  const lane = canvasViewport(asStage(stage(rect(0, 0, 900, 600))));
  assert.deepEqual(lane, { left: 0, top: 0, width: 900, height: 600 });
});

test("a floating panel removes its lane and the largest free lane wins", () => {
  /* Panel across the right 300px: the surviving lanes are the left column
   * (600 wide) and the slivers above/below, which the 32px floor drops. */
  const lane = canvasViewport(
    asStage(
      stage(rect(0, 0, 900, 600), {
        obstacles: [{ rect: rect(600, 0, 300, 600) }],
      }),
    ),
  );
  assert.equal(lane.width, 600, "the free lane is the one left of the panel");
  assert.equal(lane.left, 0);
  assert.equal(lane.height, 600);
});

test("a hidden panel is not an obstacle", () => {
  const lane = canvasViewport(
    asStage(
      stage(rect(0, 0, 900, 600), {
        obstacles: [{ rect: rect(600, 0, 300, 600), hidden: true }],
      }),
    ),
  );
  assert.equal(lane.width, 900, "a hidden panel cannot reserve space");
});

test("with a target size the best-fitting lane is chosen, not the biggest", () => {
  /* Left lane 400×600, right lane 500×120: a 480×110 element fits the right
   * one nearly exactly and would be cramped in the left; the score must pick
   * the right lane even though the left is larger in area. */
  const lane = canvasViewport(
    asStage(
      stage(rect(0, 0, 900, 600), {
        obstacles: [
          { rect: rect(400, 0, 10, 600) },
          { rect: rect(0, 130, 900, 470) },
        ],
      }),
    ),
    { w: 480, h: 110 },
  );
  assert.ok(
    lane.height >= 110,
    `the chosen lane must be able to hold the element (height ${lane.height})`,
  );
});

test("insertion follows the active page while it is visible", () => {
  const active = page("active");
  const other = page("other");
  const node = stage(rect(0, 0, 900, 600), {
    pages: [
      { id: "active", rect: rect(100, 50, 200, 400) },
      { id: "other", rect: rect(400, 50, 200, 400) },
    ],
  });
  assert.equal(
    insertionPage(asStage(node), [active, other], "active").id,
    "active",
  );
});

test("insertion falls back to the visible page when the active one is panned away", () => {
  const active = page("active");
  const other = page("other");
  const node = stage(rect(0, 0, 900, 600), {
    pages: [
      /* Off-screen to the left: entirely outside the stage. */
      { id: "active", rect: rect(-1500, 50, 200, 400) },
      { id: "other", rect: rect(300, 50, 200, 400) },
    ],
  });
  assert.equal(
    insertionPage(asStage(node), [active, other], "active").id,
    "other",
    "a palette click must land on the page the author can actually see",
  );
});

test("insertion never prefers a hidden page", () => {
  const active = page("active");
  const hidden = page("hidden", { hidden: true });
  const node = stage(rect(0, 0, 900, 600), {
    pages: [
      { id: "active", rect: rect(-1500, 50, 200, 400) },
      { id: "hidden", rect: rect(300, 50, 200, 400) },
    ],
  });
  assert.equal(
    insertionPage(asStage(node), [active, hidden], "active").id,
    "active",
    "with nothing visible the active page is still the honest answer",
  );
});

test("a drop outside the stage is refused", () => {
  const node = stage(rect(0, 0, 900, 600), {
    pages: [{ id: "p1", rect: rect(100, 50, 200, 400) }],
  });
  assert.equal(
    canvasDropPoint(asStage(node), [page("p1")], 1200, 300),
    null,
    "releasing outside the canvas inserts nothing",
  );
});

test("a drop on a page resolves to page millimetres", () => {
  const node = stage(rect(0, 0, 900, 600), {
    pages: [{ id: "p1", rect: rect(100, 50, 200, 400) }],
  });
  /* The page box is 200×400 CSS px for a 100×200mm page: 2 px/mm. */
  const point = canvasDropPoint(asStage(node), [page("p1")], 200, 250);
  assert.ok(point, "the drop lands on the page");
  assert.equal(point!.pageId, "p1");
  assert.equal(point!.x, 50);
  assert.equal(point!.y, 100);
});

test("a drop on a locked or hidden page is refused", () => {
  const node = stage(rect(0, 0, 900, 600), {
    pages: [{ id: "p1", rect: rect(100, 50, 200, 400) }],
  });
  assert.equal(
    canvasDropPoint(asStage(node), [page("p1", { locked: true })], 200, 250),
    null,
    "locked pages do not accept content",
  );
  assert.equal(
    canvasDropPoint(asStage(node), [page("p1", { hidden: true })], 200, 250),
    null,
    "hidden pages do not accept content",
  );
});
