import assert from "node:assert/strict";
import test from "node:test";
import {
  insertPageAfter,
  pageNumbers,
  resolveNewPageSize,
} from "./page-order.ts";

test("a new page defaults to the document preset, not the previous sheet", () => {
  const size = resolveNewPageSize({
    source: { w: 297, h: 210 },
    defaultSize: "a4-portrait",
  });
  assert.deepEqual(size, { w: 210, h: 297 });
});

test("inheriting size copies dimensions and orientation only", () => {
  const size = resolveNewPageSize({
    request: { mode: "inherit" },
    source: { w: 297, h: 210 },
    defaultSize: "a4-portrait",
  });
  assert.deepEqual(size, { w: 297, h: 210 });
});

test("an explicit preset replaces both size and orientation", () => {
  const size = resolveNewPageSize({
    request: { mode: "preset", sizeId: "slide-16-9" },
    source: { w: 210, h: 297 },
  });
  assert.equal(size.w, 338.7);
  assert.equal(size.h, 190.5);
});

test("new pages are inserted after the active page in reading order", () => {
  const pages = insertPageAfter(
    [
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ],
    { id: "n" },
    "a",
  );
  assert.deepEqual(
    pages.map((page) => page.id),
    ["a", "n", "b", "c"],
  );
  assert.deepEqual(pageNumbers(pages), { a: 1, n: 2, b: 3, c: 4 });
});

test("missing active page appends without renumbering earlier sheets", () => {
  const pages = insertPageAfter([{ id: "a" }, { id: "b" }], { id: "n" }, "gone");
  assert.deepEqual(pageNumbers(pages), { a: 1, b: 2, n: 3 });
});
