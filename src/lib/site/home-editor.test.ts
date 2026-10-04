import assert from "node:assert/strict";
import test from "node:test";

import { createProject } from "@/lib/editor/templates";
import { pageSize, type CanvasEl, type Page } from "@/lib/editor/model";
import {
  HOME_EDITOR_INITIAL,
  activePageOf,
  canRedo,
  canUndo,
  clampBoxToPage,
  clonePages,
  fitPaperBox,
  findHomeElement,
  homeEditorReducer,
  isTextualElement,
  pixelsToMm,
  resizedBox,
  selectedElementOf,
  stackedElements,
  type HomeEditorDocument,
  type HomeEditorModel,
} from "@/lib/site/home-editor.ts";

function bundledDoc(): HomeEditorDocument {
  const project = createProject("official");
  return {
    source: "bundled",
    id: "pack:official",
    title: project.name,
    pages: project.pages,
  };
}

function booted(): { model: HomeEditorModel; doc: HomeEditorDocument } {
  const doc = bundledDoc();
  const model = homeEditorReducer(HOME_EDITOR_INITIAL, { type: "load", doc });
  return { model, doc };
}

function firstMovable(page: Page): CanvasEl {
  const el = stackedElements(page).find((item) => !item.locked);
  assert.ok(el, "the hero document must expose a movable element");
  return el;
}

test("the hero boots a real multi-page NASAQ document", () => {
  const { model } = booted();
  assert.ok(model.pages.length > 1, "the official pack has several pages");
  assert.equal(model.activeIndex, 0);
  const page = activePageOf(model);
  assert.ok(page);
  assert.ok(page.elements.length > 0, "pages carry real elements");
  assert.equal(canUndo(model), false);
  assert.equal(canRedo(model), false);
});

test("loading clones the document so the pristine pages are never mutated", () => {
  const { model, doc } = booted();
  const page = activePageOf(model)!;
  const el = firstMovable(page);
  const originalX = doc.pages[0].elements.find((item) => item.id === el.id)!.x;

  const moved = homeEditorReducer(
    homeEditorReducer(model, { type: "gestureStart", id: el.id }),
    {
      type: "gestureBox",
      id: el.id,
      box: { x: el.x + 10, y: el.y + 6, w: el.w, h: el.h },
    },
  );

  assert.notEqual(findHomeElement(activePageOf(moved), el.id)!.x, originalX);
  assert.equal(
    doc.pages[0].elements.find((item) => item.id === el.id)!.x,
    originalX,
    "the source document stays pristine",
  );
});

test("clonePages keeps element identity and page geometry", () => {
  const doc = bundledDoc();
  const copy = clonePages(doc.pages);
  assert.equal(copy.length, doc.pages.length);
  assert.deepEqual(
    copy[0].elements.map((el) => el.id),
    doc.pages[0].elements.map((el) => el.id),
  );
  assert.deepEqual(pageSize(copy[0]), pageSize(doc.pages[0]));
  assert.notEqual(copy[0], doc.pages[0]);
  assert.notEqual(copy[0].elements[0], doc.pages[0].elements[0]);
});

test("selection is explicit and clearable", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);
  const selected = homeEditorReducer(model, { type: "select", id: el.id });
  assert.equal(selected.selectedId, el.id);
  assert.equal(selectedElementOf(selected)!.id, el.id);
  const cleared = homeEditorReducer(selected, { type: "select", id: null });
  assert.equal(cleared.selectedId, null);
  assert.equal(selectedElementOf(cleared), null);
});

test("a drag gesture moves the element and records ONE history entry", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);

  let next = homeEditorReducer(model, { type: "gestureStart", id: el.id });
  for (let step = 1; step <= 5; step++) {
    next = homeEditorReducer(next, {
      type: "gestureBox",
      id: el.id,
      box: { x: el.x + step * 2, y: el.y + step, w: el.w, h: el.h },
    });
  }
  next = homeEditorReducer(next, { type: "gestureEnd" });

  const moved = findHomeElement(activePageOf(next), el.id)!;
  assert.equal(moved.x, el.x + 10);
  assert.equal(moved.y, el.y + 5);
  assert.equal(next.past.length, 1, "a gesture is a single undo step");
  assert.equal(next.gesture, null);

  const undone = homeEditorReducer(next, { type: "undo" });
  assert.equal(findHomeElement(activePageOf(undone), el.id)!.x, el.x);
  assert.equal(canRedo(undone), true);
  const redone = homeEditorReducer(undone, { type: "redo" });
  assert.equal(findHomeElement(activePageOf(redone), el.id)!.x, el.x + 10);
});

test("a gesture that never moved leaves history alone", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);
  const next = homeEditorReducer(
    homeEditorReducer(model, { type: "gestureStart", id: el.id }),
    { type: "gestureEnd" },
  );
  assert.equal(next.past.length, 0);
});

test("resize uses the editor's own handle geometry", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);
  const box = resizedBox(
    { x: el.x, y: el.y, w: el.w, h: el.h },
    "se",
    12,
    8,
    el.rotation ?? 0,
  );
  assert.equal(box.w, el.w + 12);
  assert.equal(box.h, el.h + 8);
  assert.equal(box.x, el.x);

  const west = resizedBox({ x: 40, y: 40, w: 60, h: 30 }, "nw", -10, -5, 0);
  assert.equal(west.x, 30);
  assert.equal(west.y, 35);
  assert.equal(west.w, 70);
  assert.equal(west.h, 35);

  // A rotated element resizes along its OWN axes (toLocalDelta), like the
  // canvas: on a 90° box a rightward drag is a pull along the local −y axis,
  // so it is the height that changes, not the width.
  const rotated = resizedBox({ x: 0, y: 0, w: 50, h: 20 }, "se", 10, 0, 90);
  assert.ok(Math.abs(rotated.w - 50) < 1e-6, "the local x axis is untouched");
  assert.ok(
    Math.abs(rotated.h - 10) < 1e-6,
    "the local y axis follows the pointer",
  );
});

test("resizing through the model is clamped to the sheet and committed once", () => {
  const { model } = booted();
  const page = activePageOf(model)!;
  const el = firstMovable(page);
  const grown = resizedBox(
    { x: el.x, y: el.y, w: el.w, h: el.h },
    "se",
    15,
    9,
    el.rotation ?? 0,
  );

  let next = homeEditorReducer(model, { type: "gestureStart", id: el.id });
  next = homeEditorReducer(next, { type: "gestureBox", id: el.id, box: grown });
  next = homeEditorReducer(next, { type: "gestureEnd" });

  const after = findHomeElement(activePageOf(next), el.id)!;
  assert.equal(after.w, el.w + 15);
  assert.equal(after.h, el.h + 9);
  assert.equal(next.past.length, 1);
});

test("gesture updates are ignored without a matching gestureStart", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);
  const stray = homeEditorReducer(model, {
    type: "gestureBox",
    id: el.id,
    box: { x: 1, y: 1, w: 10, h: 10 },
  });
  assert.equal(stray, model, "a stale pointer stream cannot edit the document");
});

test("text editing writes the element's content through the model", () => {
  const { model } = booted();
  const page = activePageOf(model)!;
  const text = stackedElements(page).find(
    (el) => isTextualElement(el) && !el.locked,
  );
  assert.ok(text, "the official report has editable text");

  const editing = homeEditorReducer(model, { type: "editText", id: text.id });
  assert.equal(editing.editingId, text.id);
  assert.equal(editing.selectedId, text.id);

  const typed = homeEditorReducer(editing, {
    type: "setContent",
    id: text.id,
    content: "تجربة نَسَق",
  });
  assert.equal(
    findHomeElement(activePageOf(typed), text.id)!.content,
    "تجربة نَسَق",
  );
  assert.equal(typed.editingId, null);
  assert.equal(typed.past.length, 1);

  const undone = homeEditorReducer(typed, { type: "undo" });
  assert.equal(
    findHomeElement(activePageOf(undone), text.id)!.content,
    text.content,
  );
});

test("non-text elements never enter text editing", () => {
  const { model } = booted();
  const page = activePageOf(model)!;
  const shape = stackedElements(page).find((el) => !isTextualElement(el));
  if (!shape) return;
  const next = homeEditorReducer(model, { type: "editText", id: shape.id });
  assert.equal(next.editingId, null);
});

test("duplicate and delete keep the document consistent", () => {
  const { model } = booted();
  const page = activePageOf(model)!;
  const el = firstMovable(page);
  const count = page.elements.length;

  const selected = homeEditorReducer(model, { type: "select", id: el.id });
  const duplicated = homeEditorReducer(selected, { type: "duplicate" });
  assert.equal(activePageOf(duplicated)!.elements.length, count + 1);
  assert.notEqual(duplicated.selectedId, el.id);
  const copy = selectedElementOf(duplicated)!;
  assert.equal(copy.x, el.x + 4);

  const deleted = homeEditorReducer(duplicated, { type: "delete" });
  assert.equal(activePageOf(deleted)!.elements.length, count);
  assert.equal(deleted.selectedId, null);

  const restored = homeEditorReducer(deleted, { type: "undo" });
  assert.equal(activePageOf(restored)!.elements.length, count + 1);
});

test("page navigation is clamped and clears the live selection", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);
  const selected = homeEditorReducer(model, { type: "select", id: el.id });

  const second = homeEditorReducer(selected, { type: "goToPage", index: 1 });
  assert.equal(second.activeIndex, 1);
  assert.equal(second.selectedId, null, "selection never leaks across pages");

  const overflow = homeEditorReducer(second, { type: "goToPage", index: 999 });
  assert.equal(overflow.activeIndex, model.pages.length - 1);
  const underflow = homeEditorReducer(overflow, {
    type: "goToPage",
    index: -4,
  });
  assert.equal(underflow.activeIndex, 0);
});

test("nudging moves by the exact millimetre step", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);
  const selected = homeEditorReducer(model, { type: "select", id: el.id });
  const nudged = homeEditorReducer(selected, { type: "nudge", dx: -1, dy: 2 });
  const after = findHomeElement(activePageOf(nudged), el.id)!;
  assert.equal(after.x, el.x - 1);
  assert.equal(after.y, el.y + 2);
  assert.equal(nudged.past.length, 1);
});

test("reset restores the pristine document and clears history", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);
  const edited = homeEditorReducer(
    homeEditorReducer(
      homeEditorReducer(model, { type: "gestureStart", id: el.id }),
      {
        type: "gestureBox",
        id: el.id,
        box: { x: el.x + 20, y: el.y, w: el.w, h: el.h },
      },
    ),
    { type: "gestureEnd" },
  );
  const reset = homeEditorReducer(edited, { type: "reset" });
  assert.equal(findHomeElement(activePageOf(reset), el.id)!.x, el.x);
  assert.equal(reset.past.length, 0);
  assert.equal(reset.future.length, 0);
  assert.equal(reset.selectedId, null);
});

test("a box stays reachable: it may leave the sheet but never escape it", () => {
  const { model } = booted();
  const page = activePageOf(model)!;
  const size = pageSize(page);
  const far = clampBoxToPage({ x: 9999, y: -9999, w: 40, h: 20 }, page);
  assert.ok(far.x < size.w, "cannot be dragged past the right edge");
  assert.ok(far.y > -20, "cannot be dragged above the sheet");
  const tiny = clampBoxToPage({ x: 10, y: 10, w: 0.1, h: 0.1 }, page);
  assert.ok(
    tiny.w >= 4 && tiny.h >= 4,
    "never collapses below the minimum size",
  );
});

test("the paper is fitted to the viewport, keeping the page proportions", () => {
  const portrait = fitPaperBox({ width: 600, height: 420 }, { w: 210, h: 297 });
  assert.ok(portrait.height <= 420 - 28);
  assert.ok(Math.abs(portrait.width / portrait.height - 210 / 297) < 0.01);
  assert.ok(portrait.left > 0, "a portrait sheet is centred horizontally");

  const slide = fitPaperBox(
    { width: 600, height: 420 },
    { w: 338.7, h: 190.5 },
  );
  assert.ok(slide.width <= 600 - 28);
  assert.ok(Math.abs(slide.width / slide.height - 338.7 / 190.5) < 0.01);

  const unmeasured = fitPaperBox({ width: 0, height: 0 }, { w: 210, h: 297 });
  assert.deepEqual(unmeasured, { left: 0, top: 0, width: 0, height: 0 });
});

test("pointer pixels convert to page millimetres at any paper size", () => {
  const page = { w: 210, h: 297 };
  const big = pixelsToMm({ width: 420, height: 594 }, page, 42, 59.4);
  assert.ok(Math.abs(big.dx - 21) < 1e-6);
  assert.ok(Math.abs(big.dy - 29.7) < 1e-6);

  const small = pixelsToMm({ width: 210, height: 297 }, page, 42, 59.4);
  assert.ok(
    Math.abs(small.dx - 42) < 1e-6,
    "the same drag means more mm when zoomed out",
  );

  const unmeasured = pixelsToMm({ width: 0, height: 0 }, page, 10, 10);
  assert.deepEqual(unmeasured, { dx: 0, dy: 0 });
});

test("history is bounded so a long session cannot grow without limit", () => {
  const { model } = booted();
  const el = firstMovable(activePageOf(model)!);
  let next = homeEditorReducer(model, { type: "select", id: el.id });
  for (let i = 0; i < 60; i++) {
    next = homeEditorReducer(next, { type: "nudge", dx: 0.5, dy: 0 });
    next = homeEditorReducer(next, { type: "select", id: el.id });
  }
  assert.ok(next.past.length <= 40);
});
